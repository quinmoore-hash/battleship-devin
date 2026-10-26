/**
 * GPU/device tiering. Pure functions so they can be unit-tested; `detect.ts` feeds them real
 * browser values. A tier maps to a `PerfProfile` that every module reads through `usePerf()`.
 */
import type { Lod } from '../ships/types'

export type Tier = 'low' | 'medium' | 'high'
/** Persisted player override. `auto` = detected tier. */
export type QualitySetting = 'auto' | Tier

export interface PerfProfile {
  tier: Tier
  /** Canvas device-pixel-ratio clamp `[min, max]`. */
  dpr: [number, number]
  /** Shadow map size, or 0 for no shadows. */
  shadows: 0 | 1024 | 2048
  /** Multiplier for particle counts (fire tongues, smoke puffs, splinters, bubbles, rain). */
  particlesScale: number
  /** Bloom / SMAA / colour grade pass on or off. */
  postprocessing: boolean
  /** Highest ship detail level the tier may show (distance LOD only ever goes coarser). */
  lod: Lod
  /** Scene quality (water mesh density, wave count, dressing density). */
  quality: 'low' | 'high'
  /** Water wave count (Gerstner bank size). */
  waves: number
  /** Near water sheet subdivisions per side (two triangles per cell). */
  waterSegments: number
}

export const TIER_PROFILES: Record<Tier, PerfProfile> = {
  // phones / old integrated GPUs / software GL: flat lighting, 3 waves, coarse ships
  low: { tier: 'low', dpr: [1, 1], shadows: 0, particlesScale: 0.35, postprocessing: false, lod: 2, quality: 'low', waves: 3, waterSegments: 96 },
  // the default and the target for integrated laptops (MacBook Air M4 @ 2560×1664, Iris Xe @ 1080p): 60 fps sustained
  medium: { tier: 'medium', dpr: [1, 1.5], shadows: 1024, particlesScale: 0.6, postprocessing: false, lod: 1, quality: 'high', waves: 4, waterSegments: 128 },
  // opt-in or probe-confirmed discrete GPUs only: full-detail fleet, 2k shadows, bloom/SMAA, every particle
  high: { tier: 'high', dpr: [1, 1.75], shadows: 2048, particlesScale: 1, postprocessing: true, lod: 0, quality: 'high', waves: 6, waterSegments: 224 },
}

export const TIERS: Tier[] = ['low', 'medium', 'high']

export interface DeviceInfo {
  /** `WEBGL_debug_renderer_info` UNMASKED_RENDERER, or '' when unavailable. */
  renderer: string
  devicePixelRatio: number
  screenWidth: number
  screenHeight: number
  hardwareConcurrency: number
  /** Coarse pointer / touch-only device (phones, tablets). */
  mobile: boolean
  /** Median FPS from the startup probe, or undefined before it has run. */
  probeFps?: number
}

/** GPU class from the renderer string. `high` means "may run the high tier if the probe confirms it". */
export type GpuClass = 'software' | 'low' | 'medium' | 'high'

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|mesa offscreen|basic render/i
const INTEGRATED_LOW = /intel\(r\) (hd|uhd) graphics (4|5|6)\d\d|intel.*(hd graphics 3000|hd graphics 4000)|mali-t[0-9]{3}|mali-g[1-5][0-9]\b|adreno \([0-9]{3}\)|powervr|apple a[7-9]\b|apple a1[01]\b/i
// Apple M-series (incl. Safari's masked "Apple GPU") lands here: medium is the tuned target for a MacBook Air
const APPLE = /apple (m\d|gpu|a1[2-9])/i
const INTEGRATED_MID = /intel.*(iris|uhd|xe)|adreno \((6|7)[0-9]{2}\)|mali-g[67][0-9]|radeon.*(vega|graphics)|geforce (mx|gtx 10[0-5]0|gtx 9)/i
const DISCRETE_HIGH = /geforce (rtx|gtx 1[6-9]|gtx 20)|radeon (rx|pro)|apple m\d (pro|max|ultra)|quadro|arc a/i

export function classifyGpu(renderer: string): GpuClass | undefined {
  if (!renderer) return undefined
  if (SOFTWARE.test(renderer)) return 'software'
  if (DISCRETE_HIGH.test(renderer)) return 'high'
  if (INTEGRATED_LOW.test(renderer)) return 'low'
  if (APPLE.test(renderer) || INTEGRATED_MID.test(renderer)) return 'medium'
  return undefined
}

/** Classify a renderer string into a tier (undefined when unrecognised). Software GL is `low`. */
export function classifyRenderer(renderer: string): Tier | undefined {
  const c = classifyGpu(renderer)
  return c === 'software' ? 'low' : c
}

const clampTier = (i: number): Tier => TIERS[Math.max(0, Math.min(TIERS.length - 1, i))]
const tierIndex = (t: Tier): number => TIERS.indexOf(t)

/**
 * Static guess before the FPS probe has run. Never above `medium`: `high` is only reached through
 * `refineTier` when a discrete-class GPU proves ≥ `PROBE_FPS.promoteAbove`. Unknown desktops are
 * medium, unknown phones low; tiny CPUs and 5K+ screens drop one tier.
 */
export function guessTier(info: DeviceInfo): Tier {
  const byGpu = classifyRenderer(info.renderer)
  let idx = byGpu !== undefined ? Math.min(1, tierIndex(byGpu)) : info.mobile ? 0 : 1
  if (info.screenWidth * info.screenHeight > 3840 * 2160) idx -= 1
  if (info.hardwareConcurrency > 0 && info.hardwareConcurrency <= 2) idx -= 1
  return clampTier(idx)
}

/** FPS thresholds for the startup probe (`demoteBelow`) and the in-battle watchdog (`WATCHDOG.minFps`). */
export const PROBE_FPS = { demoteBelow: 45, promoteAbove: 90 } as const

/**
 * Final tier once the 2 s probe has a median FPS. Demotes one tier under 45 fps (two under 22.5);
 * promotes to `high` only when the GPU is discrete-class, not a phone, and the probe shows ≥ 90 fps.
 */
export function refineTier(guess: Tier, info: DeviceInfo): Tier {
  const fps = info.probeFps
  if (fps === undefined || !Number.isFinite(fps)) return guess
  let idx = tierIndex(guess)
  if (fps < PROBE_FPS.demoteBelow / 2) idx -= 2
  else if (fps < PROBE_FPS.demoteBelow) idx -= 1
  else if (fps >= PROBE_FPS.promoteAbove && classifyGpu(info.renderer) === 'high' && !info.mobile) idx = 2
  return clampTier(idx)
}

/** Tier one step below `tier` (or `tier` itself when already low). */
export function lowerTier(tier: Tier): Tier {
  return clampTier(tierIndex(tier) - 1)
}

/**
 * In-battle watchdog: sustained FPS under `minFps` for `sustainMs` drops one tier (once). `graceMs`
 * after entering the battle is ignored so shader compilation and the opening cinematic do not count.
 */
/** Physical pixels (screen.width × devicePixelRatio) above which Medium drops its DPR cap to 1.25 (Retina MacBooks). */
export const WIDE_RETINA_PX = 2500

/**
 * DPR range for the Canvas. Medium is the "no-lag" tier: its cap drops from 1.5 to 1.25 on
 * wide Retina screens (2560-wide MacBook panels) where 1.5 × 2560 would be a 3840px backbuffer.
 */
export function resolveDpr(
  profile: Pick<PerfProfile, 'tier' | 'dpr'>,
  screenWidth: number = typeof screen !== 'undefined' ? screen.width : 0,
  devicePixelRatio: number = typeof window !== 'undefined' ? window.devicePixelRatio : 1,
): [number, number] {
  const [min, max] = profile.dpr
  if (profile.tier === 'medium' && screenWidth * devicePixelRatio > WIDE_RETINA_PX) return [min, Math.min(max, 1.25)]
  return [min, max]
}

export const WATCHDOG = { minFps: 45, sustainMs: 4000, graceMs: 3000 } as const

/**
 * Pure step: `belowMs` is how long FPS has been continuously under the threshold. Returns the new
 * value (reset to 0 when a window is fast enough). Trip when it reaches `sustainMs`.
 */
export function watchdogStep(belowMs: number, fps: number, windowMs: number, o: { minFps: number } = WATCHDOG): number {
  if (!Number.isFinite(fps) || windowMs <= 0) return belowMs
  return fps < o.minFps ? belowMs + windowMs : 0
}

export function resolveTier(setting: QualitySetting, detected: Tier): Tier {
  return setting === 'auto' ? detected : setting
}

export function profileFor(tier: Tier): PerfProfile {
  return TIER_PROFILES[tier]
}

/** Median of a sample list (ignores non-finite entries). */
export function median(values: readonly number[]): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return NaN
  const mid = v.length >> 1
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

/** Frame timestamps (ms) -> per-second FPS samples; used by the probe and the `?perf` overlay. */
export function fpsSamples(frameTimes: readonly number[], windowMs = 500): number[] {
  const out: number[] = []
  if (frameTimes.length < 2) return out
  let start = frameTimes[0]
  let n = 0
  for (let i = 1; i < frameTimes.length; i++) {
    n++
    if (frameTimes[i] - start >= windowMs) {
      out.push((n * 1000) / (frameTimes[i] - start))
      start = frameTimes[i]
      n = 0
    }
  }
  return out
}
