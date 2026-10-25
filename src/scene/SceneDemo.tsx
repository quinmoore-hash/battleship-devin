import { useFrame } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import type { Coord } from '../engine'
import { coordLabel } from '../engine'
import { BoardGrid } from './BoardGrid'
import type { CameraView } from './CameraRig'
import { OceanScene } from './index'
import { BOARD_LAYOUT, type BoardKey } from './layout'
import { GOLDEN_HOUR } from './sun'
import type { Quality } from './Water'

const VIEWS: CameraView[] = ['menu', 'placement', 'battle', 'gameover']

interface Pick {
  board: BoardKey
  coord: Coord
}
const pickLabel = (p: Pick | null) => (p ? `${p.board === 'enemy' ? 'enemy' : 'you'} ${coordLabel(p.coord)}` : '—')

/** Counts rendered frames and reports frames-per-second once a second. */
function FpsProbe({ onFps }: { onFps: (fps: number) => void }) {
  const frames = useRef(0)
  const last = useRef(0)
  useFrame((state) => {
    frames.current++
    const t = state.clock.elapsedTime
    if (t - last.current >= 1) {
      onFps(Math.round(frames.current / (t - last.current)))
      frames.current = 0
      last.current = t
    }
  })
  return null
}

/**
 * Stand-alone review page for the scene (`?scene-demo`): both grids, a highlighted cell that
 * follows the pointer, and controls for time of day, quality and camera view.
 */
const param = (name: string) => new URLSearchParams(window.location.search).get(name)

export function SceneDemo() {
  const [timeOfDay, setTimeOfDay] = useState(() => {
    const n = Number(param('tod'))
    return param('tod') !== null && Number.isFinite(n) ? n : GOLDEN_HOUR
  })
  const [quality, setQuality] = useState<Quality>(() => (param('quality') === 'low' ? 'low' : 'high'))
  const [view, setView] = useState<CameraView>(() => {
    const v = param('view') as CameraView | null
    return v && VIEWS.includes(v) ? v : 'battle'
  })
  const [hover, setHover] = useState<Pick | null>({ board: 'enemy', coord: { x: 5, y: 4 } })
  const [lastClick, setLastClick] = useState<Pick | null>(null)
  const gridProps = (board: BoardKey) => ({
    origin: BOARD_LAYOUT[board].origin,
    highlight: hover?.board === board ? hover.coord : lastClick?.board === board ? lastClick.coord : null,
    onCellPointerMove: (coord: Coord | null) => setHover(coord ? { board, coord } : null),
    onCellClick: (coord: Coord) => setLastClick({ board, coord }),
  })
  const [dressing, setDressing] = useState(true)
  const [fps, setFps] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setTimeOfDay((t) => (t + 0.99) % 1)
      if (e.key === 'ArrowRight') setTimeOfDay((t) => (t + 0.01) % 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <OceanScene quality={quality} timeOfDay={timeOfDay} view={view} dressing={dressing}>
        <BoardGrid {...gridProps('enemy')} />
        <BoardGrid {...gridProps('player')} color="#9cffb0" />
        <FpsProbe onFps={setFps} />
      </OceanScene>
      <div
        data-testid="scene-demo"
        style={{
          position: 'fixed',
          left: 12,
          bottom: 12,
          zIndex: 2,
          display: 'grid',
          gap: 8,
          padding: 12,
          borderRadius: 12,
          background: 'rgba(5,25,40,0.7)',
          backdropFilter: 'blur(8px)',
          color: '#eaf6ff',
          font: '13px Inter, system-ui, sans-serif',
          minWidth: 260,
        }}
      >
        <strong>
          Scene demo · <span data-testid="scene-demo-fps">{fps} fps</span>
        </strong>
        <label style={{ display: 'grid', gap: 4 }}>
          Time of day: {timeOfDay.toFixed(2)}
          <input
            data-testid="scene-demo-tod"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(Number(e.target.value))}
          />
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {VIEWS.map((v) => (
            <button
              key={v}
              data-testid={`scene-demo-view-${v}`}
              onClick={() => setView(v)}
              style={{ padding: '4px 8px', background: v === view ? '#1d9bd1' : '#345', fontSize: 12 }}
            >
              {v}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            data-testid="scene-demo-quality"
            onClick={() => setQuality(quality === 'high' ? 'low' : 'high')}
            style={{ padding: '4px 8px', fontSize: 12 }}
          >
            quality: {quality}
          </button>
          <button onClick={() => setDressing(!dressing)} style={{ padding: '4px 8px', fontSize: 12, background: '#345' }}>
            dressing: {dressing ? 'on' : 'off'}
          </button>
        </div>
        <span>
          hover: {pickLabel(hover)} · click: {pickLabel(lastClick)}
        </span>
      </div>
    </>
  )
}
