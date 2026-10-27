/**
 * Mounted next to `<GameUI>` in the main app. Adds, without touching `src/ui`:
 *  - stats recording + `<StatsPanel>` on the menu and game-over screens,
 *  - the salvo / stormy-seas mode picker on the menu and a salvo/fog status strip in battle,
 *  - the `battleship:replay` / `battleship:photo` listeners and the overlays (the report's buttons dispatch them),
 *  - a DOM shim that paints fog on hidden misses in the UI's enemy grid until `src/ui` adopts `foggedEnemyView`.
 */
import { useEffect, useLayoutEffect, useState } from 'react'
import { coordKey, coordLabel, type Difficulty } from '../engine'
import { useDirector } from '../cinematics'
import { usePerf } from '../perf'
import { useGameStore, type GameModes } from '../store/gameStore'
import { PhotoMode, usePhotoEvent, usePhotoMode } from './photo'
import { ReplayPlayer, useReplay, useReplayEvent } from './replay'
import { bindStatsRecorder } from './stats'
import { StatsPanel } from './StatsPanel'
import './extras.css'

export function ExtrasLayer() {
  useEffect(() => bindStatsRecorder(), [])
  useReplayEvent()
  usePhotoEvent()
  const replay = useReplay()
  const photo = usePhotoMode()
  const phase = useGameStore((s) => s.phase)
  const difficulty = useGameStore((s) => s.difficulty)
  // the report owns Replay / Photo (BUG-308); the log waits for the flyover like the report does (BUG-322)
  const flyover = useDirector((s) => s.busy)
  // replay / photo follow the detected tier instead of always rendering full detail (BUG-317)
  const quality = usePerf().quality
  useStormFogShim()

  return (
    <>
      {phase === 'battle' && <BattleStrip />}
      {phase === 'gameover' && !flyover && <GameOverLog difficulty={difficulty} />}
      {replay.snapshot && <ReplayPlayer snapshot={replay.snapshot} onClose={replay.close} quality={quality} />}
      {photo.request && <PhotoMode {...photo.request} onClose={photo.close} quality={quality} />}
    </>
  )
}

/** Captain's log on the game-over screen: a corner toggle so the table never sits under the report (BUG-270). */
function GameOverLog({ difficulty }: { difficulty: Difficulty }) {
  const [open, setOpen] = useState(false)
  return (
    <aside className={`xt-dock xt-dock-gameover${open ? ' open' : ''}`} data-testid="extras-gameover">
      {open && <StatsPanel difficulty={difficulty} />}
      <button type="button" className="xt-btn" data-testid="toggle-log" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide log' : 'Captain’s log'}
      </button>
    </aside>
  )
}

/** Salvo / stormy-seas toggles. Uses `setModes`, so the UI's own `startGame(difficulty)` picks them up. */
/** Mode checkboxes. Defaults to `setModes` (menu/placement); pass `onChange` to restart a running sandbox instead. */
/** Menu-screen extras (mode picker + compact stats). Rendered by `<GameUI menuExtras>` so it flows below the posters instead of floating over them. */
export function MenuExtras() {
  return (
    <aside className="menu-extras" data-testid="extras-menu" aria-label="Game modes and statistics">
      <ModesPicker />
      <StatsPanel compact />
    </aside>
  )
}

export function ModesPicker({ className = '', onChange }: { className?: string; onChange?: (modes: Partial<GameModes>) => void }) {
  const modes = useGameStore((s) => s.modes)
  const storeSetModes = useGameStore((s) => s.setModes)
  const setModes = onChange ?? storeSetModes
  return (
    <section className={`xt-panel xt-modes ${className}`} data-testid="modes-picker" aria-label="Game modes">
      <strong>Rules of engagement</strong>
      <label className="xt-toggle">
        <input type="checkbox" data-testid="mode-salvo" checked={modes.salvo} onChange={(e) => setModes({ salvo: e.target.checked })} />
        <span>
          <b>Salvo</b>
          <small>One shot per surviving ship, every turn — for both sides.</small>
        </span>
      </label>
      <label className="xt-toggle">
        <input type="checkbox" data-testid="mode-storm" checked={modes.storm} onChange={(e) => setModes({ storm: e.target.checked })} />
        <span>
          <b>Stormy seas</b>
          <small>Fog swallows ~30% of your misses; the weather turns.</small>
        </span>
      </label>
      <label className="xt-toggle">
        <input type="checkbox" data-testid="mode-black-flag" checked={modes.blackFlag} onChange={(e) => setModes({ blackFlag: e.target.checked })} />
        <span>
          <b>Black Flag</b>
          <small>Pick your fleet, two power shots each, hidden treasure.</small>
        </span>
      </label>
    </section>
  )
}

const STRIP_FALLBACK_TOP = 46

/** The strip lives outside `src/ui`, so it measures the battle top bar and docks just under it at any viewport width. */
function useBelowBattleTop(): number {
  const [top, setTop] = useState(STRIP_FALLBACK_TOP)
  useLayoutEffect(() => {
    const measure = () => {
      const bar = document.querySelector<HTMLElement>('[data-testid="battle"] .battle-top')
      setTop(bar ? Math.round(bar.getBoundingClientRect().bottom + 8) : STRIP_FALLBACK_TOP)
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    const bar = document.querySelector('[data-testid="battle"] .battle-top')
    if (bar && observer) observer.observe(bar)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [])
  return top
}

function BattleStrip() {
  const modes = useGameStore((s) => s.modes)
  const salvo = useGameStore((s) => s.salvo)
  const fogged = useGameStore((s) => s.fogged)
  const turn = useGameStore((s) => s.turn)
  const top = useBelowBattleTop()
  if (!modes.salvo && !modes.storm) return null
  const left = salvo.size - salvo.pending.length
  return (
    <div className="xt-strip" style={{ top }} data-testid="extras-battle-strip">
      {modes.salvo && (
        <span className="xt-pill" data-testid="salvo-status" data-pending={salvo.pending.length} data-size={salvo.size}>
          Salvo {salvo.pending.length}/{salvo.size}
          {turn === 'human' && left > 0 && ` — pick ${left} more`}
          {salvo.pending.length > 0 && <small> {salvo.pending.map(coordLabel).join(' ')}</small>}
        </span>
      )}
      {modes.storm && (
        <span className="xt-pill storm" data-testid="fog-status" data-fogged={fogged.length}>
          Stormy seas · {fogged.length} {fogged.length === 1 ? 'miss' : 'misses'} lost in fog
        </span>
      )}
    </div>
  )
}

const ENEMY_CELL_PREFIX = 'enemy-grid-'

/**
 * Paints `data-fog` on the UI's enemy cells whose miss is hidden by the storm, and `data-queued` on queued salvo
 * shots. Attribute-only, so React's own updates are untouched; styled in extras.css.
 */
function useStormFogShim() {
  const phase = useGameStore((s) => s.phase)
  const storm = useGameStore((s) => s.modes.storm)
  const salvoOn = useGameStore((s) => s.modes.salvo)
  const fogged = useGameStore((s) => s.fogged)
  const pending = useGameStore((s) => s.salvo.pending)
  const enemyBoard = useGameStore((s) => s.enemyBoard)
  useEffect(() => {
    if (phase !== 'battle' || (!storm && !salvoOn)) return
    const fog = new Set(fogged)
    const queued = new Set(pending.map(coordKey))
    const paint = () => {
      document.querySelectorAll<HTMLElement>(`[data-testid^="${ENEMY_CELL_PREFIX}"]`).forEach((el) => {
        const key = (el.dataset.testid ?? '').slice(ENEMY_CELL_PREFIX.length).replace('-', ',')
        el.toggleAttribute('data-fog', fog.has(key))
        el.toggleAttribute('data-queued', queued.has(key))
      })
    }
    paint()
    const id = window.requestAnimationFrame(paint)
    return () => window.cancelAnimationFrame(id)
  }, [phase, storm, salvoOn, fogged, pending, enemyBoard])
}
