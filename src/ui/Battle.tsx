import { useEffect, useMemo, useState } from 'react'
import { playSfx } from '../audio'
import { coordLabel, enemyView, FLEET_BY_ID, hasBeenShot, viewGrid, type Coord, type ShotResult } from '../engine'
import { useGameStore } from '../store/gameStore'
import { useBattleController } from './battleController'
import { FleetStatus } from './FleetStatus'
import { Grid, type GridCellInfo } from './Grid'
import { Modal } from './Modal'
import { CompassRose, Hint } from './Ornaments'
import { ShotLog } from './ShotLog'
import { battleReport, formatDuration } from './stats'
import { useUiStore } from './uiStore'

const outcomeWord = (r: ShotResult) => (r.outcome === 'sunk' ? `sunk the ${r.shipId ? FLEET_BY_ID[r.shipId].name : 'ship'}!` : r.outcome === 'hit' ? 'a hit!' : 'a miss.')

export function BattleScreen() {
  const playerBoard = useGameStore((s) => s.playerBoard)
  const enemyBoard = useGameStore((s) => s.enemyBoard)
  const events = useGameStore((s) => s.events)
  const turn = useGameStore((s) => s.turn)
  const difficulty = useGameStore((s) => s.difficulty)
  const reset = useGameStore((s) => s.reset)
  const startGame = useGameStore((s) => s.startGame)

  const start = useBattleController((s) => s.start)
  const stop = useBattleController((s) => s.stop)
  const fire = useBattleController((s) => s.fire)
  const skip = useBattleController((s) => s.skip)
  const busy = useBattleController((s) => s.busy)
  const beat = useBattleController((s) => s.beat)
  const last = useBattleController((s) => s.last)

  const hover = useUiStore((s) => s.hover)
  const setHover = useUiStore((s) => s.setHover)
  const pending = useUiStore((s) => s.pendingTarget)
  const setPendingTarget = useUiStore((s) => s.setPendingTarget)
  const markBattleStart = useUiStore((s) => s.markBattleStart)
  const battleStartedAt = useUiStore((s) => s.battleStartedAt)
  const hintsSeen = useUiStore((s) => s.hintsSeen)
  const dismissHint = useUiStore((s) => s.dismissHint)
  const cinematics = useGameStore((s) => s.settings.cinematics)

  const [quitting, setQuitting] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    start()
    markBattleStart()
    return () => stop()
  }, [start, stop, markBattleStart])

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' && busy) {
        e.preventDefault()
        skip()
      }
      if (e.key === 'Escape') setPendingTarget(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, skip, setPendingTarget])

  const yourTurn = turn === 'human' && !busy
  const enemyCells = useMemo(() => viewGrid(enemyView(enemyBoard)), [enemyBoard])
  const playerView = useMemo(() => viewGrid(enemyView(playerBoard), playerBoard), [playerBoard])
  const report = useMemo(() => battleReport(events, playerBoard, enemyBoard, battleStartedAt), [events, playerBoard, enemyBoard, battleStartedAt, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const statusText = yourTurn
    ? 'Your turn — fire at the enemy waters'
    : beat.phase === 'enemy-aiming'
      ? 'The enemy is aiming…'
      : beat.phase === 'player-shot' || beat.phase === 'player-sink'
        ? `You fired at ${coordLabel(beat.result!.coord)}: ${outcomeWord(beat.result!)}`
        : beat.phase === 'enemy-shot' || beat.phase === 'enemy-sink'
          ? `The enemy fired at ${coordLabel(beat.result!.coord)}: ${outcomeWord(beat.result!)}`
          : last
            ? `${last.by === 'human' ? 'You' : 'The enemy'} fired at ${coordLabel(last.result.coord)}: ${outcomeWord(last.result)}`
            : 'Firing…'

  const target = pending ?? (hover?.side === 'enemy' ? hover.coord : null)
  const enemyCell = (c: Coord): GridCellInfo => {
    const state = enemyCells[c.y][c.x]
    const aimed = target && target.x === c.x && target.y === c.y
    return { state, className: `${aimed && yourTurn ? 'is-aimed' : ''} ${pending && aimed ? 'is-pending' : ''}`, title: state === 'unknown' ? coordLabel(c) : `${coordLabel(c)} — ${state}` }
  }
  const playerCell = (c: Coord): GridCellInfo => ({ state: playerView[c.y][c.x] })

  const onEnemyCell = (c: Coord) => {
    if (!yourTurn) return
    if (hasBeenShot(enemyBoard, c)) return playSfx('miss')
    void fire(c)
  }

  return (
    <div className="battle hud" data-testid="battle">
      <header className="battle-top">
        <div className={`panel parchment status-panel ${yourTurn ? 'is-yours' : 'is-theirs'}`}>
          <CompassRose size={64} heading={turn === 'human' && !busy ? 0 : beat.phase === 'enemy-aiming' ? 170 : 180} spinning={beat.phase === 'enemy-aiming'} />
          <div className="status-text">
            <span className="status-turn">{yourTurn ? 'Your turn' : turn === 'human' ? 'Reloading' : 'Enemy turn'}</span>
            <p className="status" data-testid="status" role="status" aria-live="polite">
              {statusText}
            </p>
            {busy && cinematics !== 'off' && (
              <button type="button" className="link-btn skip-hint" data-testid="skip-cinematic" onClick={skip}>
                Press Space or click to skip
              </button>
            )}
          </div>
          <div className="status-meta">
            <span>{difficulty}</span>
            <span data-testid="battle-clock">{formatDuration(report.seconds)}</span>
            <span>{report.accuracy}% acc.</span>
          </div>
        </div>
        <div className="battle-buttons">
          <button type="button" className="btn btn-ghost" data-testid="restart" onClick={() => (playSfx('ui-click'), startGame(difficulty))}>
            Restart
          </button>
          <button type="button" className="btn btn-ghost" data-testid="quit" onClick={() => (playSfx('ui-click'), setQuitting(true))}>
            Quit
          </button>
        </div>
      </header>

      <div className="battle-body">
        <aside className="panel parchment side-panel side-left ink-in">
          <FleetStatus board={playerBoard} side="player" title="Your fleet" />
          <FleetStatus board={enemyBoard} side="enemy" title="Enemy fleet" />
        </aside>

        <section className="charts">
          <div className="panel parchment chart-panel chart-enemy" aria-label="Enemy waters">
            <h2 className="panel-title small-title">
              Enemy waters <span className="spyglass" aria-hidden>◎</span>
              {target && yourTurn && <span className="target-readout">Target {coordLabel(target)}</span>}
            </h2>
            <Grid testId="enemy-grid" label="Enemy waters — fire" cell={enemyCell} onCell={onEnemyCell} onHover={(c) => setHover(c ? { side: 'enemy', coord: c } : null)} disabled={!yourTurn} lockResolved />
            {pending && yourTurn && (
              <div className="fire-confirm ink-in" data-testid="fire-confirm">
                <span>Fire at {coordLabel(pending)}?</span>
                <button type="button" className="btn btn-crimson" data-testid="fire-confirm-yes" onClick={() => void fire(pending)}>
                  Fire!
                </button>
                <button type="button" className="btn btn-ghost" data-testid="fire-confirm-no" onClick={() => setPendingTarget(null)}>
                  Cancel
                </button>
              </div>
            )}
          </div>
          <div className="panel parchment chart-panel chart-player" aria-label="Your waters">
            <h2 className="panel-title small-title">Your waters</h2>
            <Grid testId="player-grid" label="Your waters" cell={playerCell} disabled />
          </div>
        </section>

        <aside className="panel parchment side-panel side-right ink-in">
          <h2 className="panel-title small-title">Captain's log</h2>
          <ShotLog events={events} />
        </aside>
      </div>

      <Hint id="battle" seen={hintsSeen.includes('battle')} onDismiss={dismissHint}>
        Hover the enemy waters to aim your spyglass, click to fire. The enemy fleet stays hidden until a ship goes down.
      </Hint>

      {quitting && (
        <Modal title="Strike the colours?" testId="quit-modal" onClose={() => setQuitting(false)}>
          <p>Abandon this battle and return to port? Your progress is lost.</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" data-testid="quit-cancel" onClick={() => setQuitting(false)}>
              Keep playing
            </button>
            <button type="button" className="btn btn-crimson" data-testid="quit-confirm" onClick={() => (playSfx('ui-click'), reset())}>
              Quit to menu
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
