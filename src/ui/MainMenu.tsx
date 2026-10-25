import { DIFFICULTIES } from './difficulties'
import { useGameStore } from '../store/gameStore'
import { withSfx } from './sfx'
import { useUi } from './UiContext'


export function MainMenu() {
  const startGame = useGameStore((s) => s.startGame)
  const { openModal } = useUi()

  return (
    <section className="menu" data-testid="main-menu">
      <div className="menu-hero">
        <div className="title-block">
          <p className="eyebrow">Hoist the colours</p>
          <h1 className="title">
            <span>Pirate</span>
            <span className="accent">Battleship</span>
          </h1>
          <p className="subtitle">Sink the Royal Navy’s five ships before they send yours to the depths. Choose your enemy’s skill.</p>
        </div>
      </div>

      <div className="difficulty-row">
        {DIFFICULTIES.map((d, i) => (
          <button
            key={d.id}
            type="button"
            className={`card difficulty-card diff-${d.id}`}
            data-testid={`difficulty-${d.id}`}
            style={{ animationDelay: `${0.15 + i * 0.1}s` }}
            onClick={withSfx(() => startGame(d.id))}
          >
            <span className="waves" aria-hidden>
              {Array.from({ length: d.waves }, (_, w) => (
                <i key={w} />
              ))}
            </span>
            <strong>{d.label}</strong>
            <em>{d.tagline}</em>
            <small>{d.how}</small>
            <span className="cta">Play {d.label}</span>
          </button>
        ))}
      </div>

      <div className="menu-actions">
        <button type="button" className="btn ghost" data-testid="open-how-to-play" onClick={withSfx(() => openModal('how-to-play'))}>
          How to play
        </button>
        <button type="button" className="btn ghost" data-testid="open-settings" onClick={withSfx(() => openModal('settings'))}>
          Settings
        </button>
      </div>
    </section>
  )
}
