import { useEffect } from 'react'
import {
  coordLabel,
  enemyView,
  FLEET,
  isFleetPlaced,
  viewGrid,
  type CellView,
  type Coord,
  type Difficulty,
} from '../engine'
import { useGameStore } from '../store/gameStore'

/**
 * Minimal functional UI so the game is playable end to end from day one.
 * The UI child session replaces this with the real menus, HUD, drag-and-drop placement,
 * otter commentary and win/lose screens. Keep the data-testid attributes: e2e tests use them.
 */

const DIFFICULTIES: { id: Difficulty; label: string; blurb: string }[] = [
  { id: 'easy', label: 'Easy', blurb: 'Devin is napping on his back.' },
  { id: 'medium', label: 'Medium', blurb: 'Devin is paying attention.' },
  { id: 'hard', label: 'Hard', blurb: 'Devin has a clipboard and a grudge.' },
]

export function GameUI() {
  const phase = useGameStore((s) => s.phase)
  return (
    <div className="ui-root" data-testid="ui-root" data-phase={phase}>
      {phase === 'menu' && <MainMenu />}
      {phase === 'placement' && <PlacementScreen />}
      {phase === 'battle' && <BattleScreen />}
      {phase === 'gameover' && <GameOverScreen />}
    </div>
  )
}

function MainMenu() {
  const startGame = useGameStore((s) => s.startGame)
  return (
    <section className="panel" data-testid="main-menu">
      <h1>Devin the Otter: Battleship</h1>
      <p>Pick how awake Devin is today.</p>
      <div className="row">
        {DIFFICULTIES.map((d) => (
          <button key={d.id} data-testid={`difficulty-${d.id}`} onClick={() => startGame(d.id)}>
            <strong>{d.label}</strong>
            <span>{d.blurb}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function PlacementScreen() {
  const playerBoard = useGameStore((s) => s.playerBoard)
  const autoPlace = useGameStore((s) => s.autoPlacePlayerFleet)
  const confirm = useGameStore((s) => s.confirmPlacement)
  const ready = isFleetPlaced(playerBoard)
  const occupied = new Set(playerBoard.ships.flatMap((s) => s.cells.map((c) => `${c.x},${c.y}`)))
  return (
    <section className="panel" data-testid="placement">
      <h2>Place your fleet</h2>
      <p>
        {playerBoard.ships.length}/{FLEET.length} ships placed
      </p>
      <Grid
        testId="player-grid"
        render={(c) => (occupied.has(`${c.x},${c.y}`) ? 'ship' : 'unknown')}
      />
      <div className="row">
        <button data-testid="auto-place" onClick={autoPlace}>
          Auto-place
        </button>
        <button data-testid="confirm-placement" onClick={confirm} disabled={!ready}>
          Start battle
        </button>
      </div>
    </section>
  )
}

function BattleScreen() {
  const otterBoard = useGameStore((s) => s.otterBoard)
  const playerBoard = useGameStore((s) => s.playerBoard)
  const turn = useGameStore((s) => s.turn)
  const fireAt = useGameStore((s) => s.fireAt)
  const otterTurn = useGameStore((s) => s.otterTurn)
  const events = useGameStore((s) => s.events)

  useEffect(() => {
    if (turn !== 'otter') return
    const t = setTimeout(otterTurn, 600)
    return () => clearTimeout(t)
  }, [turn, otterTurn])

  const enemyGrid = viewGrid(enemyView(otterBoard), otterBoard)
  const ownGrid = viewGrid(enemyView(playerBoard), playerBoard)
  const ownShips = new Set(playerBoard.ships.flatMap((s) => s.cells.map((c) => `${c.x},${c.y}`)))
  const last = events[events.length - 1]

  return (
    <section className="panel battle" data-testid="battle">
      <div>
        <h2>Devin's waters</h2>
        <Grid
          testId="enemy-grid"
          render={(c) => enemyGrid[c.y][c.x]}
          onCell={turn === 'human' ? fireAt : undefined}
        />
      </div>
      <div>
        <h2>Your waters</h2>
        <Grid
          testId="player-grid"
          render={(c) =>
            ownGrid[c.y][c.x] !== 'unknown' ? ownGrid[c.y][c.x] : ownShips.has(`${c.x},${c.y}`) ? 'ship' : 'unknown'
          }
        />
      </div>
      <p data-testid="status">
        {turn === 'human' ? 'Your turn' : 'Devin is thinking...'}
        {last && ` — ${last.by === 'human' ? 'You' : 'Devin'} fired at ${coordLabel(last.result.coord)}: ${last.result.outcome}`}
      </p>
    </section>
  )
}

function GameOverScreen() {
  const winner = useGameStore((s) => s.winner)
  const reset = useGameStore((s) => s.reset)
  return (
    <section className="panel" data-testid="gameover" data-winner={winner}>
      <h1>{winner === 'human' ? 'You sank the otter fleet!' : 'Devin wins. Squeak.'}</h1>
      <button data-testid="play-again" onClick={reset}>
        Play again
      </button>
    </section>
  )
}

type GridCell = CellView | 'ship'

function Grid({
  testId,
  render,
  onCell,
}: {
  testId: string
  render: (c: Coord) => GridCell
  onCell?: (c: Coord) => void
}) {
  const size = 10
  return (
    <div className="grid" data-testid={testId} role="grid">
      {Array.from({ length: size * size }, (_, i) => {
        const c = { x: i % size, y: Math.floor(i / size) }
        const state = render(c)
        return (
          <button
            key={i}
            role="gridcell"
            className={`cell cell-${state}`}
            data-testid={`${testId}-${c.x}-${c.y}`}
            data-state={state}
            aria-label={coordLabel(c)}
            disabled={!onCell || state === 'miss' || state === 'hit' || state === 'sunk'}
            onClick={onCell ? () => onCell(c) : undefined}
          />
        )
      })}
    </div>
  )
}
