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

/** Menu steps: 1 who plays → 2 rules of engagement → 3 the foe (single player) / the captains' names (two captains). */
export type MenuStep = 'mode' | 'rules' | 'foe' | 'names'

export interface MenuExtras {
  /** The Rules of engagement dock (mode checkboxes), shown at step 2. */
  rules?: ReactNode
  /** Compact statistics, shown under step 1. */
  stats?: ReactNode
  /** Small corner control (e.g. the Sky & sea picker), rendered in the menu's top-left corner on every step. */
  corner?: ReactNode
}

export function MainMenu({ extras }: { extras?: MenuExtras } = {}) {
  const startGame = useGameStore((s) => s.startGame)
  const players = useGameStore((s) => s.players)
  const setPlayers = useGameStore((s) => s.setPlayers)
  const { openModal } = useUi()
  const [step, setStep] = useState<MenuStep>('mode')
  const [names, setNames] = useState({ human: players.human.name, enemy: players.enemy.name })
  const twoCaptains = players.enemy.kind === 'local'

  const go = (next: MenuStep) => {
    playSfx('ui-click')
    setStep(next)
  }
  const chooseMode = (two: boolean) => {
    setPlayers({ enemy: { kind: two ? 'local' : 'ai' } })
    go('rules')
  }
  const pick = (d: (typeof DIFFICULTIES)[number]['id']) => {
    playSfx('ui-click')
    startGame(d)
  }
  const startTwoCaptains = () => {
    playSfx('ui-click')
    const human = names.human.trim() || 'Captain 1'
    const enemy = names.enemy.trim() || 'Captain 2'
    setPlayers({ human: { name: human }, enemy: { name: enemy, kind: 'local' } })
    // the AI difficulty is irrelevant with two captains; medium keeps the report / stats keyed consistently
    startGame('medium')
  }
  const stepIndex = step === 'mode' ? 1 : step === 'rules' ? 2 : 3

  return (
    <div className="menu" data-testid="main-menu" data-step={step}>
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

      <div className="menu-steps" aria-label={`Step ${stepIndex} of 3`} data-testid="menu-step" data-step={stepIndex}>
        {[1, 2, 3].map((n) => (
          <i key={n} className={n <= stepIndex ? 'on' : ''} />
        ))}
        <span>Step {stepIndex} of 3</span>
      </div>

      {step === 'mode' && (
        <>
          <section className="mode-cards" aria-label="Who plays">
            <button type="button" className="btn btn-brass mode-card ink-in" data-testid="mode-single" onClick={() => chooseMode(false)}>
              <span className="mode-name">Single player</span>
              <span className="mode-how">Hunt the Royal Navy</span>
            </button>
            <button type="button" className="btn btn-brass mode-card ink-in" style={{ animationDelay: '90ms' }} data-testid="mode-two" onClick={() => chooseMode(true)}>
              <span className="mode-name">Two captains</span>
              <span className="mode-how">One deck, pass the laptop</span>
            </button>
          </section>
          <nav className="menu-actions ink-in" style={{ animationDelay: '220ms' }}>
            <button type="button" className="btn btn-brass" data-testid="open-how-to-play" onClick={() => (playSfx('ui-click'), openModal('how-to-play'))}>
              How to play
            </button>
            <button type="button" className="btn btn-brass" data-testid="open-settings" onClick={() => (playSfx('ui-click'), openModal('settings'))}>
              Settings
            </button>
          </nav>
          {extras?.stats && (
            <div className="menu-dock ink-in" style={{ animationDelay: '320ms' }}>
              {extras.stats}
            </div>
          )}
        </>
      )}

      {step === 'rules' && (
        <>
          <header className="menu-step-head ink-in">
            <h2>Rules of engagement</h2>
            <p>{twoCaptains ? 'Both captains sail under the same rules. Tick none for classic Battleship.' : 'Tick any combination. None ticked is classic Battleship.'}</p>
          </header>
          {extras?.rules && (
            <div className="menu-dock ink-in" style={{ animationDelay: '90ms' }}>
              {extras.rules}
            </div>
          )}
          <nav className="menu-actions ink-in" style={{ animationDelay: '180ms' }}>
            <button type="button" className="btn btn-ghost-light" data-testid="menu-back" onClick={() => go('mode')}>
              ← Back
            </button>
            <button type="button" className="btn btn-crimson btn-big" data-testid="rules-next" onClick={() => go(twoCaptains ? 'names' : 'foe')}>
              {twoCaptains ? 'Next: name the captains' : 'Next: choose your foe'}
            </button>
          </nav>
        </>
      )}

      {step === 'foe' && (
        <>
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
            <button type="button" className="btn btn-ghost-light" data-testid="menu-back" onClick={() => go('rules')}>
              ← Back
            </button>
          </nav>
        </>
      )}

      {step === 'names' && (
        <>
          <header className="menu-step-head ink-in">
            <h2>Name the captains</h2>
            <p>Captain 1 sails under the black flag and musters first; Captain 2 commands the Royal Navy.</p>
          </header>
          <form
            className="panel parchment names-card ink-in"
            data-testid="captain-names"
            onSubmit={(e) => {
              e.preventDefault()
              startTwoCaptains()
            }}
          >
            <label>
              <span>
                Captain 1 <small>— pirate colours, places first</small>
              </span>
              <input type="text" data-testid="captain-1-name" maxLength={18} autoComplete="off" value={names.human} placeholder="Captain 1" onChange={(e) => setNames((n) => ({ ...n, human: e.target.value }))} />
            </label>
            <label>
              <span>
                Captain 2 <small>— Royal Navy colours</small>
              </span>
              <input type="text" data-testid="captain-2-name" maxLength={18} autoComplete="off" value={names.enemy} placeholder="Captain 2" onChange={(e) => setNames((n) => ({ ...n, enemy: e.target.value }))} />
            </label>
            <div className="names-actions">
              <button type="button" className="btn btn-ghost" data-testid="menu-back" onClick={() => go('rules')}>
                ← Back
              </button>
              <button type="submit" className="btn btn-crimson btn-big" data-testid="names-start">
                Muster the fleets
              </button>
            </div>
          </form>
        </>
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
