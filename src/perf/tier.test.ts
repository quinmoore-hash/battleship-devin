import { describe, expect, it } from 'vitest'
import {
  resolveDpr,
  classifyGpu,
  classifyRenderer,
  fpsSamples,
  guessTier,
  lowerTier,
  median,
  profileFor,
  refineTier,
  resolveTier,
  TIER_PROFILES,
  WATCHDOG,
  watchdogStep,
  type DeviceInfo,
} from './tier'

const desktop: DeviceInfo = { renderer: '', devicePixelRatio: 1, screenWidth: 1920, screenHeight: 1080, hardwareConcurrency: 8, mobile: false }
const air = { ...desktop, renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)', devicePixelRatio: 2, screenWidth: 2560, screenHeight: 1664 }

describe('classifyRenderer / classifyGpu', () => {
  it('maps software renderers to low', () => {
    expect(classifyRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))')).toBe('low')
    expect(classifyGpu('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('software')
  })
  it('maps discrete GPUs to high-capable, Apple + integrated to medium, old integrated to low', () => {
    expect(classifyRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)')).toBe('high')
    expect(classifyRenderer('Apple M1 Pro')).toBe('high')
    expect(classifyRenderer('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)')).toBe('medium')
    expect(classifyRenderer('Apple M1')).toBe('medium')
    expect(classifyRenderer(air.renderer)).toBe('medium')
    expect(classifyRenderer('Apple GPU')).toBe('medium')
    expect(classifyRenderer('ANGLE (Intel(R) HD Graphics 4000)')).toBe('low')
    expect(classifyRenderer('Mali-T760')).toBe('low')
  })
  it('returns undefined for unknown strings', () => {
    expect(classifyRenderer('')).toBeUndefined()
    expect(classifyRenderer('Mystery GPU 9000')).toBeUndefined()
  })
})

describe('guessTier', () => {
  it('defaults unknown desktops to medium and unknown phones to low', () => {
    expect(guessTier(desktop)).toBe('medium')
    expect(guessTier({ ...desktop, mobile: true, screenWidth: 390, screenHeight: 844, devicePixelRatio: 3 })).toBe('low')
  })
  it('never guesses high, even for a discrete GPU — the probe has to confirm it', () => {
    expect(guessTier({ ...desktop, renderer: 'NVIDIA GeForce RTX 4090' })).toBe('medium')
    expect(guessTier({ ...desktop, renderer: 'Apple M2 Max', mobile: true })).toBe('medium')
  })
  it('treats a MacBook Air M4 as medium regardless of its Retina pixel count', () => {
    expect(guessTier(air)).toBe('medium')
  })
  it('demotes for 5K+ screens and tiny CPUs', () => {
    expect(guessTier({ ...desktop, renderer: 'Apple M1', screenWidth: 5120, screenHeight: 2880 })).toBe('low')
    expect(guessTier({ ...desktop, hardwareConcurrency: 2 })).toBe('low')
  })
})

describe('refineTier', () => {
  it('keeps the guess without a probe', () => {
    expect(refineTier('medium', desktop)).toBe('medium')
  })
  it('demotes under 45 fps, by two tiers under 22.5', () => {
    expect(refineTier('medium', { ...air, probeFps: 40 })).toBe('low')
    expect(refineTier('high', { ...desktop, probeFps: 12 })).toBe('low')
    expect(refineTier('low', { ...desktop, probeFps: 5 })).toBe('low')
  })
  it('keeps medium between 45 and 90 fps, even on a discrete GPU', () => {
    expect(refineTier('medium', { ...air, probeFps: 60 })).toBe('medium')
    expect(refineTier('medium', { ...desktop, renderer: 'NVIDIA GeForce RTX 4090', probeFps: 75 })).toBe('medium')
  })
  it('promotes to high only for discrete-class GPUs at >= 90 fps, never phones, software or Apple M-base', () => {
    expect(refineTier('medium', { ...desktop, renderer: 'NVIDIA GeForce RTX 4090', probeFps: 120 })).toBe('high')
    expect(refineTier('medium', { ...desktop, renderer: 'Apple M3 Max', probeFps: 95 })).toBe('high')
    expect(refineTier('medium', { ...air, probeFps: 120 })).toBe('medium')
    expect(refineTier('medium', { ...desktop, probeFps: 120 })).toBe('medium')
    expect(refineTier('medium', { ...desktop, renderer: 'SwiftShader', probeFps: 120 })).toBe('medium')
    expect(refineTier('medium', { ...desktop, renderer: 'NVIDIA GeForce RTX 4090', mobile: true, probeFps: 120 })).toBe('medium')
  })
})

describe('watchdog', () => {
  it('accumulates time under the threshold and resets on a fast window', () => {
    let below = 0
    for (let i = 0; i < 7; i++) below = watchdogStep(below, 30, 500)
    expect(below).toBe(3500)
    expect(below).toBeLessThan(WATCHDOG.sustainMs)
    below = watchdogStep(below, 30, 500)
    expect(below).toBeGreaterThanOrEqual(WATCHDOG.sustainMs)
    expect(watchdogStep(below, 60, 500)).toBe(0)
    expect(watchdogStep(1000, NaN, 500)).toBe(1000)
  })
  it('lowers one tier and stops at low', () => {
    expect(lowerTier('high')).toBe('medium')
    expect(lowerTier('medium')).toBe('low')
    expect(lowerTier('low')).toBe('low')
  })
})

describe('profiles', () => {
  it('resolve manual overrides and expose every knob', () => {
    expect(resolveTier('auto', 'low')).toBe('low')
    expect(resolveTier('high', 'low')).toBe('high')
    for (const tier of ['low', 'medium', 'high'] as const) {
      const p = profileFor(tier)
      expect(p).toBe(TIER_PROFILES[tier])
      expect(p.dpr[0]).toBeLessThanOrEqual(p.dpr[1])
      expect(p.particlesScale).toBeGreaterThan(0)
    }
  })
  it('keeps the heavy effects on high only and medium within the MacBook Air budget', () => {
    expect(TIER_PROFILES.low.shadows).toBe(0)
    expect(TIER_PROFILES.medium.shadows).toBe(1024)
    expect(TIER_PROFILES.medium.postprocessing).toBe(false)
    expect(TIER_PROFILES.medium.dpr[1]).toBe(1.5)
    expect(TIER_PROFILES.medium.lod).toBeGreaterThanOrEqual(1)
    expect(TIER_PROFILES.medium.particlesScale).toBeLessThan(1)
    expect(TIER_PROFILES.high.postprocessing).toBe(true)
    expect(TIER_PROFILES.high.lod).toBe(0)
    expect(TIER_PROFILES.low.lod).toBeGreaterThan(TIER_PROFILES.medium.lod)
  })
})

describe('median / fpsSamples', () => {
  it('computes medians and ignores NaN', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([NaN, 5])).toBe(5)
    expect(median([])).toBeNaN()
  })
  it('turns frame timestamps into windowed fps samples', () => {
    const times = Array.from({ length: 121 }, (_, i) => i * (1000 / 60))
    const s = fpsSamples(times, 500)
    expect(s.length).toBeGreaterThanOrEqual(3)
    for (const v of s) expect(v).toBeCloseTo(60, 0)
  })
})

describe('resolveDpr', () => {
  it('caps Medium at 1.25 on wide Retina panels and leaves other tiers alone', () => {
    expect(resolveDpr(TIER_PROFILES.medium, 2560, 2)).toEqual([1, 1.25])
    expect(resolveDpr(TIER_PROFILES.medium, 1440, 1)).toEqual([1, 1.5])
    expect(resolveDpr(TIER_PROFILES.high, 2560, 2)).toEqual([1, 1.75])
    expect(resolveDpr(TIER_PROFILES.low, 2560, 2)).toEqual([1, 1])
  })
})
