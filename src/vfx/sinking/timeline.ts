import { CINEMATIC_TIMING } from '../../cinematics/types'
import { clamp01 } from '../math'

/** A stretch of the sequence (in progress units) that plays at `scale`× speed, e.g. 0.4 for slow motion. */
export interface SlowMo {
  from: number
  to: number
  scale: number
}

export interface SinkTimeline {
  /** Real seconds the whole sequence takes (slow motion included). */
  duration: number
  slowMo?: SlowMo
}

/** Default pacing: the director's `sink` timing with the middle of the slide in 0.4× slow motion. */
export const DEFAULT_SLOW_MO: SlowMo = { from: 0.38, to: 0.7, scale: 0.4 }

export const sinkTimeline = (level: 'full' | 'fast' = 'full'): SinkTimeline => ({
  duration: CINEMATIC_TIMING.sink[level],
  slowMo: level === 'full' ? DEFAULT_SLOW_MO : undefined,
})

/** Relative time weights of the three stretches: before / inside / after the slow-mo window. */
function weights(tl: SinkTimeline): [number, number, number] {
  const s = tl.slowMo
  if (!s || s.to <= s.from) return [1, 0, 0]
  const from = clamp01(s.from)
  const to = clamp01(s.to)
  return [from, (to - from) / Math.max(s.scale, 1e-3), 1 - to]
}

/**
 * Maps elapsed real seconds to sink progress so the slow-mo window plays at `scale`× while the
 * total still lasts `duration` seconds. Monotonic; clamps to [0, 1].
 */
export function sinkProgressAt(elapsed: number, tl: SinkTimeline): number {
  if (tl.duration <= 0) return elapsed > 0 ? 1 : 0
  const u = clamp01(elapsed / tl.duration)
  const [a, b, c] = weights(tl)
  const total = a + b + c
  const ta = a / total
  const tb = b / total
  const s = tl.slowMo
  if (!s || b === 0) return u
  if (u <= ta) return (u / ta) * s.from
  if (u <= ta + tb) return s.from + ((u - ta) / tb) * (s.to - s.from)
  return s.to + ((u - ta - tb) / (1 - ta - tb)) * (1 - s.to)
}

/** Inverse of `sinkProgressAt`: seconds into the sequence at which `progress` is reached. */
export function sinkTimeAt(progress: number, tl: SinkTimeline): number {
  const p = clamp01(progress)
  const [a, b, c] = weights(tl)
  const total = a + b + c
  const s = tl.slowMo
  if (!s || b === 0) return p * tl.duration
  let u: number
  if (p <= s.from) u = (p / s.from) * (a / total)
  else if (p <= s.to) u = a / total + ((p - s.from) / (s.to - s.from)) * (b / total)
  else u = (a + b) / total + ((p - s.to) / (1 - s.to)) * (c / total)
  return u * tl.duration
}

/** Playback rate (progress per second) at `progress`: 1/duration outside slow-mo, scaled inside. */
export function sinkRateAt(progress: number, tl: SinkTimeline): number {
  const [a, b, c] = weights(tl)
  const base = (a + b + c) / tl.duration
  const s = tl.slowMo
  return s && progress >= s.from && progress < s.to ? base * s.scale : base
}
