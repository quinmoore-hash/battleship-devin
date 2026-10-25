import { useMemo } from 'react'
import { playSfx } from '../audio'
import { useGameStore } from '../store/gameStore'
import { Confetti } from './Confetti'
import { Skull, WaxSeal } from './Ornaments'
import { battleReport, captainRank, formatDuration } from './stats'
import { useUiStore } from './uiStore'

/**
 * Parchment after-action report. "Replay" and "Photo mode" are owned by the extras session: the
 * buttons dispatch `battleship:replay` / `battleship:photo` window events for it to hook into.
 */
export function GameOverScreen() {
  const winner = useGameStore((s) => s.winner)
  const events = useGameStore((s) => s.events)
  const playerBoard = useGameStore((s) => s.playerBoard)
  const enemyBoard = useGameStore((s) => s.enemyBoard)
  const difficulty = useGameStore((s) => s.difficulty)
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const startGame = useGameStore((s) => s.startGame)
  const reset = useGameStore((s) => s.reset)
  const battleStartedAt = useUiStore((s) => s.battleStartedAt)

  const won = winner === 'human'
  const report = useMemo(() => battleReport(events, playerBoard, enemyBoard, battleStartedAt), [events, playerBoard, enemyBoard, battleStartedAt])

  const rows: [string, string, string][] = [
    ['stat-shots', 'Shots fired', String(report.shots)],
    ['stat-accuracy', 'Accuracy', `${report.accuracy}%`],
    ['stat-turns', 'Turns', String(report.turns)],
    ['stat-sunk', 'Enemy ships sunk', `${report.shipsSunk}/5`],
    ['stat-lost', 'Ships lost', `${report.shipsLost}/5`],
    ['stat-streak', 'Best streak', String(report.bestStreak)],
    ['stat-time', 'Battle time', formatDuration(report.seconds)],
  ]

  return (
    <div className="gameover hud" data-testid="gameover" data-winner={winner ?? ''}>
      {won && !reducedMotion && <Confetti />}
      <article className={`panel parchment report ink-in ${won ? 'report-won' : 'report-lost'}`}>
        <header className="report-head">
          <span className="report-kicker">After-action report · {difficulty}</span>
          <h2 className="report-title">{won ? 'Victory!' : 'Sunk!'}</h2>
          <p className="report-sub">
            {won ? 'The enemy fleet rests on the seabed. The cove is yours, Captain.' : 'The enemy sent your last ship to the depths. Davy Jones sends his regards.'}
          </p>
          <p className="report-rank">
            Rank earned: <strong data-testid="rank">{captainRank(report, won)}</strong>
          </p>
        </header>
        <dl className="report-stats">
          {rows.map(([id, label, value]) => (
            <div key={id} className="stat">
              <dt>{label}</dt>
              <dd data-testid={id}>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="report-actions">
          <button type="button" className="btn btn-crimson btn-big" data-testid="rematch" onClick={() => (playSfx('ui-click'), startGame(difficulty))}>
            Rematch
          </button>
          <button type="button" className="btn btn-brass" data-testid="play-again" onClick={() => (playSfx('ui-click'), reset())}>
            Menu
          </button>
          <button type="button" className="btn btn-rope" data-testid="report-replay" onClick={() => (playSfx('ui-click'), window.dispatchEvent(new CustomEvent('battleship:replay')))}>
            Replay
          </button>
          <button type="button" className="btn btn-rope" data-testid="report-photo" onClick={() => (playSfx('ui-click'), window.dispatchEvent(new CustomEvent('battleship:photo')))}>
            Photo mode
          </button>
        </div>
        <WaxSeal tone={won ? 'gold' : 'crimson'} className="report-seal">
          <Skull size={22} />
        </WaxSeal>
      </article>
    </div>
  )
}
