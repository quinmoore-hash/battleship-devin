import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useMemo, useRef, useState } from 'react'
import { FLEET_BY_ID, type Coord, type PlacedShip, type ShotResult } from '../engine'
import { BoardGrid, OceanScene, type CameraView } from '../scene'
import { BOARD_LAYOUT, cellToWorld, type Vec3 } from '../scene/layout'
import { Fleet, SHIPS, shipWorldTransform } from '../ships'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import { seededRandom } from './random'
import { DamageLayer, ImpactFlash, SplinterBurst } from './damage'
import { GridBuoys, ShotMarkers } from './markers'

/**
 * `?vfx-damage-demo` — review page for the damage VFX and shot markers. A placeholder galleon and sloop
 * sit on the player board; buttons fire hits at them (impact flash + splinters, then a persistent
 * fire/smoke/hull breach), drop random shot markers on the enemy grid and toggle the rope-buoy grid.
 */
function placed(id: PlacedShip['spec']['id'], origin: Coord, orientation: PlacedShip['orientation']): PlacedShip {
  const spec = FLEET_BY_ID[id]
  const cells = Array.from({ length: spec.length }, (_, i) => (orientation === 'horizontal' ? { x: origin.x + i, y: origin.y } : { x: origin.x, y: origin.y + i }))
  return { spec, origin, orientation, cells, hits: [] }
}

interface Burst {
  id: number
  position: Vec3
  normal: Vec3
  seed: number
}

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

const VIEWS: CameraView[] = ['placement', 'battle', 'gameover']

/** Close-up presets (camera position → look-at) for reviewing detail; also `?cam=x,y,z&look=x,y,z`. */
const CLOSEUPS: Record<string, [Vec3, Vec3]> = {
  galleon: [[-1.6, 1.9, 8.8], [0.5, 0.6, 5.5]],
  'hull breach': [[0.2, 0.75, 7.6], [0.6, 0.45, 5.9]],
  sloop: [[-5.6, 1.3, 10.3], [-3.5, 0.5, 8]],
  markers: [[-1, 2, -4.2], [0, 0.2, -8]],
  'buoy corner': [[-6.6, 1.1, -1.1], [-5, 0.5, -3]],
}
const parseVec = (v: string | null): Vec3 | null => {
  const n = v?.split(',').map(Number)
  return n && n.length === 3 && n.every((x) => Number.isFinite(x)) ? [n[0], n[1], n[2]] : null
}

/** Pins the camera to a fixed shot (overrides the scene's CameraRig while mounted). */
function CameraPin({ shot }: { shot: [Vec3, Vec3] }) {
  const controls = useThree((s) => s.controls) as { target: THREE.Vector3 } | null
  const look = useMemo(() => new THREE.Vector3(...shot[1]), [shot])
  useFrame(({ camera }) => {
    camera.position.set(shot[0][0], shot[0][1], shot[0][2])
    if (controls) controls.target.copy(look)
    camera.lookAt(look)
  })
  return null
}
const btn = (active = false): React.CSSProperties => ({ padding: '5px 9px', background: active ? '#b5542a' : '#345', color: '#fff', border: 0, borderRadius: 6, fontSize: 12, cursor: 'pointer' })

export function VfxDamageDemo() {
  const q = new URLSearchParams(window.location.search)
  const [ships, setShips] = useState<PlacedShip[]>(() => [placed('galleon', { x: 3, y: 4 }, 'horizontal'), placed('sloop', { x: 1, y: 6 }, 'vertical')])
  const [bursts, setBursts] = useState<Burst[]>([])
  const [shots, setShots] = useState<ShotResult[]>([])
  const [buoys, setBuoys] = useState(q.has('buoys'))
  const [view, setView] = useState<CameraView>((q.get('view') as CameraView) || 'placement')
  const [fps, setFps] = useState(0)
  const [closeup, setCloseup] = useState<string | null>(() => (q.has('cam') && q.has('look') ? 'url' : q.get('closeup')))
  const pin: [Vec3, Vec3] | null = closeup === 'url' ? [parseVec(q.get('cam'))!, parseVec(q.get('look'))!] : closeup ? CLOSEUPS[closeup] ?? null : null
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const updateSettings = useGameStore((s) => s.updateSettings)
  const nextId = useRef(1)
  const rnd = useMemo(() => seededRandom(Number(q.get('seed') ?? 7)), []) // eslint-disable-line react-hooks/exhaustive-deps
  const origin = BOARD_LAYOUT.player.origin

  const hitCell = useCallback(
    (shipIdx: number, cellIdx: number) => {
      const ship = ships[shipIdx]
      const cell = ship.cells[cellIdx]
      const def = SHIPS[ship.spec.id]
      const { position, rotationY } = shipWorldTransform(ship, origin)
      const ip = def.anchors.impactPoints[cellIdx]
      const c = Math.cos(rotationY)
      const s = Math.sin(rotationY)
      // starboard side (local +z), matching DamageLayer's default breach side
      const local: Vec3 = [ip[0], ip[1], -ip[2]]
      const world: Vec3 = [position[0] + local[0] * c + local[2] * s, position[1] + local[1], position[2] - local[0] * s + local[2] * c]
      const normal: Vec3 = [s, 0, c]
      const id = nextId.current++
      setBursts((b) => [...b, { id, position: world, normal, seed: id * 31 + 7 }])
      window.setTimeout(() => {
        setShips((prev) => prev.map((p, i) => (i === shipIdx && !p.hits.some((h) => h.x === cell.x && h.y === cell.y) ? { ...p, hits: [...p.hits, cell] } : p)))
      }, 180)
    },
    [ships, origin],
  )

  const hitRandom = () => {
    const candidates = ships.flatMap((sh, si) => sh.cells.map((c, ci) => ({ si, ci, c })).filter(({ c }) => !sh.hits.some((h) => h.x === c.x && h.y === c.y)))
    if (candidates.length === 0) return
    const pick = candidates[Math.floor(rnd() * candidates.length)]
    hitCell(pick.si, pick.ci)
  }
  const burnAll = () => setShips((prev) => prev.map((p) => ({ ...p, hits: [...p.cells] })))
  const addShot = (outcome: ShotResult['outcome']) => {
    const used = new Set(shots.map((s) => `${s.coord.x},${s.coord.y}`))
    let coord: Coord = { x: 0, y: 0 }
    for (let i = 0; i < 200; i++) {
      coord = { x: Math.floor(rnd() * 10), y: Math.floor(rnd() * 10) }
      if (!used.has(`${coord.x},${coord.y}`)) break
    }
    setShots((s) => [...s, { coord, outcome, shipId: outcome === 'miss' ? undefined : 'frigate' }])
  }
  const sinkOne = () => {
    // three hits in a row then the sinking shot on the enemy grid
    const row = Math.floor(rnd() * 10)
    const x0 = Math.floor(rnd() * 7)
    const used = new Set(shots.map((s) => `${s.coord.x},${s.coord.y}`))
    const cells = [0, 1, 2].map((i) => ({ x: x0 + i, y: row })).filter((c) => !used.has(`${c.x},${c.y}`))
    setShots((s) => [...s, ...cells.map((coord, i): ShotResult => ({ coord, outcome: i === cells.length - 1 ? 'sunk' : 'hit', shipId: 'brigantine' }))])
  }
  const reset = () => {
    setShips((prev) => prev.map((p) => ({ ...p, hits: [] })))
    setBursts([])
    setShots([])
  }
  const hits = ships.reduce((n, s) => n + s.hits.length, 0)

  return (
    <>
      <OceanScene view={view} interactive dressing={false}>
        <BoardGrid origin={BOARD_LAYOUT.player.origin} color="#9cffb0" labels={false} />
        {!buoys && <BoardGrid origin={BOARD_LAYOUT.enemy.origin} labels={false} />}
        {buoys && <GridBuoys origin={BOARD_LAYOUT.enemy.origin} />}
        <Fleet ships={ships} livery="pirate" boardOrigin={origin} />
        <DamageLayer ships={ships} boardOrigin={origin} />
        {bursts.map((b) => (
          <group key={b.id}>
            <ImpactFlash position={b.position} normal={b.normal} />
            <SplinterBurst position={b.position} normal={b.normal} seed={b.seed} onDone={() => setBursts((all) => all.filter((x) => x.id !== b.id))} />
          </group>
        ))}
        <ShotMarkers shots={shots} boardOrigin={BOARD_LAYOUT.enemy.origin} />
        <FpsProbe onFps={setFps} />
        {pin && <CameraPin shot={pin} />}
      </OceanScene>
      <div
        data-testid="vfx-damage-demo"
        style={{
          position: 'fixed',
          left: 12,
          bottom: 12,
          zIndex: 2,
          display: 'grid',
          gap: 8,
          padding: 12,
          borderRadius: 12,
          background: 'rgba(20,12,6,0.72)',
          backdropFilter: 'blur(8px)',
          color: '#f5e9d0',
          font: '13px Inter, system-ui, sans-serif',
          minWidth: 280,
        }}
      >
        <strong>
          Damage VFX demo · <span data-testid="vfx-demo-fps">{fps} fps</span> · hits <span data-testid="vfx-demo-hits">{hits}</span> · markers{' '}
          <span data-testid="vfx-demo-markers">{shots.length}</span>
        </strong>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button data-testid="vfx-demo-hit" style={btn()} onClick={hitRandom}>
            Hit random cell
          </button>
          <button data-testid="vfx-demo-burn" style={btn()} onClick={burnAll}>
            Set everything ablaze
          </button>
          <button data-testid="vfx-demo-reset" style={btn()} onClick={reset}>
            Reset
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button data-testid="vfx-demo-miss" style={btn()} onClick={() => addShot('miss')}>
            + miss marker
          </button>
          <button data-testid="vfx-demo-hitmarker" style={btn()} onClick={() => addShot('hit')}>
            + hit marker
          </button>
          <button data-testid="vfx-demo-sink" style={btn()} onClick={sinkOne}>
            + sunk ship
          </button>
          <button data-testid="vfx-demo-buoys" style={btn(buoys)} onClick={() => setBuoys((b) => !b)}>
            Rope buoys grid
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          camera:
          {VIEWS.map((v) => (
            <button key={v} data-testid={`vfx-demo-view-${v}`} style={btn(v === view)} onClick={() => { setView(v); setCloseup(null) }}>
              {v}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          close-up:
          {Object.keys(CLOSEUPS).map((k) => (
            <button key={k} data-testid={`vfx-demo-closeup-${k.replace(' ', '-')}`} style={btn(k === closeup)} onClick={() => setCloseup((c) => (c === k ? null : k))}>
              {k}
            </button>
          ))}
          <label style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
            <input data-testid="vfx-demo-reduced" type="checkbox" checked={reducedMotion} onChange={(e) => updateSettings({ reducedMotion: e.target.checked })} />
            reduced motion
          </label>
        </div>
        <span style={{ opacity: 0.7 }}>Drag to orbit, wheel to zoom. Cells: {cellToWorld({ x: 0, y: 0 }, origin).join(', ')} is A1.</span>
      </div>
    </>
  )
}
