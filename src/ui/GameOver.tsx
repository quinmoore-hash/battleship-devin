import { useState } from 'react'
import { isSunk } from '../engine'
import { useGameStore } from '../store/gameStore'
import { Confetti } from './Confetti'
import { DevinBubble } from './DevinBubble'
import { pickLine } from './dialogue'
import { withSfx } from './sfx'

export function GameOverScreen() {
  const winner = useGameStore((s) => s.winner)
  const difficulty = useGameStore((s) => s.difficulty)
  const events = useGameStore((s) => s.events)
  const playerBoard = useGameStore((s) => s.playerBoard)
  const otterBoard = useGameStore((s) => s.otterBoard)
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const reset = useGameStore((s) => s.reset)
  const startGame = useGameStore((s) => s.startGame)

  const won = winner === 'human'
  const [line] = useState(() => pickLine(won ? 'win' : 'lose', { difficulty }))

  const shots = events.filter((e) => e.by === 'human')
  const hits = shots.filter((e) => e.result.outcome !== 'miss').length
  const accuracy = shots.length ? Math.round((hits / shots.length) * 100) : 0
  const shipsLost = playerBoard.ships.filter(isSunk).length
  const shipsSunk = otterBoard.ships.filter(isSunk).length

  return (
    <section className={`gameover ${won ? 'won' : 'lost'}`} data-testid="gameover" data-winner={winner}>
      {won && !reducedMotion && <Confetti />}
      <div className="panel gameover-card">
        <p className="eyebrow">{won ? 'Victory' : 'Defeat'}</p>
        <h1 className="title">{won ? 'You sank the otter fleet!' : 'Devin wins. Squeak.'}</h1>
        <DevinBubble text={line} mood={won ? 'defeat' : 'victory'} />

        <dl className="stats" data-testid="stats">
          <div>
            <dt>Shots fired</dt>
            <dd data-testid="stat-shots">{shots.length}</dd>
          </div>
          <div>
            <dt>Accuracy</dt>
            <dd data-testid="stat-accuracy">{accuracy}%</dd>
          </div>
          <div>
            <dt>Turns</dt>
            <dd data-testid="stat-turns">{shots.length}</dd>
          </div>
          <div>
            <dt>Ships sunk</dt>
            <dd data-testid="stat-sunk">{shipsSunk}/5</dd>
          </div>
          <div>
            <dt>Ships lost</dt>
            <dd data-testid="stat-lost">{shipsLost}/5</dd>
          </div>
        </dl>

        <div className="actions">
          <button type="button" className="btn primary big" data-testid="rematch" onClick={withSfx(() => startGame(difficulty))}>
            Rematch on {difficulty}
          </button>
          <button type="button" className="btn ghost big" data-testid="play-again" onClick={withSfx(reset)}>
            Play again
          </button>
        </div>
      </div>
    </section>
  )
}
