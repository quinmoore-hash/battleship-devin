import { useCallback, useEffect, useMemo, type DragEvent } from 'react'
import { playSfx } from '../audio'
import { FLEET_BY_ID, FLEET_PRESETS, fleetUnits, isFleetPlaced, uidClass, type Coord } from '../engine'
import { isHotSeat, placementBoard, useGameStore } from '../store/gameStore'
import { Grid, type GridCellInfo } from './Grid'
import { Hint, WaxSeal } from './Ornaments'
import { footprintAt } from './placementUtils'
import { isCoarsePointer, useUiStore } from './uiStore'

/**
 * Placement HUD. The ship being carried, its orientation and the hovered cell live in `uiStore`
 * so the HTML chart and the 3D ghost always agree: hover a cell on either and both preview.
 */
export function PlacementScreen() {
  // hot-seat: each captain musters on their own board in turn (`placing`); single player always the pirates'
  const playerBoard = useGameStore(placementBoard)
  const players = useGameStore((s) => s.players)
  const placing = useGameStore((s) => s.placing)
  const hotSeat = isHotSeat(players)
  const captain = players[placing].name
  const placePlayerShip = useGameStore((s) => s.placePlayerShip)
  const removePlayerShip = useGameStore((s) => s.removePlayerShip)
  const autoPlace = useGameStore((s) => s.autoPlacePlayerFleet)
  const confirmPlacement = useGameStore((s) => s.confirmPlacement)
  const reset = useGameStore((s) => s.reset)
  const difficulty = useGameStore((s) => s.difficulty)
  const humanBoard = useGameStore((s) => s.playerBoard)
  const enemyBoard = useGameStore((s) => s.enemyBoard)

  const carrying = useUiStore((s) => s.carrying)
  const orientation = useUiStore((s) => s.orientation)
  const hover = useUiStore((s) => s.hover)
  const setCarrying = useUiStore((s) => s.setCarrying)
  const setHover = useUiStore((s) => s.setHover)
  const rotate = useUiStore((s) => s.rotate)
  const hintsSeen = useUiStore((s) => s.hintsSeen)
  const dismissHint = useUiStore((s) => s.dismissHint)

  const blackFlag = useGameStore((s) => s.modes.blackFlag)
  const fleet = useGameStore((s) => s.fleets[s.placing])
  const preset = useGameStore((s) => s.fleetPresets[s.placing])
  const setFleetPreset = useGameStore((s) => s.setFleetPreset)
  const units = useMemo(() => fleetUnits(fleet), [fleet])
  const placedIds = useMemo(() => new Set(playerBoard.ships.map((s) => s.uid)), [playerBoard])
  const allPlaced = isFleetPlaced(playerBoard, fleet)

  // Always carry something while ships remain: the first unplaced one.
  useEffect(() => {
    if (carrying && !placedIds.has(carrying) && units.some((u) => u.uid === carrying)) return
    const next = units.find((u) => !placedIds.has(u.uid))
    setCarrying(next?.uid ?? null)
  }, [carrying, placedIds, setCarrying, units])

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

  const spec = carrying ? FLEET_BY_ID[uidClass(carrying)] : null
  const hoverCell = hover?.side === 'player' ? hover.coord : null
  const footprint = spec && hoverCell ? footprintAt(playerBoard, spec, hoverCell, orientation) : null
  const previewKeys = useMemo(() => new Set(footprint?.cells.map((c) => `${c.x},${c.y}`)), [footprint])

  const dropAt = useCallback(
    (c: Coord, uid: string | null = useUiStore.getState().carrying) => {
      const s = uid ? FLEET_BY_ID[uidClass(uid)] : null
      if (!s || !uid) return
      const f = footprintAt(placementBoard(useGameStore.getState()), s, c, useUiStore.getState().orientation)
      if (f.valid && placePlayerShip(s, f.origin, useUiStore.getState().orientation, uid)) {
        playSfx('place')
        setHover(null)
      } else playSfx('miss')
    },
    [placePlayerShip, setHover],
  )

  const onCell = (c: Coord) => {
    const occupied = playerBoard.ships.find((s) => s.cells.some((k) => k.x === c.x && k.y === c.y))
    if (occupied) {
      removePlayerShip(occupied.uid)
      setCarrying(occupied.uid, occupied.orientation)
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

  const onDragStart = (e: DragEvent, id: string) => {
    e.dataTransfer.setData('text/plain', id)
    e.dataTransfer.effectAllowed = 'move'
    setCarrying(id)
  }

  return (
    <div className="placement hud" data-testid="placement" data-placing={placing}>
      <aside className="panel parchment tray-panel ink-in">
        <h2 className="panel-title" data-testid="placement-title">
          {hotSeat ? `${captain}, muster your fleet` : 'Muster the fleet'} <WaxSeal tone={placing === 'enemy' ? 'crimson' : 'teal'} />
        </h2>
        <p className="muted small">
          {isCoarsePointer()
            ? 'Pick a ship, then tap your waters to anchor it. Drag ships on the water to move them.'
            : 'Pick a ship, hover your waters and click to anchor it. Drag ships on the water to move them.'}
        </p>
        {blackFlag && (
          <div className="fleet-picker" data-testid="fleet-picker" role="radiogroup" aria-label="Pick your fleet">
            <strong className="fleet-picker-title">Black Flag — pick your fleet</strong>
            {FLEET_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={preset === p.id}
                className={`fleet-preset ${preset === p.id ? 'is-selected' : ''}`}
                data-testid={`fleet-preset-${p.id}`}
                onClick={() => {
                  if (preset === p.id) return
                  playSfx('ui-click')
                  setFleetPreset(p.id)
                  setCarrying(null)
                }}
              >
                <span className="fleet-preset-name">{p.name}</span>
                <span className="fleet-preset-ships" aria-hidden>
                  {p.ships.map((id, i) => (
                    <i key={i} style={{ width: `${FLEET_BY_ID[id].length * 0.42}em` }} />
                  ))}
                </span>
                <small>{p.description}</small>
              </button>
            ))}
          </div>
        )}
        <ul className="tray" aria-label="Ships to place">
          {units.map(({ spec: s, uid }) => {
            const placed = placedIds.has(uid)
            const active = carrying === uid
            return (
              <li key={uid}>
                <button
                  type="button"
                  className={`tray-ship ${placed ? 'is-placed' : ''} ${active ? 'is-active' : ''}`}
                  data-testid={`ship-tray-${uid}`}
                  data-placed={placed}
                  aria-pressed={active}
                  draggable={!placed}
                  onDragStart={(e) => onDragStart(e, uid)}
                  onClick={() => {
                    if (placed) removePlayerShip(uid)
                    setCarrying(uid)
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
          <button type="button" className="btn btn-ghost" data-testid="clear-placement" disabled={playerBoard.ships.length === 0} onClick={() => (playSfx('ui-click'), playerBoard.ships.forEach((s) => removePlayerShip(s.uid)))}>
            Clear
          </button>
        </div>
        <div className="tray-foot">
          <span className="placed-count" data-testid="placed-count">
            {playerBoard.ships.length}/{units.length} placed
          </span>
          <button type="button" className="btn btn-crimson btn-big" data-testid="confirm-placement" disabled={!allPlaced} onClick={() => (playSfx('ui-click'), confirmPlacement())}>
            {hotSeat && !isFleetPlaced(placing === 'human' ? enemyBoard : humanBoard) ? 'Ready — pass the deck' : 'Start battle'}
          </button>
        </div>
        <button type="button" className="link-btn" data-testid="back-to-menu" onClick={() => (playSfx('ui-click'), reset())}>
          ← Back to port
        </button>
      </aside>

      <section className="panel parchment chart-panel ink-in placement-chart" aria-label="Your waters">
        <h2 className="panel-title small-title">{hotSeat ? `${captain}'s waters · ${placing === 'human' ? 'pirate' : 'navy'} colours` : `Your waters · ${difficulty}`}</h2>
        <Grid testId="player-grid" label="Your waters — place your fleet" cell={cellInfo} onCell={onCell} onHover={(c) => setHover(c ? { side: 'player', coord: c } : null)} onDrop={(c) => dropAt(c)} />
      </section>

      <Hint id="placement" seen={hintsSeen.includes('placement')} onDismiss={dismissHint}>
        {isCoarsePointer() ? (
          <>Drag a ship across your waters, use the Rotate button to turn it, tap a ship to lift it again.</>
        ) : (
          <>
            Drag a ship across your waters, press <kbd>R</kbd> or right-click to rotate, click a ship to lift it again.
          </>
        )}{' '}
        Sea stuttering? Lower <strong>Quality</strong> in Settings (⚙).
      </Hint>
    </div>
  )
}
