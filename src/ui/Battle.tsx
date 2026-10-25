import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { playSfx } from '../audio'
import {
  coordKey,
  coordLabel,
  enemyView,
  FLEET,
  FLEET_BY_ID,
  isSunk,
  viewGrid,
  type Coord,
  type Difficulty,
  type ShotResult,
} from '../engine'
import { useGameStore } from '../store/gameStore'
import { DevinBubble } from './DevinBubble'
import { FleetStatus } from './FleetStatus'
import { Grid, type GridCellInfo } from './Grid'
import { Modal } from './Modal'
import { ShotLog } from './ShotLog'
import { moodFor, pickLine, type DialogueEvent, type Mood } from './dialogue'
import { PACING } from './pacing'
import { withSfx } from './sfx'

const between = ([a, b]: [number, number]) => a + Math.random() * (b - a)

interface Dialogue {
  text: string
  mood: Mood
}

export function BattleScreen() {
  const otterBoard = useGameStore((s) => s.otterBoard)
  const playerBoard = useGameStore((s) => s.playerBoard)
  const turn = useGameStore((s) => s.turn)
  const difficulty = useGameStore((s) => s.difficulty)
  const events = useGameStore((s) => s.events)
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const fireAt = useGameStore((s) => s.fireAt)
  const otterTurn = useGameStore((s) => s.otterTurn)
  const reset = useGameStore((s) => s.reset)

  const [busy, setBusy] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [confirmQuit, setConfirmQuit] = useState(false)
  const [flash, setFlash] = useState<{ by: 'human' | 'otter'; result: ShotResult } | null>(null)
  const [dialogue, setDialogue] = useState<Dialogue>(() => ({
    text: pickLine('battle-start', { difficulty }),
    mood: moodFor('battle-start'),
  }))
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

  const say = useCallback(
    (event: DialogueEvent, result?: ShotResult) => {
      setDialogue({
        text: pickLine(event, {
          difficulty,
          shipId: result?.shipId,
          coord: result ? coordLabel(result.coord) : undefined,
        }),
        mood: moodFor(event),
      })
    },
    [difficulty],
  )

  const streakOf = (by: 'human' | 'otter') => {
    const all = useGameStore.getState().events.filter((e) => e.by === by)
    let n = 0
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].result.outcome === 'miss') break
      n++
    }
    return n
  }

  const describe = (by: 'human' | 'otter', result: ShotResult) => {
    const state = useGameStore.getState()
    const theirs = by === 'human' ? state.otterBoard : state.playerBoard
    const remaining = theirs.ships.filter((s) => !isSunk(s)).length
    if (result.outcome === 'sunk' && remaining === 1) {
      say(by === 'human' ? 'near-end-player' : 'near-end-devin', result)
    } else if (result.outcome !== 'miss' && streakOf(by) >= 3 && streakOf(by) % 3 === 0) {
      say(by === 'human' ? 'player-streak' : 'devin-streak', result)
    } else {
      say(`${by === 'human' ? 'player' : 'devin'}-${result.outcome}` as DialogueEvent, result)
    }
  }

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
      describe('human', result)
      if (useGameStore.getState().phase !== 'battle') return
      setThinking(true)
      const think = between(reducedMotion ? PACING.think.reduced : PACING.think[difficulty])
      later(() => {
        const otter = otterTurn()
        setThinking(false)
        if (otter) {
          playSfx(otter.outcome === 'miss' ? 'miss' : otter.outcome)
          setFlash({ by: 'otter', result: otter })
          describe('otter', otter)
        }
        later(() => setBusy(false), reducedMotion ? PACING.afterOtter.reduced : PACING.afterOtter.normal)
      }, think)
    }, resultDelay)
  }

  const enemyGrid = useMemo(() => viewGrid(enemyView(otterBoard), otterBoard), [otterBoard])
  const ownGrid = useMemo(() => viewGrid(enemyView(playerBoard), playerBoard), [playerBoard])
  const ownShips = useMemo(() => new Set(playerBoard.ships.flatMap((s) => s.cells.map(coordKey))), [playerBoard])

  const lastHuman = [...events].reverse().find((e) => e.by === 'human')
  const lastOtter = [...events].reverse().find((e) => e.by === 'otter')

  const enemyCell = (c: Coord): GridCellInfo => ({
    state: enemyGrid[c.y][c.x],
    className: lastHuman && coordKey(lastHuman.result.coord) === coordKey(c) ? 'latest' : undefined,
  })
  const ownCell = (c: Coord): GridCellInfo => {
    const v = ownGrid[c.y][c.x]
    return {
      state: v !== 'unknown' ? v : ownShips.has(coordKey(c)) ? 'ship' : 'unknown',
      className: lastOtter && coordKey(lastOtter.result.coord) === coordKey(c) ? 'latest' : undefined,
    }
  }

  const yourTurn = turn === 'human' && !busy
  const statusText = yourTurn
    ? 'Your turn — fire at Devin’s radar'
    : thinking
      ? 'Devin is thinking…'
      : flash
        ? `${flash.by === 'human' ? 'You' : 'Devin'} fired at ${coordLabel(flash.result.coord)}: ${flash.result.outcome}`
        : 'Firing…'

  const shots = events.filter((e) => e.by === 'human')
  const hits = shots.filter((e) => e.result.outcome !== 'miss').length
  const accuracy = shots.length ? Math.round((hits / shots.length) * 100) : 0

  return (
    <section className={`battle${busy ? ' busy' : ''}`} data-testid="battle" data-turn={yourTurn ? 'human' : 'otter'}>
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
          <p>Devin will count this as a win. Your fleet stays where it is if you rematch.</p>
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
            Devin’s waters <small>radar — click to fire</small>
          </h3>
          <Grid testId="enemy-grid" label="Devin's waters" cell={enemyCell} onCell={fire} disabled={!yourTurn} />
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
            Your waters <small>Devin fires here</small>
          </h3>
          <Grid testId="player-grid" label="Your waters" cell={ownCell} />
        </div>

        <FleetStatus board={otterBoard} side="enemy" title="Devin’s fleet" />
        <FleetStatus board={playerBoard} side="player" title="Your fleet" />
        <ShotLog events={events} />
        <div className="bubble-slot">
          <DevinBubble text={dialogue.text} mood={thinking ? 'think' : dialogue.mood} />
        </div>
      </div>
      <span className="sr-only" aria-live="assertive">
        {flash && `${flash.by === 'human' ? 'You' : 'Devin'} fired at ${coordLabel(flash.result.coord)}: ${flash.result.outcome}`}
      </span>
      <span hidden data-testid="fleet-sizes">{FLEET.length}</span>
    </section>
  )
}

const DIFF_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }
