import { useEffect } from 'react'
import { useGameStore } from '../../store/gameStore'
import { Announcer } from './Announcer'
import './a11y.css'

/** Name of the DOM event dispatched when the player presses Space to skip a cinematic. */
export const SKIP_CINEMATIC_EVENT = 'battleship:skip-cinematic'

/**
 * Cross-cutting accessibility wiring, mounted once near the root:
 *  - `prefers-reduced-motion: reduce` → `settings.reducedMotion = true` + `cinematics = 'fast'` (live, follows OS changes)
 *  - mirrors `settings.colorblind` / `reducedMotion` / `quality` onto `<html data-*>` so CSS can key off them
 *  - Space (outside inputs/buttons) dispatches `SKIP_CINEMATIC_EVENT` on `window`
 *  - hosts the shared screen-reader live regions (`announce()`)
 */
export function A11yBootstrap() {
  const colorblind = useGameStore((s) => s.settings.colorblind)
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const quality = useGameStore((s) => s.settings.quality)
  const updateSettings = useGameStore((s) => s.updateSettings)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const apply = () => {
      if (mq.matches) updateSettings({ reducedMotion: true, cinematics: 'fast' })
    }
    apply()
    mq.addEventListener?.('change', apply)
    return () => mq.removeEventListener?.('change', apply)
  }, [updateSettings])

  useEffect(() => {
    const el = document.documentElement
    el.dataset.colorblind = String(colorblind)
    el.dataset.reducedMotion = String(reducedMotion)
    el.dataset.quality = quality
  }, [colorblind, reducedMotion, quality])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' && e.code !== 'Space') return
      const t = e.target as HTMLElement | null
      if (t && (t.closest('button, input, select, textarea, a, [role="button"], [role="switch"], [contenteditable="true"]') !== null)) return
      e.preventDefault()
      window.dispatchEvent(new CustomEvent(SKIP_CINEMATIC_EVENT))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return <Announcer />
}
