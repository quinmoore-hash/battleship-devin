/** 2-second startup FPS probe (requestAnimationFrame), reports the median per-window FPS. */
import { fpsSamples, median } from './tier'

export const PROBE_DURATION_MS = 2000

export function runFpsProbe(onDone: (medianFps: number) => void, durationMs = PROBE_DURATION_MS): () => void {
  if (typeof requestAnimationFrame === 'undefined') return () => {}
  const times: number[] = []
  let handle = 0
  let cancelled = false
  const tick = (t: number) => {
    if (cancelled) return
    times.push(t)
    if (t - times[0] < durationMs) handle = requestAnimationFrame(tick)
    else {
      const samples = fpsSamples(times, 250)
      onDone(samples.length ? median(samples) : (times.length * 1000) / Math.max(1, t - times[0]))
    }
  }
  handle = requestAnimationFrame(tick)
  return () => {
    cancelled = true
    cancelAnimationFrame(handle)
  }
}
