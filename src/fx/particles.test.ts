import { describe, expect, it } from 'vitest'
import { burstDuration, makeBurst, particleAt, smokePuff } from './particles'

const opts = {
  count: 12,
  seed: 7,
  speed: [1, 2] as [number, number],
  up: [3, 5] as [number, number],
  size: [0.1, 0.2] as [number, number],
  life: [0.5, 1] as [number, number],
  stagger: 0.2,
}

describe('makeBurst', () => {
  it('is deterministic for a seed and varies by seed', () => {
    expect(makeBurst(opts)).toEqual(makeBurst(opts))
    expect(makeBurst(opts)).not.toEqual(makeBurst({ ...opts, seed: 8 }))
  })
  it('respects the ranges', () => {
    for (const p of makeBurst(opts)) {
      expect(p.vy).toBeGreaterThanOrEqual(3)
      expect(p.vy).toBeLessThanOrEqual(5)
      expect(p.size).toBeGreaterThanOrEqual(0.1)
      expect(p.life).toBeLessThanOrEqual(1)
      expect(p.delay).toBeLessThanOrEqual(0.2)
      expect(Math.hypot(p.vx, p.vz)).toBeGreaterThanOrEqual(1 - 1e-9)
    }
  })
})

describe('particleAt', () => {
  const p = makeBurst({ ...opts, count: 1, stagger: 0 })[0]
  it('is null before birth and after death', () => {
    expect(particleAt({ ...p, delay: 0.5 }, 0.1, -9.8)).toBeNull()
    expect(particleAt(p, p.life + 0.01, -9.8)).toBeNull()
  })
  it('rises then falls under gravity and fades out', () => {
    const early = particleAt(p, 0.05, -9.8)!
    const late = particleAt(p, p.life - 0.001, -9.8)!
    expect(early.y).toBeGreaterThan(0)
    expect(late.scale).toBeLessThan(early.scale)
    expect(late.scale).toBeGreaterThanOrEqual(0)
    expect(particleAt(p, 0.2, 0)!.y).toBeCloseTo(p.vy * 0.2)
  })
  it('burstDuration covers the longest-lived particle', () => {
    const burst = makeBurst(opts)
    const d = burstDuration(burst)
    for (const q of burst) expect(particleAt(q, d + 0.01, -9.8)).toBeNull()
  })
})

describe('smokePuff', () => {
  const smoke = { count: 6, period: 2, height: 1.5, drift: 0.2, baseScale: 0.3 }
  it('rises over its period and loops', () => {
    const a = smokePuff(0, 0.5, smoke)
    const b = smokePuff(0, 1.5, smoke)
    expect(b.y).toBeGreaterThan(a.y)
    expect(smokePuff(0, 0.5, smoke)).toEqual(smokePuff(0, 2.5, smoke))
  })
  it('staggers puffs along the column', () => {
    const ys = Array.from({ length: smoke.count }, (_, i) => smokePuff(i, 0, smoke).y)
    expect(new Set(ys.map((y) => y.toFixed(3))).size).toBe(smoke.count)
  })
  it('fades to nothing at the top', () => {
    expect(smokePuff(0, 1.999, smoke).scale).toBeLessThan(0.01)
  })
})
