import { useEffect, useMemo, useState } from 'react'
import { playSfx } from '../audio'
import { useDirector } from '../cinematics'
import { broadsideCells, coordKey, coordLabel, enemyView, FLEET_BY_ID, hasBeenShot, sameCoord, viewGrid, type Coord, type Orientation, type Player, type ShotResult } from '../engine'
import { isHotSeat, other, treasureFound, useGameStore } from '../store/gameStore'
import { SKIP_CINEMATIC_EVENT } from '../perf/a11y/A11yBootstrap'
import { useBattleController } from './battleController'
import { FleetStatus } from './FleetStatus'
import { PowerShots, type Armed } from './PowerShots'
import { Grid, type GridCellInfo } from './Grid'
import { Modal } from './Modal'
import { CompassRose, Hint } from './Ornaments'
import { ShotLog } from './ShotLog'
import { battleReport, formatDuration } from './stats'
import { isCoarsePointer, useUiStore } from './uiStore'

const outcomeWord = (r: ShotResult) => (r.outcome === 'sunk' ? `sunk the ${r.shipId ? FLEET_BY_ID[r.shipId].name : 'ship'}!` : r.outcome === 'hit' ? 'a hit!' : 'a miss.')

/** Status / announcer line for one shot. A shot lost in the storm says so plainly, or players read it as a bug. */
const shotLine = (by: Player, r: ShotResult, who: (side: Player) => string = (side) => (side === 'human' ? 'You' : 'The enemy'), hotSeat = false): string => {
  if (r.outcome === 'lost') {
    // hot-seat: the deck passes after a lost shot too, so name the captain instead of "fire again"
    if (hotSeat) return `${who(by)}'s shot at ${coordLabel(r.coord)} was lost in the storm`
    return by === 'human' ? `Lost in the storm — fire again at ${coordLabel(r.coord)}` : 'Enemy shot lost in the storm'
  }
  return `${who(by)} fired at ${coordLabel(r.coord)}: ${outcomeWord(r)}`
}

export function BattleScreen() {
  const playerBoard = useGameStore((s) => s.playerBoard)
  const enemyBoard = useGameStore((s) => s.enemyBoard)
  const events = useGameStore((s) => s.events)
  const turn = useGameStore((s) => s.turn)
  const difficulty = useGameStore((s) => s.difficulty)
  const blackFlag = useGameStore((s) => s.modes.blackFlag)
  const fleets = useGameStore((s) => s.fleets)
  const powerShots = useGameStore((s) => s.powerShots)
  const spied = useGameStore((s) => s.spied)
  const spyAt = useGameStore((s) => s.spyAt)
  const [armed, setArmed] = useState<Armed>('shot')
  const [broadsideDir, setBroadsideDir] = useState<Orientation>('horizontal')
  const [spyNote, setSpyNote] = useState<string | null>(null)
  const reset = useGameStore((s) => s.reset)
  const startGame = useGameStore((s) => s.startGame)
  // hot-seat ("Two captains"): the HUD shows the active captain's side; the curtain (`handoff`) hides both charts
  const players = useGameStore((s) => s.players)
  const hotSeat = isHotSeat(players)
  const perspective = useGameStore((s) => s.perspective)
  const handoff = useGameStore((s) => s.handoff)
  const foeSide = other(perspective)
  const me = hotSeat ? players[perspective].name : 'You'
  const foeName = hotSeat ? players[foeSide].name : 'The enemy'
  const turnWord = hotSeat ? `${me}'s turn` : 'Your turn'
  const ownBoard = perspective === 'human' ? playerBoard : enemyBoard
  const foeBoard = perspective === 'human' ? enemyBoard : playerBoard

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
      if (e.key === 'Escape') {
        setPendingTarget(null)
        setArmed('shot')
      }
      if (!blackFlag || e.altKey || e.ctrlKey || e.metaKey || (e.target as HTMLElement | null)?.closest('input, textarea')) return
      const k = e.key.toLowerCase()
      const power = useGameStore.getState().powerShots[perspective]
      if (k === 'b' && power.broadside) setArmed((a) => (a === 'broadside' ? 'shot' : 'broadside'))
      if (k === 'g' && power.spyglass) setArmed((a) => (a === 'spyglass' ? 'shot' : 'spyglass'))
      if (k === 'r') setBroadsideDir((o) => (o === 'horizontal' ? 'vertical' : 'horizontal'))
    }
    const onSkipEvent = () => skip()
    window.addEventListener('keydown', onKey)
    window.addEventListener(SKIP_CINEMATIC_EVENT, onSkipEvent)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(SKIP_CINEMATIC_EVENT, onSkipEvent)
    }
  }, [busy, skip, setPendingTarget, blackFlag, perspective])

  const yourTurn = turn === perspective && (hotSeat || turn === 'human') && !busy && !handoff
  // while the director plays, the side panels step back so the cannonball / sinking is not hidden behind parchment
  const cinematic = useDirector((s) => s.busy)
  const active = useDirector((s) => s.active)
  // whose volley is on screen: the turn-flow beat first, then the director's active event (`by` / sunk ship's
  // `owner`) while a cinematic outlives its beat — never the game-store `turn`, which has already flipped (BUG-304)
  const sideInPlay =
    beat.phase === 'player-shot' || beat.phase === 'player-sink'
      ? 'human'
      : beat.phase === 'enemy-aiming' || beat.phase === 'enemy-shot' || beat.phase === 'enemy-sink'
        ? 'enemy'
        : active?.event.type === 'shot'
          ? active.event.by
          : active?.event.type === 'sink'
            ? active.event.owner === 'enemy'
              ? 'human'
              : 'enemy'
            : null
  const nameOf = (side: 'human' | 'enemy') => players[side].name
  const turnLabel = yourTurn
    ? hotSeat
      ? `${me}'s turn`
      : 'Your turn'
    : beat.phase === 'intro'
      ? 'Battle stations'
      : beat.phase === 'handoff' || handoff
        ? 'Change of watch'
        : hotSeat && sideInPlay
          ? `${nameOf(sideInPlay)}'s broadside`
          : sideInPlay === 'human'
            ? 'Your broadside'
            : sideInPlay === 'enemy'
              ? 'Enemy turn'
              : beat.phase === 'victory'
                ? 'Battle over'
                : turn === 'human'
                  ? 'Reloading'
                  : 'Enemy turn'
  const touch = isCoarsePointer()

  // first-play hint: gone after the first shot or ~12 s, not pinned over the action for the whole game (BUG-307)
  const battleHintSeen = hintsSeen.includes('battle')
  useEffect(() => {
    if (battleHintSeen) return
    if (events.length > 0) return dismissHint('battle')
    const t = setTimeout(() => dismissHint('battle'), 12_000)
    return () => clearTimeout(t)
  }, [battleHintSeen, events.length, dismissHint])
  const enemyCells = useMemo(() => viewGrid(enemyView(foeBoard)), [foeBoard])
  const playerView = useMemo(() => viewGrid(enemyView(ownBoard), ownBoard), [ownBoard])
  const ownCells = useMemo(() => new Set(ownBoard.ships.flatMap((s) => s.cells.map((c) => `${c.x},${c.y}`))), [ownBoard])
  const report = useMemo(() => battleReport(events, playerBoard, enemyBoard, battleStartedAt), [events, playerBoard, enemyBoard, battleStartedAt, tick]) // eslint-disable-line react-hooks/exhaustive-deps

  const chestsBy = (by: 'human' | 'enemy') => new Set(events.filter((e) => e.kind === 'treasure' && e.by === by).map((e) => coordKey(e.result.coord)))
  const treasureCells = useMemo(() => chestsBy(perspective), [events]) // eslint-disable-line react-hooks/exhaustive-deps
  const enemyChests = useMemo(() => chestsBy(foeSide), [events]) // eslint-disable-line react-hooks/exhaustive-deps
  const spiedByMe = useMemo(() => new Map(spied[perspective].map((m) => [coordKey(m.coord), m.ship])), [spied])
  const treasureFoundByMe = treasureFound(events, perspective)
  const lastEvent = events[events.length - 1]
  const treasureAgain = yourTurn && lastEvent?.by === perspective && lastEvent.kind === 'treasure'
  const who = (side: 'human' | 'enemy') => (hotSeat ? nameOf(side) : side === 'human' ? 'You' : 'The enemy')
  const statusText = yourTurn
    ? treasureAgain
      ? `${turnWord} — treasure at ${coordLabel(lastEvent.result.coord)}, fire again!`
      : spyNote
        ? `${turnWord} — ${spyNote}`
        : armed === 'broadside'
          ? `${turnWord} — Broadside armed, pick the centre cell (${broadsideDir === 'horizontal' ? 'row' : 'column'}, R rotates)`
          : armed === 'spyglass'
            ? `${turnWord} — Spyglass armed, pick a cell to look at`
            : hotSeat ? `${me}'s turn — fire at ${foeName}'s waters` : 'Your turn — fire at the enemy waters'
    : beat.phase === 'intro'
      ? 'Battle stations! The fleets take position…'
      : beat.phase === 'handoff' || handoff
        ? `Pass the deck to ${nameOf(handoff ?? foeSide)}`
        : beat.phase === 'enemy-aiming'
          ? 'The enemy is aiming…'
          : beat.phase === 'player-shot' || beat.phase === 'player-sink'
            ? shotLine('human', beat.result!, who, hotSeat)
            : beat.phase === 'enemy-shot' || beat.phase === 'enemy-sink'
              ? shotLine('enemy', beat.result!, who, hotSeat)
              : last
                ? shotLine(last.by, last.result, who, hotSeat)
                : 'Firing…'

  const target = pending ?? (hover?.side === 'enemy' ? hover.coord : null)
  const enemyCell = (c: Coord): GridCellInfo => {
    const state = enemyCells[c.y][c.x]
    const key = coordKey(c)
    const aimed = target && (armed === 'broadside' ? broadsideCells(target, broadsideDir, foeBoard.size).some((b) => sameCoord(b, c)) : target.x === c.x && target.y === c.y)
    const seen = spiedByMe.get(key)
    const chest = treasureCells.has(key)
    const extra = chest ? ' cell-treasure' : seen === undefined ? '' : seen ? ' cell-spied cell-spied-ship' : ' cell-spied cell-spied-water'
    const title = chest ? `${coordLabel(c)} — treasure` : seen !== undefined && state === 'unknown' ? `${coordLabel(c)} — spyglass: ${seen ? 'ship' : 'open water'}` : state === 'unknown' ? coordLabel(c) : `${coordLabel(c)} — ${state}`
    return { state, className: `${aimed && yourTurn ? 'is-aimed' : ''} ${pending && aimed ? 'is-pending' : ''}${extra}`, title }
  }
  const playerCell = (c: Coord): GridCellInfo => {
    const state = playerView[c.y][c.x]
    const chest = enemyChests.has(coordKey(c))
    return {
      state: state === 'unknown' && ownCells.has(`${c.x},${c.y}`) ? 'ship' : state,
      className: chest ? 'cell-treasure' : undefined,
      title: chest ? `${coordLabel(c)} — the enemy found treasure` : undefined,
    }
  }

  const onEnemyCell = (c: Coord) => {
    if (!yourTurn) return
    if (armed === 'spyglass') {
      if (hasBeenShot(foeBoard, c)) return playSfx('miss')
      const seen = spyAt(c, perspective)
      if (!seen) return playSfx('miss')
      playSfx('ui-click')
      setSpyNote(`Spyglass ${coordLabel(c)} — ${seen === 'ship' ? 'a ship!' : 'open water.'}`)
      setArmed('shot')
      return
    }
    setSpyNote(null)
    if (armed === 'broadside') {
      if (!broadsideCells(c, broadsideDir, foeBoard.size).some((b) => !hasBeenShot(foeBoard, b))) return playSfx('miss')
      setArmed('shot')
      void fire(c, { kind: 'broadside', orientation: broadsideDir })
      return
    }
    if (hasBeenShot(foeBoard, c)) return playSfx('miss')
    void fire(c)
  }

  // the curtain is up: nothing of either chart stays in the DOM (the HUD root stays mounted so the turn flow survives)
  if (handoff) return <div className="battle hud" data-testid="battle" data-handoff={handoff} data-cinematic="false" aria-hidden />

  return (
    <div className="battle hud" data-testid="battle" data-cinematic={cinematic ? 'true' : 'false'} data-perspective={perspective}>
      <header className="battle-top">
        <div className={`panel parchment status-panel ${yourTurn ? 'is-yours' : 'is-theirs'}`}>
          <CompassRose size={64} heading={yourTurn || sideInPlay === 'human' ? 0 : beat.phase === 'enemy-aiming' ? 170 : 180} />
          <div className="status-text">
            <span className="status-turn" data-testid="status-turn" data-side={sideInPlay ?? (yourTurn ? 'human' : turn)}>
              {turnLabel}
            </span>
            <p className="status" data-testid="status" role="status" aria-live="polite">
              {statusText}
            </p>
            <span className="sr-only" aria-live="assertive" data-testid="shot-announcer">
              {last ? shotLine(last.by, last.result, who, hotSeat) : ''}
            </span>
            {busy && cinematics !== 'off' && (
              <button type="button" className="link-btn skip-hint" data-testid="skip-cinematic" onClick={skip}>
                {touch ? 'Tap to skip' : 'Press Space or click to skip'}
              </button>
            )}
          </div>
          <div className="status-meta">
            <span>{hotSeat ? 'two captains' : difficulty}</span>
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
          <FleetStatus board={ownBoard} side="player" title={hotSeat ? `${me}'s fleet` : 'Your fleet'} fleet={fleets[perspective]} />
          <FleetStatus board={foeBoard} side="enemy" title={hotSeat ? `${foeName}'s fleet` : 'Enemy fleet'} fleet={fleets[foeSide]} />
        </aside>

        <section className="charts">
          <div className="panel parchment chart-panel chart-enemy" aria-label="Enemy waters">
            <h2 className="panel-title small-title" data-testid="enemy-waters-title">
              {hotSeat ? `${foeName}'s waters` : 'Enemy waters'} <span className="spyglass" aria-hidden>◎</span>
              <span className="target-readout">{target && yourTurn ? `Target ${coordLabel(target)}` : '—'}</span>
            </h2>
            <Grid testId="enemy-grid" label="Enemy waters — fire" cell={enemyCell} onCell={onEnemyCell} onHover={(c) => setHover(c ? { side: 'enemy', coord: c } : null)} disabled={!yourTurn} lockResolved />
            {blackFlag && (
              <PowerShots
                power={powerShots[perspective]}
                armed={armed}
                orientation={broadsideDir}
                treasure={treasureFoundByMe}
                disabled={!yourTurn}
                onArm={(a) => (playSfx('ui-click'), setSpyNote(null), setArmed(a))}
                onRotate={() => setBroadsideDir((o) => (o === 'horizontal' ? 'vertical' : 'horizontal'))}
              />
            )}
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
            <h2 className="panel-title small-title" data-testid="your-waters-title">
              {hotSeat ? `${me}'s waters` : 'Your waters'}
            </h2>
            <Grid testId="player-grid" label="Your waters" cell={playerCell} disabled />
          </div>
        </section>

        <aside className="panel parchment side-panel side-right ink-in">
          <h2 className="panel-title small-title">Captain's log</h2>
          <ShotLog events={events} names={hotSeat ? { human: players.human.name, enemy: players.enemy.name } : undefined} />
        </aside>
      </div>

      <Hint id="battle" seen={hintsSeen.includes('battle')} onDismiss={dismissHint}>
        {touch ? 'Tap the enemy waters to aim your spyglass, tap again to fire.' : 'Hover the enemy waters to aim your spyglass, click to fire.'}{' '}
        {hotSeat ? 'After every broadside the deck passes to the other captain — nobody peeks.' : 'The enemy fleet stays hidden until a ship goes down.'}
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
