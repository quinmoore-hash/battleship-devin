import { useCallback, useEffect, useMemo, useState } from 'react'
import { playSfx } from '../audio'
import {
  canPlace,
  coordKey,
  FLEET,
  FLEET_BY_ID,
  isFleetPlaced,
  shipCells,
  type Coord,
  type Orientation,
  type ShipId,
} from '../engine'
import { useGameStore } from '../store/gameStore'
import { DevinBubble } from './DevinBubble'
import { pickLine } from './dialogue'
import { Grid, type GridCellInfo } from './Grid'
import { clampOrigin } from './placementUtils'
import { withSfx } from './sfx'


export function PlacementScreen() {
  const playerBoard = useGameStore((s) => s.playerBoard)
  const difficulty = useGameStore((s) => s.difficulty)
  const placePlayerShip = useGameStore((s) => s.placePlayerShip)
  const removePlayerShip = useGameStore((s) => s.removePlayerShip)
  const autoPlace = useGameStore((s) => s.autoPlacePlayerFleet)
  const confirm = useGameStore((s) => s.confirmPlacement)

  const placedIds = useMemo(() => new Set(playerBoard.ships.map((s) => s.spec.id)), [playerBoard])
  const firstUnplaced = FLEET.find((s) => !placedIds.has(s.id))?.id ?? null

  const [picked, setSelected] = useState<ShipId | null>(null)
  const selected = picked && !placedIds.has(picked) ? picked : firstUnplaced
  const [orientation, setOrientation] = useState<Orientation>('horizontal')
  const [hover, setHover] = useState<Coord | null>(null)
  const [line] = useState(() => pickLine('placement', { difficulty }))

  const rotate = useCallback(() => {
    playSfx('ui-click')
    setOrientation((o) => (o === 'horizontal' ? 'vertical' : 'horizontal'))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'r' && !(e.target instanceof HTMLInputElement)) rotate()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rotate])

  const spec = selected ? FLEET_BY_ID[selected] : undefined
  const preview = useMemo(() => {
    if (!spec || !hover) return null
    const origin = clampOrigin(hover, spec.length, orientation)
    const valid = canPlace(playerBoard, spec, origin, orientation)
    return { origin, valid, cells: new Set(shipCells(spec, origin, orientation).map(coordKey)) }
  }, [spec, hover, orientation, playerBoard])

  const shipAtCell = useMemo(() => {
    const m = new Map<string, ShipId>()
    for (const s of playerBoard.ships) for (const c of s.cells) m.set(coordKey(c), s.spec.id)
    return m
  }, [playerBoard])

  const pickUp = (id: ShipId) => {
    const ship = playerBoard.ships.find((s) => s.spec.id === id)
    if (ship) setOrientation(ship.orientation)
    removePlayerShip(id)
    setSelected(id)
    playSfx('ui-click')
  }

  const dropAt = (c: Coord) => {
    if (!spec) return
    const origin = clampOrigin(c, spec.length, orientation)
    if (placePlayerShip(spec, origin, orientation)) {
      playSfx('place')
      setHover(null)
    }
  }

  const onCell = (c: Coord) => {
    const existing = shipAtCell.get(coordKey(c))
    if (existing) return pickUp(existing)
    dropAt(c)
  }

  const cell = (c: Coord): GridCellInfo => {
    const key = coordKey(c)
    const id = shipAtCell.get(key)
    return {
      state: id ? 'ship' : 'unknown',
      preview: preview?.cells.has(key) ? (preview.valid ? 'valid' : 'invalid') : undefined,
      title: id ? `${FLEET_BY_ID[id].name} — click to pick up` : undefined,
    }
  }

  const ready = isFleetPlaced(playerBoard)

  return (
    <section className="placement" data-testid="placement">
      <header className="screen-head">
        <div>
          <h2>Place your fleet</h2>
          <p className="muted">
            {spec
              ? `Placing ${spec.name} (${spec.length}) · ${orientation} · press R to rotate`
              : ready
                ? 'All ships placed. Ready when you are.'
                : 'Pick a ship from the tray.'}
          </p>
        </div>
        <span className="pill" data-testid="placed-count">
          {playerBoard.ships.length}/{FLEET.length} placed
        </span>
      </header>

      <div className="placement-body">
        <aside className="panel ship-tray" data-testid="ship-tray" aria-label="Ship tray">
          <h3>Your fleet</h3>
          <ul>
            {FLEET.map((s) => {
              const placed = placedIds.has(s.id)
              const isSel = selected === s.id
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`tray-ship${placed ? ' placed' : ''}${isSel ? ' selected' : ''}`}
                    data-testid={`ship-tray-${s.id}`}
                    data-placed={placed}
                    aria-pressed={isSel}
                    draggable={!placed}
                    onDragStart={(e) => {
                      setSelected(s.id)
                      e.dataTransfer.setData('text/plain', s.id)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onClick={() => (placed ? pickUp(s.id) : (playSfx('ui-click'), setSelected(s.id)))}
                  >
                    <span className="silhouette" aria-hidden>
                      {Array.from({ length: s.length }, (_, i) => (
                        <i key={i} />
                      ))}
                    </span>
                    <span className="meta">
                      <strong>{s.name}</strong>
                      <small>{s.description}</small>
                    </span>
                    <span className="state">{placed ? 'Placed' : isSel ? 'Selected' : `${s.length} cells`}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="tray-actions">
            <button type="button" className="btn ghost" data-testid="rotate" onClick={rotate}>
              Rotate <kbd>R</kbd>
            </button>
            <button type="button" className="btn ghost" data-testid="auto-place" onClick={withSfx(autoPlace, 'place')}>
              Auto-place
            </button>
            <button
              type="button"
              className="btn ghost"
              data-testid="clear-placement"
              disabled={playerBoard.ships.length === 0}
              onClick={withSfx(() => playerBoard.ships.forEach((s) => removePlayerShip(s.spec.id)))}
            >
              Clear
            </button>
          </div>
        </aside>

        <div className="panel board-panel">
          <Grid
            testId="player-grid"
            label="Your waters"
            cell={cell}
            onCell={onCell}
            onHover={setHover}
            onDrop={dropAt}
            lockResolved={false}
          />
          <div className="legend" aria-hidden>
            <span><i className="sw sw-valid" /> valid</span>
            <span><i className="sw sw-invalid" /> blocked</span>
            <span><i className="sw sw-ship" /> placed (click to pick up)</span>
          </div>
        </div>
      </div>

      <footer className="screen-foot">
        <DevinBubble text={line} mood="taunt" compact />
        <button
          type="button"
          className="btn primary big"
          data-testid="confirm-placement"
          disabled={!ready}
          onClick={withSfx(confirm)}
        >
          Start battle
        </button>
      </footer>
    </section>
  )
}
