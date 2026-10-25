/**
 * `?extras-demo[=replay|photo|sandbox][&seed=N]` — seeded finished game for the replay player and photo mode, plus a
 * salvo / stormy-seas sandbox driving the real store with instant enemy turns.
 */
import { useEffect, useMemo, useState } from 'react'
import { coordLabel, enemyView, viewGrid, type Coord } from '../engine'
import { OceanScene } from '../scene'
import { foggedEnemyView, useGameStore, type GameModes } from '../store/gameStore'
import { Battlefield } from './Battlefield'
import { simulateGame } from './demoGame'
import { ModesPicker } from './ExtrasLayer'
import { PhotoMode } from './photo'
import { ReplayPlayer } from './replay'
import { describeEvent } from './replayModel'
import { StatsPanel } from './StatsPanel'
import './extras.css'

type Tab = 'replay' | 'photo' | 'sandbox'
const TABS: Tab[] = ['replay', 'photo', 'sandbox']

function readParams() {
  const q = new URLSearchParams(window.location.search)
  const tab = q.get('extras-demo')
  const seed = Number(q.get('seed'))
  return {
    tab: (TABS as string[]).includes(tab ?? '') ? (tab as Tab) : 'replay',
    seed: Number.isFinite(seed) && seed > 0 ? seed : 7,
    quality: q.get('quality') === 'low' ? ('low' as const) : undefined,
  }
}

export function ExtrasDemo() {
  const params = useMemo(readParams, [])
  const [tab, setTab] = useState<Tab>(params.tab)
  const game = useMemo(() => simulateGame(params.seed), [params.seed])

  return (
    <div className="xt-demo" data-testid="extras-demo" data-tab={tab}>
      {tab === 'replay' && <ReplayPlayer snapshot={game} autoPlay quality={params.quality} />}
      {tab === 'photo' && <PhotoMode boards={game} quality={params.quality} />}
      {tab === 'sandbox' && <Sandbox quality={params.quality} />}
      <nav className="xt-tabs" aria-label="Extras demo">
        {TABS.map((t) => (
          <button key={t} type="button" className={`xt-btn small${t === tab ? ' active' : ''}`} aria-pressed={t === tab} data-testid={`extras-tab-${t}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
        <span className="xt-muted">seed {params.seed}</span>
      </nav>
    </div>
  )
}

const STATE_GLYPH: Record<string, string> = { unknown: '', miss: '•', hit: '✶', sunk: '☠', ship: '▬' }

function Sandbox({ quality }: { quality?: 'low' | 'high' }) {
  const phase = useGameStore((s) => s.phase)
  const modes = useGameStore((s) => s.modes)
  const turn = useGameStore((s) => s.turn)
  const winner = useGameStore((s) => s.winner)
  const salvo = useGameStore((s) => s.salvo)
  const fogged = useGameStore((s) => s.fogged)
  const events = useGameStore((s) => s.events)
  const lastVolley = useGameStore((s) => s.lastVolley)
  const playerBoard = useGameStore((s) => s.playerBoard)
  const enemyBoard = useGameStore((s) => s.enemyBoard)
  const [showFog, setShowFog] = useState(false)
  const [seed, setSeed] = useState(1)

  const start = (m: Partial<GameModes> = modes) => {
    const s = useGameStore.getState()
    s.reset()
    s.startGame('medium', m, seed)
    s.autoPlacePlayerFleet()
    s.confirmPlacement()
  }

  useEffect(() => {
    if (useGameStore.getState().phase !== 'battle') start({ salvo: true, storm: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, [])

  const fire = (c: Coord) => {
    const s = useGameStore.getState()
    if (s.phase !== 'battle' || s.turn !== 'human') return
    const r = s.fireAt(c)
    if (r === null || r === undefined) return
    if (useGameStore.getState().phase === 'battle') useGameStore.getState().enemyTurn()
  }

  const fireRandomVolley = () => {
    const s = useGameStore.getState()
    const taken = new Set([...s.enemyBoard.shots.map((x) => `${x.coord.x},${x.coord.y}`), ...s.salvo.pending.map((c) => `${c.x},${c.y}`)])
    const open: Coord[] = []
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if (!taken.has(`${x},${y}`)) open.push({ x, y })
    let need = s.modes.salvo ? s.salvo.size - s.salvo.pending.length : 1
    while (need-- > 0 && open.length) {
      const [c] = open.splice(Math.floor(Math.random() * open.length), 1)
      fire(c)
    }
  }

  const enemyGrid = useMemo(() => viewGrid(foggedEnemyView(enemyBoard, fogged), enemyBoard), [enemyBoard, fogged])
  const ownGrid = useMemo(() => viewGrid(enemyView(playerBoard), playerBoard), [playerBoard])
  const fogSet = useMemo(() => new Set(fogged), [fogged])
  const pendingSet = useMemo(() => new Set(salvo.pending.map((c) => `${c.x},${c.y}`)), [salvo.pending])
  const boards = useMemo(() => ({ playerBoard, enemyBoard }), [playerBoard, enemyBoard])

  return (
    <div className="xt-sandbox" data-testid="sandbox" data-phase={phase} data-turn={turn}>
      <OceanScene view="battle" interactive weather={modes.storm ? 'stormy' : 'calm'} quality={quality}>
        <Battlefield boards={boards} revealEnemy={false} lod={quality === 'low' ? 2 : 1} quality={quality} />
      </OceanScene>

      <header className="xt-topbar">
        <div className="xt-title">
          <span className="xt-eyebrow">Salvo / stormy-seas sandbox</span>
          <strong>
            {phase === 'gameover' ? `${winner === 'human' ? 'You won' : 'Devin won'} in ${events.length} shots` : `${modes.salvo ? 'Salvo' : 'Classic'} · ${modes.storm ? 'stormy' : 'calm'} · ${turn === 'human' ? 'your turn' : 'enemy turn'}`}
          </strong>
        </div>
      </header>

      <aside className="xt-dock xt-dock-left">
        <ModesPicker />
        <div className="xt-panel xt-row wrap">
          <label className="xt-field inline">
            seed
            <input className="xt-input" type="number" min={1} value={seed} data-testid="sandbox-seed" onChange={(e) => setSeed(Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <button type="button" className="xt-btn primary small" data-testid="sandbox-start" onClick={() => start()}>
            New battle
          </button>
          <button type="button" className="xt-btn small" data-testid="sandbox-random-volley" disabled={phase !== 'battle' || turn !== 'human'} onClick={fireRandomVolley}>
            Fire random {modes.salvo ? 'volley' : 'shot'}
          </button>
          <label className="xt-toggle inline">
            <input type="checkbox" data-testid="sandbox-show-fog" checked={showFog} onChange={(e) => setShowFog(e.target.checked)} />
            <span>reveal fogged misses</span>
          </label>
        </div>
        <div className="xt-panel xt-status">
          {modes.salvo && (
            <span className="xt-pill" data-testid="salvo-status" data-pending={salvo.pending.length} data-size={salvo.size}>
              Salvo {salvo.pending.length}/{salvo.size} {salvo.pending.length > 0 && <small>{salvo.pending.map(coordLabel).join(' ')}</small>}
            </span>
          )}
          {modes.storm && (
            <span className="xt-pill storm" data-testid="fog-status" data-fogged={fogged.length}>
              {fogged.length} misses in fog
            </span>
          )}
          <span className="xt-pill" data-testid="event-count">
            {events.length} shots
          </span>
        </div>
        <ol className="xt-panel xt-log" data-testid="last-volley" aria-label="Last volley">
          {lastVolley.length === 0 && <li className="xt-muted">Fire at the enemy grid →</li>}
          {lastVolley.map((e) => (
            <li key={e.id} data-outcome={e.result.outcome}>
              {describeEvent(e)}
            </li>
          ))}
        </ol>
      </aside>

      <aside className="xt-dock xt-dock-right">
        <div className="xt-panel">
          <strong>Enemy waters</strong>
          <div className="xt-grid" data-testid="sandbox-enemy-grid">
            {enemyGrid.map((row, y) =>
              row.map((cell, x) => {
                const key = `${x},${y}`
                const fog = fogSet.has(key)
                const queued = pendingSet.has(key)
                return (
                  <button
                    key={key}
                    type="button"
                    className={`xt-cell ${cell}${fog ? ' fog' : ''}${queued ? ' queued' : ''}${showFog && fog ? ' revealed' : ''}`}
                    data-testid={`sandbox-enemy-${x}-${y}`}
                    data-state={cell}
                    data-fog={fog || undefined}
                    data-queued={queued || undefined}
                    disabled={phase !== 'battle' || turn !== 'human' || (cell !== 'unknown' && !fog) || queued}
                    aria-label={`${coordLabel({ x, y })} ${fog ? 'fog' : cell}`}
                    onClick={() => fire({ x, y })}
                  >
                    {fog ? (showFog ? '•' : '') : STATE_GLYPH[cell]}
                  </button>
                )
              }),
            )}
          </div>
        </div>
        <div className="xt-panel">
          <strong>Your waters</strong>
          <div className="xt-grid own" data-testid="sandbox-player-grid">
            {ownGrid.map((row, y) =>
              row.map((cell, x) => (
                <span key={`${x},${y}`} className={`xt-cell ${cell}`} data-testid={`sandbox-player-${x}-${y}`} data-state={cell}>
                  {STATE_GLYPH[cell]}
                </span>
              )),
            )}
          </div>
        </div>
        <StatsPanel compact />
      </aside>
    </div>
  )
}
