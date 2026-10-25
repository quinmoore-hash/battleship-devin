import { useCallback, useEffect, useMemo, type DragEvent } from 'react'
import { playSfx } from '../audio'
import { FLEET, FLEET_BY_ID, isFleetPlaced, type Coord, type ShipId } from '../engine'
import { useGameStore } from '../store/gameStore'
import { Grid, type GridCellInfo } from './Grid'
import { Hint, WaxSeal } from './Ornaments'
import { footprintAt } from './placementUtils'
import { useUiStore } from './uiStore'

/**
 * Placement HUD. The ship being carried, its orientation and the hovered cell live in `uiStore`
 * so the HTML chart and the 3D ghost always agree: hover a cell on either and both preview.
 */
export function PlacementScreen() {
  const playerBoard = useGameStore((s) => s.playerBoard)
  const placePlayerShip = useGameStore((s) => s.placePlayerShip)
  const removePlayerShip = useGameStore((s) => s.removePlayerShip)
  const autoPlace = useGameStore((s) => s.autoPlacePlayerFleet)
  const confirmPlacement = useGameStore((s) => s.confirmPlacement)
  const reset = useGameStore((s) => s.reset)
  const difficulty = useGameStore((s) => s.difficulty)

  const carrying = useUiStore((s) => s.carrying)
  const orientation = useUiStore((s) => s.orientation)
  const hover = useUiStore((s) => s.hover)
  const setCarrying = useUiStore((s) => s.setCarrying)
  const setHover = useUiStore((s) => s.setHover)
  const rotate = useUiStore((s) => s.rotate)
  const hintsSeen = useUiStore((s) => s.hintsSeen)
  const dismissHint = useUiStore((s) => s.dismissHint)

  const placedIds = useMemo(() => new Set(playerBoard.ships.map((s) => s.spec.id)), [playerBoard])
  const allPlaced = isFleetPlaced(playerBoard)

  // Always carry something while ships remain: the first unplaced one.
  useEffect(() => {
    if (carrying && !placedIds.has(carrying)) return
    const next = FLEET.find((s) => !placedIds.has(s.id))
    setCarrying(next?.id ?? null)
  }, [carrying, placedIds, setCarrying])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') rotate()
    }
    const onContext = (e: MouseEvent) => {
      if (useUiStore.getState().carrying && (e.target as HTMLElement | null)?.closest('canvas, .grid')) {
        e.preventDefault()
        rotate()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('contextmenu', onContext)
    return () => (window.removeEventListener('keydown', onKey), window.removeEventListener('contextmenu', onContext))
  }, [rotate])

  const spec = carrying ? FLEET_BY_ID[carrying] : null
  const hoverCell = hover?.side === 'player' ? hover.coord : null
  const footprint = spec && hoverCell ? footprintAt(playerBoard, spec, hoverCell, orientation) : null
  const previewKeys = useMemo(() => new Set(footprint?.cells.map((c) => `${c.x},${c.y}`)), [footprint])

  const dropAt = useCallback(
    (c: Coord, id: ShipId | null = useUiStore.getState().carrying) => {
      const s = id ? FLEET_BY_ID[id] : null
      if (!s) return
      const f = footprintAt(useGameStore.getState().playerBoard, s, c, useUiStore.getState().orientation)
      if (f.valid && placePlayerShip(s, f.origin, useUiStore.getState().orientation)) {
        playSfx('place')
        setHover(null)
      } else playSfx('miss')
    },
    [placePlayerShip, setHover],
  )

  const onCell = (c: Coord) => {
    const occupied = playerBoard.ships.find((s) => s.cells.some((k) => k.x === c.x && k.y === c.y))
    if (occupied) {
      removePlayerShip(occupied.spec.id)
      setCarrying(occupied.spec.id, occupied.orientation)
      playSfx('ui-click')
      return
    }
    dropAt(c)
  }

  const cellInfo = (c: Coord): GridCellInfo => {
    const key = `${c.x},${c.y}`
    const ship = playerBoard.ships.find((s) => s.cells.some((k) => k.x === c.x && k.y === c.y))
    return {
      state: ship ? 'ship' : 'unknown',
      preview: previewKeys.has(key) ? (footprint!.valid ? 'valid' : 'invalid') : undefined,
      title: ship ? `${ship.spec.name} — click to pick up` : undefined,
    }
  }

  const onDragStart = (e: DragEvent, id: ShipId) => {
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
    setCarrying(id)
  }

  return (
    <div className="placement hud" data-testid="placement">
      <aside className="panel parchment tray-panel ink-in">
        <h2 className="panel-title">
          Muster the fleet <WaxSeal tone="teal" />
        </h2>
        <p className="muted small">Pick a ship, hover your waters and click to anchor it. Drag ships on the water to move them.</p>
        <ul className="tray" aria-label="Ships to place">
          {FLEET.map((s) => {
            const placed = placedIds.has(s.id)
            const active = carrying === s.id
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={`tray-ship ${placed ? 'is-placed' : ''} ${active ? 'is-active' : ''}`}
                  data-testid={`ship-tray-${s.id}`}
                  data-placed={placed}
                  aria-pressed={active}
                  draggable={!placed}
                  onDragStart={(e) => onDragStart(e, s.id)}
                  onClick={() => {
                    if (placed) removePlayerShip(s.id)
                    setCarrying(s.id)
                    playSfx('ui-click')
                  }}
                >
                  <span className="tray-name">{s.name}</span>
                  <span className="silhouette" aria-hidden>
                    {Array.from({ length: s.length }, (_, i) => (
                      <i key={i} />
                    ))}
                  </span>
                  <span className="tray-meta">{placed ? 'anchored' : `${s.length} guns`}</span>
                </button>
              </li>
            )
          })}
        </ul>
        <div className="tray-actions">
          <button type="button" className="btn btn-rope" data-testid="rotate" onClick={() => (playSfx('ui-click'), rotate())} aria-label={`Rotate (currently ${orientation})`}>
            Rotate <kbd>R</kbd> <span className="muted small">{orientation === 'horizontal' ? '↔' : '↕'}</span>
          </button>
          <button type="button" className="btn btn-rope" data-testid="auto-place" onClick={() => (playSfx('place'), autoPlace())}>
            Auto-place
          </button>
          <button type="button" className="btn btn-ghost" data-testid="clear-placement" disabled={playerBoard.ships.length === 0} onClick={() => (playSfx('ui-click'), FLEET.forEach((s) => removePlayerShip(s.id)))}>
            Clear
          </button>
        </div>
        <div className="tray-foot">
          <span className="placed-count" data-testid="placed-count">
            {playerBoard.ships.length}/{FLEET.length} placed
          </span>
          <button type="button" className="btn btn-crimson btn-big" data-testid="confirm-placement" disabled={!allPlaced} onClick={() => (playSfx('ui-click'), confirmPlacement())}>
            Start battle
          </button>
        </div>
        <button type="button" className="link-btn" data-testid="back-to-menu" onClick={() => (playSfx('ui-click'), reset())}>
          ← Back to port
        </button>
      </aside>

      <section className="panel parchment chart-panel ink-in placement-chart" aria-label="Your waters">
        <h2 className="panel-title small-title">Your waters · {difficulty}</h2>
        <Grid testId="player-grid" label="Your waters — place your fleet" cell={cellInfo} onCell={onCell} onHover={(c) => setHover(c ? { side: 'player', coord: c } : null)} onDrop={(c) => dropAt(c)} />
      </section>

      <Hint id="placement" seen={hintsSeen.includes('placement')} onDismiss={dismissHint}>
        Drag a ship across your waters, press <kbd>R</kbd> or right-click to rotate, click a ship to lift it again. Sea stuttering? Lower <strong>Quality</strong> in Settings (⚙).
      </Hint>
    </div>
  )
}
