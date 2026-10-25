import type { CinematicsLevel } from '../store/gameStore'
import { sinkTimeline, type SinkTimeline } from '../vfx/sinking/timeline'
import { CINEMATIC_TIMING, type CinematicEvent } from './types'

/**
 * Pure timelines: every sequence is a list of named beats on one real-time clock. `full` uses the
 * durations in `CINEMATIC_TIMING`; `fast` compresses every beat by the same factor; `off` is a zero-length
 * sequence that resolves immediately. Camera / VFX code reads the beat and its local progress each frame.
 */
export type BeatName =
  | 'approach' // camera swings in behind the battery
  | 'fire' // cannons recoil, flash, smoke
  | 'flight' // ball(s) in the air, follow-cam
  | 'impact' // splash or hit; hold on it
  | 'return' // ease back to the overview
  | 'sink' // the dying ship, slow-mo in the middle
  | 'flyover' // battle-start / victory fly-by
  | 'hold'

export interface Beat {
  name: BeatName
  start: number
  duration: number
}

/** VFX budget tier: `low` (e.g. `?quality=low`, weak GPUs) = one ball per shot, no shake, no slow-mo. */
export type Budget = 'low' | 'high'

export interface Sequence {
  type: CinematicEvent['type']
  level: CinematicsLevel
  budget: Budget
  duration: number
  beats: Beat[]
  /** Clock multiplier applied to the ball flight so the arc lands when the beat ends. */
  speedScale: number
  /** The sink's own progress mapping (slow-mo inside). */
  sink?: SinkTimeline
  /** Normalised windows: [start, end] of real time at which slow motion plays (sink only). */
  slowMo?: { from: number; to: number; scale: number }
  reducedMotion: boolean
}

/** Fraction of `full` each beat of a shot takes; sums to 1. */
export const SHOT_BEATS: Record<Exclude<BeatName, 'sink' | 'flyover' | 'hold'>, number> = {
  approach: 0.2,
  fire: 0.1,
  flight: 0.22,
  impact: 0.28,
  return: 0.2,
}

function beatsFrom(parts: [BeatName, number][], total: number): Beat[] {
  const sum = parts.reduce((m, [, w]) => m + w, 0)
  let t = 0
  return parts.map(([name, w]) => {
    const duration = (w / sum) * total
    const b = { name, start: t, duration }
    t += duration
    return b
  })
}

export function buildSequence(event: CinematicEvent, level: CinematicsLevel, reducedMotion = false, budget: Budget = 'high'): Sequence {
  const timing = CINEMATIC_TIMING[event.type]
  const duration = level === 'off' ? 0 : timing[level]
  const speedScale = level === 'off' ? Infinity : timing.full / duration
  const base = { type: event.type, level, budget, duration, speedScale, reducedMotion }
  if (level === 'off') return { ...base, beats: [] }
  switch (event.type) {
    case 'shot':
      return {
        ...base,
        beats: beatsFrom(
          (Object.keys(SHOT_BEATS) as (keyof typeof SHOT_BEATS)[]).map((k) => [k, SHOT_BEATS[k]]),
          duration,
        ),
      }
    case 'sink': {
      const sink = sinkTimeline(level)
      const slow = !reducedMotion && budget === 'high' && sink.slowMo ? sink.slowMo : undefined
      return {
        ...base,
        beats: [{ name: 'sink', start: 0, duration: sink.duration * 0.85 }, { name: 'return', start: sink.duration * 0.85, duration: sink.duration * 0.15 }],
        duration: sink.duration,
        sink: slow ? sink : { duration: sink.duration },
        slowMo: slow,
      }
    }
    case 'battle-start':
      return { ...base, beats: beatsFrom([['flyover', 0.85], ['return', 0.15]], duration) }
    case 'victory':
      return { ...base, beats: beatsFrom([['flyover', 0.6], ['hold', 0.4]], duration) }
  }
}

export interface BeatState {
  beat: Beat | null
  /** 0..1 within the beat (1 when past the end). */
  k: number
  index: number
}

/** Per-shot VFX budget: cannonballs in the broadside (one Splash / ImpactFlash is spawned for the lead ball only). */
export function maxBalls(seq: Pick<Sequence, 'level' | 'budget'>): number {
  return seq.level === 'fast' || seq.budget === 'low' ? 1 : 3
}

/** Camera shake allowed? Never under reduced motion or on the low tier. */
export const allowShake = (seq: Pick<Sequence, 'budget' | 'reducedMotion'>): boolean => !seq.reducedMotion && seq.budget === 'high'

/** Writes into `out` when given (per-frame callers pass a scratch object to avoid allocating). */
export function beatAt(seq: Sequence, t: number, out: BeatState = { beat: null, k: 1, index: -1 }): BeatState {
  out.beat = null
  out.k = 1
  out.index = -1
  if (seq.beats.length === 0) return out
  for (let i = seq.beats.length - 1; i >= 0; i--) {
    const b = seq.beats[i]
    if (t >= b.start) {
      out.beat = b
      out.k = b.duration > 0 ? Math.min(1, (t - b.start) / b.duration) : 1
      out.index = i
      return out
    }
  }
  out.beat = seq.beats[0]
  out.k = 0
  out.index = 0
  return out
}

export function beatStart(seq: Sequence, name: BeatName): number {
  return seq.beats.find((b) => b.name === name)?.start ?? 0
}

export function beatEnd(seq: Sequence, name: BeatName): number {
  const b = seq.beats.find((b) => b.name === name)
  return b ? b.start + b.duration : 0
}

/** Playback rate at real time `t`: 1 outside slow motion, `scale` inside (sink full only, not reduced motion). */
export function timeScaleAt(seq: Sequence, t: number): number {
  const s = seq.slowMo
  if (!s || !seq.sink || seq.duration <= 0) return 1
  // the slow-mo window is given in sink progress; find the real-time stretch it occupies
  const u = t / seq.duration
  const from = s.from
  const span = (s.to - s.from) / s.scale
  const total = from + span + (1 - s.to)
  const a = from / total
  const b = (from + span) / total
  return u >= a && u < b ? s.scale : 1
}

/**
 * A skippable real-time clock over a sequence. Pure (advance it yourself); `done` flips on the first
 * `advance()` at or past `duration`, so an `off` sequence is done on its first tick. Steps are clamped to
 * `maxStep` so a backgrounded tab resumes mid-beat instead of jumping to the end (0.5 s keeps the clock
 * honest down to 2 fps).
 */
export interface SequenceClock {
  readonly seq: Sequence
  readonly t: number
  readonly done: boolean
  readonly skipped: boolean
  advance(dt: number): boolean
  skip(): void
}

export function createSequenceClock(seq: Sequence, maxStep = 0.5): SequenceClock {
  let t = 0
  let done = false
  let skipped = false
  return {
    seq,
    get t() {
      return t
    },
    get done() {
      return done
    },
    get skipped() {
      return skipped
    },
    advance(dt) {
      if (done) return false
      t = Math.min(seq.duration, t + Math.min(Math.max(dt, 0), maxStep))
      if (t >= seq.duration) {
        done = true
        return true
      }
      return false
    },
    skip() {
      skipped = true
      t = seq.duration
    },
  }
}
