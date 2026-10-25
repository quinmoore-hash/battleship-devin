import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { playSfx } from '../audio'
import {
  coordKey,
  coordLabel,
  enemyView,
  FLEET,
  FLEET_BY_ID,
  viewGrid,
  type Coord,
  type Difficulty,
  type ShotResult,
} from '../engine'
import { useGameStore } from '../store/gameStore'
import { FleetStatus } from './FleetStatus'
import { Grid, type GridCellInfo } from './Grid'
import { Modal } from './Modal'
import { ShotLog } from './ShotLog'
import { PACING } from './pacing'
import { withSfx } from './sfx'

const between = ([a, b]: [number, number]) => a + Math.random() * (b - a)

export function BattleScreen() {
  const enemyBoard = useGameStore((s) => s.enemyBoard)
  const playerBoard = useGameStore((s) => s.playerBoard)
  const turn = useGameStore((s) => s.turn)
  const difficulty = useGameStore((s) => s.difficulty)
  const events = useGameStore((s) => s.events)
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const fireAt = useGameStore((s) => s.fireAt)
  const enemyTurn = useGameStore((s) => s.enemyTurn)
  const reset = useGameStore((s) => s.reset)

  const [busy, setBusy] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [confirmQuit, setConfirmQuit] = useState(false)
  const [flash, setFlash] = useState<{ by: 'human' | 'enemy'; result: ShotResult } | null>(null)
  const timers = useRef<number[]>([])

  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    timers.current.push(id)
    return id
  }, [])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((id) => clearTimeout(id))
  }, [])

  const fire = (c: Coord) => {
    if (busy || turn !== 'human') return
    const result = fireAt(c)
    if (!result) return
    playSfx('fire')
    setBusy(true)
    setFlash(null)
    const resultDelay = reducedMotion ? PACING.result.reduced : PACING.result.normal

    later(() => {
      playSfx(result.outcome === 'miss' ? 'miss' : result.outcome)
      setFlash({ by: 'human', result })
      if (useGameStore.getState().phase !== 'battle') return
      setThinking(true)
      const think = between(reducedMotion ? PACING.think.reduced : PACING.think[difficulty])
      later(() => {
        const enemy = enemyTurn()
        setThinking(false)
        if (enemy) {
          playSfx(enemy.outcome === 'miss' ? 'miss' : enemy.outcome)
          setFlash({ by: 'enemy', result: enemy })
        }
        later(() => setBusy(false), reducedMotion ? PACING.afterEnemy.reduced : PACING.afterEnemy.normal)
      }, think)
    }, resultDelay)
  }

  const enemyGrid = useMemo(() => viewGrid(enemyView(enemyBoard), enemyBoard), [enemyBoard])
  const ownGrid = useMemo(() => viewGrid(enemyView(playerBoard), playerBoard), [playerBoard])
  const ownShips = useMemo(() => new Set(playerBoard.ships.flatMap((s) => s.cells.map(coordKey))), [playerBoard])

  const lastHuman = [...events].reverse().find((e) => e.by === 'human')
  const lastEnemy = [...events].reverse().find((e) => e.by === 'enemy')

  const enemyCell = (c: Coord): GridCellInfo => ({
    state: enemyGrid[c.y][c.x],
    className: lastHuman && coordKey(lastHuman.result.coord) === coordKey(c) ? 'latest' : undefined,
  })
  const ownCell = (c: Coord): GridCellInfo => {
    const v = ownGrid[c.y][c.x]
    return {
      state: v !== 'unknown' ? v : ownShips.has(coordKey(c)) ? 'ship' : 'unknown',
      className: lastEnemy && coordKey(lastEnemy.result.coord) === coordKey(c) ? 'latest' : undefined,
    }
  }

  const yourTurn = turn === 'human' && !busy
  const statusText = yourTurn
    ? 'Your turn — fire at the enemy waters'
    : thinking
      ? 'The enemy is aiming…'
      : flash
        ? `${flash.by === 'human' ? 'You' : 'The enemy'} fired at ${coordLabel(flash.result.coord)}: ${flash.result.outcome}`
        : 'Firing…'

  const shots = events.filter((e) => e.by === 'human')
  const hits = shots.filter((e) => e.result.outcome !== 'miss').length
  const accuracy = shots.length ? Math.round((hits / shots.length) * 100) : 0

  return (
    <section className={`battle${busy ? ' busy' : ''}`} data-testid="battle" data-turn={yourTurn ? 'human' : 'enemy'}>
      <header className="battle-top panel">
        <div className={`turn-indicator ${yourTurn ? 'you' : 'devin'}`} data-testid="turn-indicator">
          <span className="dot" aria-hidden />
          <span data-testid="status">{statusText}</span>
        </div>
        <div className="battle-stats" aria-label="Battle stats">
          <span className="pill">{DIFF_LABEL[difficulty]}</span>
          <span className="pill">Turn {shots.length + 1}</span>
          <span className="pill">{accuracy}% accuracy</span>
          <button
            type="button"
            className="btn ghost small quit"
            data-testid="quit"
            onClick={withSfx(() => setConfirmQuit(true), 'ui-click')}
          >
            Quit
          </button>
        </div>
      </header>
      {confirmQuit && (
        <Modal title="Abandon the battle?" testId="quit-modal" onClose={() => setConfirmQuit(false)}>
          <p>Striking your colours counts as a defeat. You can start a fresh game from the menu.</p>
          <div className="modal-actions">
            <button type="button" className="btn ghost" onClick={withSfx(() => setConfirmQuit(false), 'ui-click')}>
              Keep playing
            </button>
            <button type="button" className="btn primary" data-testid="quit-confirm" onClick={withSfx(reset, 'ui-click')}>
              Quit to menu
            </button>
          </div>
        </Modal>
      )}

      <div className="battle-grid">
        <div className="panel board-panel enemy-panel">
          <h3 className="board-title">
            Enemy waters <small>click a cell to fire</small>
          </h3>
          <Grid testId="enemy-grid" label="Enemy waters" cell={enemyCell} onCell={fire} disabled={!yourTurn} />
          {flash && flash.by === 'human' && !reducedMotion && (
            <div key={`${flash.result.coord.x}-${flash.result.coord.y}`} className={`result-flash ${flash.result.outcome}`} aria-hidden>
              {flash.result.outcome === 'sunk'
                ? `Sank ${FLEET_BY_ID[flash.result.shipId ?? '']?.name ?? 'a ship'}!`
                : flash.result.outcome.toUpperCase()}
            </div>
          )}
        </div>

        <div className="panel board-panel own-panel">
          <h3 className="board-title">
            Your waters <small>the enemy fires here</small>
          </h3>
          <Grid testId="player-grid" label="Your waters" cell={ownCell} />
        </div>

        <FleetStatus board={enemyBoard} side="enemy" title="Enemy fleet" />
        <FleetStatus board={playerBoard} side="player" title="Your fleet" />
        <ShotLog events={events} />
      </div>
      <span className="sr-only" aria-live="assertive">
        {flash && `${flash.by === 'human' ? 'You' : 'The enemy'} fired at ${coordLabel(flash.result.coord)}: ${flash.result.outcome}`}
      </span>
      <span hidden data-testid="fleet-sizes">{FLEET.length}</span>
    </section>
  )
}

const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }
