import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useProgress } from '@react-three/drei'
import { useEffect, useState } from 'react'
import { playSfx } from '../audio'
import { is3dDisabled } from '../scene/flags'
import { useGameStore } from '../store/gameStore'
import { DIFFICULTIES } from './difficulties'
import { CompassRose, Skull, WaxSeal } from './Ornaments'
import { SkySeaPicker } from './SkySeaPicker'
import { useUi } from './UiContext'
import { useUiStore } from './uiStore'

export const LOADING_MIN_MS = 1400
export const LOADING_TIPS = [
  'A ship hangs over its last unsunk cell — work the neighbours of every hit.',
  'Press R, right-click or tap Rotate to turn a ship before you drop it.',
  'The enemy fleet is hidden until a ship goes down. Watch the smoke.',
  'Click a ship on the water to pick it up again.',
  'Hard mode builds a probability chart of every legal placement. Spread your fleet.',
  'Turn cinematics to Fast in Settings if you want a quicker broadside.',
  'Keyboard captains: Tab into a chart, arrows to aim, Enter to fire.',
]

const BOUNTY: Record<string, string> = { easy: '500', medium: '2,000', hard: '10,000' }

export function MainMenu({ extras }: { extras?: ReactNode } = {}) {
  const startGame = useGameStore((s) => s.startGame)
  const { openModal } = useUi()
  const pick = (d: (typeof DIFFICULTIES)[number]['id']) => {
    playSfx('ui-click')
    startGame(d)
  }
  return (
    <div className="menu" data-testid="main-menu">
      <LoadingScreen />
      <aside className="menu-skysea ink-in" style={{ animationDelay: '600ms' }}>
        <SkySeaPicker compact />
      </aside>
      <header className="menu-title ink-in">
        <div className="title-rule" aria-hidden>
          <span />
          <Skull size={18} />
          <span />
        </div>
        <h1>
          <span className="title-small">The Chronicles of</span>
          <span className="title-big">Pirate Battleship</span>
        </h1>
        <p className="tagline">Hoist the colours, chart the enemy waters and send their fleet to the depths.</p>
      </header>
      <section className="posters" aria-label="Choose your foe">
        {DIFFICULTIES.map((d, i) => (
          <button key={d.id} type="button" className={`poster poster-${d.id} ink-in`} style={{ animationDelay: `${120 + i * 90}ms` }} data-testid={`difficulty-${d.id}`} onClick={() => pick(d.id)}>
            <span className="poster-wanted">Wanted</span>
            <span className="poster-portrait" aria-hidden>
              <Skull size={44} />
            </span>
            <span className="poster-name">{d.label}</span>
            <span className="poster-level">{d.tagline}</span>
            <span className="poster-waves" aria-label={`${d.waves} of 3 skulls`}>
              {Array.from({ length: 3 }, (_, k) => (
                <Skull key={k} size={14} />
              ))}
            </span>
            <span className="poster-how">{d.how}</span>
            <span className="poster-bounty">
              Bounty <strong>{BOUNTY[d.id]}</strong> doubloons
            </span>
            <WaxSeal tone={d.id === 'hard' ? 'crimson' : d.id === 'medium' ? 'gold' : 'teal'} className="poster-seal" />
          </button>
        ))}
      </section>
      <nav className="menu-actions ink-in" style={{ animationDelay: '420ms' }}>
        <button type="button" className="btn btn-brass" data-testid="open-how-to-play" onClick={() => (playSfx('ui-click'), openModal('how-to-play'))}>
          How to play
        </button>
        <button type="button" className="btn btn-brass" data-testid="open-settings" onClick={() => (playSfx('ui-click'), openModal('settings'))}>
          Settings
        </button>
      </nav>
      {extras && (
        <div className="menu-dock ink-in" style={{ animationDelay: '520ms' }}>
          {extras}
        </div>
      )}
      <footer className="menu-foot">
        <CompassRose size={56} spinning />
        <span>Built procedurally in three.js — no stock assets aboard.</span>
      </footer>
    </div>
  )
}

/**
 * Parchment loading screen shown over the menu until the heavy scene has compiled: drei's
 * `useProgress` for asset loads, the world's first rendered frame, and a minimum display time so
 * the bar never flickers. Skipped entirely under `?no3d`.
 */
export function LoadingScreen() {
  const { progress, active } = useProgress()
  const worldReady = useUiStore((s) => s.worldReady)
  const [minElapsed, setMinElapsed] = useState(false)
  const [tip] = useState(() => LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)])
  const [hidden, setHidden] = useState(() => is3dDisabled() || sessionStorage.getItem('battleship.loaded') === '1')

  useEffect(() => {
    if (hidden) return
    const t = setTimeout(() => setMinElapsed(true), LOADING_MIN_MS)
    const bail = setTimeout(() => setHidden(true), 15000)
    return () => (clearTimeout(t), clearTimeout(bail))
  }, [hidden])

  const done = minElapsed && !active && worldReady
  useEffect(() => {
    if (done && !hidden) {
      sessionStorage.setItem('battleship.loaded', '1')
      const t = setTimeout(() => setHidden(true), 450)
      return () => clearTimeout(t)
    }
  }, [done, hidden])

  if (hidden) return null
  const pct = Math.round(Math.min(100, done ? 100 : worldReady ? Math.max(progress, 90) : Math.min(progress, 85)))
  return createPortal(
    <div className={`loading ui-portal ${done ? 'loading-out' : ''}`} data-testid="loading" role="status" aria-live="polite">
      <div className="loading-card">
        <CompassRose size={84} spinning />
        <h2>Rigging the ships…</h2>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="loading-pct">{pct}%</p>
        <p className="loading-tip">
          <em>Tip:</em> {tip}
        </p>
      </div>
    </div>,
    document.body,
  )
}
