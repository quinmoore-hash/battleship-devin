import { useEffect } from 'react'
import { useGameStore } from '../store/gameStore'
import { usePerfStore } from './store'
import { WATCHDOG, watchdogStep } from './tier'

const WINDOW_MS = 500

/**
 * Mount once near the root. While a battle is on and quality is `auto`, measures FPS in 500 ms
 * windows (requestAnimationFrame) and, when it stays under `WATCHDOG.minFps` for `sustainMs`,
 * drops the tier by one — once per session — and raises the "lowered quality" notice.
 */
export function FpsWatchdog() {
  const phase = useGameStore((s) => s.phase)
  const setting = usePerfStore((s) => s.setting)
  const autoLowered = usePerfStore((s) => s.autoLowered)
  const active = phase === 'battle' && setting === 'auto' && !autoLowered
  useEffect(() => {
    if (!active || typeof requestAnimationFrame === 'undefined') return
    let handle = 0
    let start = -1
    let windowStart = 0
    let frames = 0
    let belowMs = 0
    const tick = (t: number) => {
      if (start < 0) {
        start = t
        windowStart = t
      } else if (document.hidden) {
        windowStart = t
        frames = 0
        belowMs = 0
      } else {
        frames++
        const span = t - windowStart
        if (span >= WINDOW_MS) {
          if (t - start > WATCHDOG.graceMs) belowMs = watchdogStep(belowMs, (frames * 1000) / span, span)
          windowStart = t
          frames = 0
          if (belowMs >= WATCHDOG.sustainMs) {
            usePerfStore.getState().autoLower()
            return
          }
        }
      }
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [active])
  return null
}
