import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { clamp01 } from '../math'

/**
 * Frame-rate independent clock for a one-shot effect. Pure so it can be unit-tested; `useEffectTimeline`
 * wraps it in a `useFrame` subscription.
 */
export interface Timeline {
  readonly duration: number
  /** Elapsed seconds, clamped to `duration`. */
  readonly t: number
  /** 0..1 progress. */
  readonly progress: number
  readonly done: boolean
  /** Advance by `dt` seconds (clamped to `maxStep`). Returns true on the frame the timeline finishes. */
  advance(dt: number): boolean
  /** Jump to the end. The next `advance()` reports completion (or immediately if `advance` already ran). */
  skip(): void
  restart(): void
}

export interface TimelineOptions {
  /** Playback speed multiplier (2 = twice as fast). */
  speed?: number
  /** Largest single step in seconds so a background tab does not teleport the effect. Default 0.1. */
  maxStep?: number
}

export function createTimeline(duration: number, opts: TimelineOptions = {}): Timeline {
  const speed = opts.speed ?? 1
  const maxStep = opts.maxStep ?? 0.1
  const len = Math.max(duration, 1e-6)
  let t = 0
  let done = false
  return {
    duration: len,
    get t() {
      return t
    },
    get progress() {
      return clamp01(t / len)
    },
    get done() {
      return done
    },
    advance(dt) {
      if (done) return false
      const step = Math.min(Math.max(dt, 0), maxStep) * speed
      t = Math.min(len, t + step)
      if (t >= len) {
        done = true
        return true
      }
      return false
    },
    skip() {
      t = len
    },
    restart() {
      t = 0
      done = false
    },
  }
}

export interface EffectTimelineOptions extends TimelineOptions {
  /** Called exactly once, on the frame the timeline reaches `duration` (also after `skip()`). */
  onDone?: () => void
  /** Pause the clock (e.g. while the cinematic is paused). */
  paused?: boolean
}

/**
 * A `Timeline` driven by the render loop. Call it *before* the component's own `useFrame` so the clock
 * has advanced when the effect reads `tl.t`. `skip()` finishes on the next frame and still fires `onDone`.
 * Returns the same object for the component's lifetime; it restarts when `duration` changes.
 */
export function useEffectTimeline(duration: number, opts: EffectTimelineOptions = {}): Timeline {
  const { onDone, paused = false, speed, maxStep } = opts
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])
  const tl = useMemo(() => createTimeline(duration, { speed, maxStep }), [duration, speed, maxStep])
  const fired = useRef(false)
  useEffect(() => {
    fired.current = false
  }, [tl])
  useFrame((_, delta) => {
    if (paused || fired.current) return
    // a skipped timeline already sits at `duration`; advancing by 0 reports completion
    if (tl.advance(tl.done ? 0 : delta) && !fired.current) {
      fired.current = true
      onDoneRef.current?.()
    }
  })
  return tl
}
