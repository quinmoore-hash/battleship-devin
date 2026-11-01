/** HTML round mask + crosshair shown while the Spyglass is raised (rendered by DeckHud). */
import { coordLabel } from '../engine'
import { useGameStore } from '../store/gameStore'
import { useSpyglassStore } from './Spyglass'

export function SpyglassOverlay() {
  const up = useSpyglassStore((s) => s.up)
  const cell = useSpyglassStore((s) => s.cell)
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  if (!up) return null
  return (
    <div className="spyglass" data-testid="spyglass-overlay" data-cell={cell ? coordLabel(cell) : undefined} data-reduced-motion={reducedMotion ? 'true' : undefined} aria-hidden>
      <div className="spyglass-mask" />
      <div className="spyglass-ring" />
      <div className="spyglass-cross">
        <i />
        <i />
      </div>
      <div className="spyglass-label" data-testid="spyglass-cell">
        {cell ? `Spyglass on ${coordLabel(cell)} — click to look` : 'Pan across the enemy waters'}
      </div>
      <div className="spyglass-hint">Esc / G lowers the glass</div>
    </div>
  )
}
