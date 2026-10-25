import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { FLEET, type Orientation, type PlacedShip, type ShipSpec, type ShotResult } from '../engine'
import { BOARD_LAYOUT, cellToWorld, shipCells, type Vec3 } from './layout'
import { Projectile, ShotMarkers } from './markers'
import { OtterMascot, OtterPortrait } from './otter'
import { Fleet, ShipGhost } from './ships'
import { OTTER_MOODS, type OtterMood } from './timeline'

/**
 * Showcase for reviewers: every ship (horizontal + vertical), a looping sink, every marker type
 * fired by a projectile on a loop, placement ghosts and the mascot cycling through its moods.
 * Not part of the game; wire `<FxDemo />` into App.tsx locally to view it.
 */

const place = (spec: ShipSpec, x: number, y: number, orientation: Orientation, hitCount = 0): PlacedShip => {
  const cells = shipCells(spec, { x, y }, orientation)
  return { spec, origin: { x, y }, orientation, cells, hits: cells.slice(0, hitCount) }
}

const DEMO_SHOTS: ShotResult[] = [
  { coord: { x: 7, y: 1 }, outcome: 'miss' },
  { coord: { x: 8, y: 3 }, outcome: 'hit', shipId: 'clam-cruiser' },
  { coord: { x: 7, y: 5 }, outcome: 'sunk', shipId: 'pebble-patrol' },
  { coord: { x: 9, y: 7 }, outcome: 'miss' },
  { coord: { x: 6, y: 8 }, outcome: 'hit', shipId: 'kelp-carrier' },
]

const FIRE_FROM: Vec3 = [1.5, 0.6, -11.5]
const MOOD_PERIOD = 3600
const SINK_STEP = 1100
const SINK_HOLD = 5200

const VIEWS = {
  overview: { label: 'overview', position: [4, 11, 17], target: [1, 0, -5] },
  'kelp-carrier': { label: 'Kelp Carrier', position: [-7.5, 2.6, -1.8], target: [-2.5, 0.3, -4.5] },
  'clam-cruiser': { label: 'Clam Cruiser', position: [-7.5, 2.4, 0.2], target: [-3, 0.2, -2.5] },
  'driftwood-destroyer': { label: 'Driftwood Destroyer', position: [-7.5, 2.4, 2], target: [-3.5, 0.3, -0.5] },
  'stream-sub': { label: 'Stream Sub', position: [-7.5, 2.2, 4], target: [-3.5, 0.1, 1.5] },
  'pebble-patrol': { label: 'Pebble Patrol', position: [-7.5, 2, 6.2], target: [-4, 0.2, 3.5] },
  markers: { label: 'markers', position: [3, 4.5, 6], target: [3, 0, -0.5] },
  ghosts: { label: 'far board', position: [1, 7, -3.5], target: [0, 0, -11.5] },
  otter: { label: 'Devin', position: [11.5, 3.4, 0.5], target: [9.5, 1.6, -6] },
} satisfies Record<string, { label: string; position: Vec3; target: Vec3 }>
type ViewId = keyof typeof VIEWS

function CameraRig({ view }: { view: ViewId }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const goal = useRef({ position: new THREE.Vector3(...VIEWS.overview.position), target: new THREE.Vector3(...VIEWS.overview.target) })
  useEffect(() => {
    goal.current.position.set(...VIEWS[view].position)
    goal.current.target.set(...VIEWS[view].target)
  }, [view])
  useFrame(({ camera }, dt) => {
    const c = controls.current
    if (!c) return
    const k = 1 - Math.exp(-4 * dt)
    if (camera.position.distanceTo(goal.current.position) > 0.01 || c.target.distanceTo(goal.current.target) > 0.01) {
      camera.position.lerp(goal.current.position, k)
      c.target.lerp(goal.current.target, k)
      c.update()
    }
  })
  return <OrbitControls ref={controls} makeDefault maxPolarAngle={Math.PI / 2.05} />
}

export function FxDemo() {
  // --- mascot moods ------------------------------------------------------
  const [mood, setMood] = useState<OtterMood>('idle')
  const [autoMood, setAutoMood] = useState(true)
  useEffect(() => {
    if (!autoMood) return
    const id = setInterval(() => {
      setMood((m) => OTTER_MOODS[(OTTER_MOODS.indexOf(m) + 1) % OTTER_MOODS.length])
    }, MOOD_PERIOD)
    return () => clearInterval(id)
  }, [autoMood])

  // --- sinking loop on the Clam Cruiser ----------------------------------
  const cruiser = FLEET[1]
  const [cruiserHits, setCruiserHits] = useState(0)
  useEffect(() => {
    const id = setTimeout(
      () => setCruiserHits((h) => (h >= cruiser.length ? 0 : h + 1)),
      cruiserHits >= cruiser.length ? SINK_HOLD : SINK_STEP,
    )
    return () => clearTimeout(id)
  }, [cruiserHits, cruiser.length])

  // --- marker loop: projectile -> impact -> marker ----------------------
  const [shots, setShots] = useState<ShotResult[]>([])
  const [inFlight, setInFlight] = useState<ShotResult | null>(null)
  useEffect(() => {
    if (inFlight) return
    const next = DEMO_SHOTS[shots.length]
    const id = setTimeout(
      () => {
        if (!next) setShots([])
        else setInFlight(next)
      },
      next ? 1400 : 2600,
    )
    return () => clearTimeout(id)
  }, [shots, inFlight])
  const onImpact = useCallback(() => {
    if (!inFlight) return
    setShots((prev) => (prev.some((s) => s.coord.x === inFlight.coord.x && s.coord.y === inFlight.coord.y) ? prev : [...prev, inFlight]))
    setInFlight(null)
  }, [inFlight])

  // --- camera spotlights so reviewers can inspect each ship / the mascot up close -----
  const [view, setView] = useState<ViewId>('overview')

  const playerShips = useMemo(
    () => [
      place(FLEET[0], 0, 0, 'horizontal', 1),
      place(cruiser, 0, 2, 'horizontal', cruiserHits),
      place(FLEET[2], 0, 4, 'horizontal'),
      place(FLEET[3], 0, 6, 'horizontal', 1),
      place(FLEET[4], 0, 8, 'horizontal'),
    ],
    [cruiser, cruiserHits],
  )
  const otterShips = useMemo(
    () => [
      place(FLEET[0], 0, 0, 'vertical'),
      place(FLEET[1], 2, 1, 'vertical', 2),
      place(FLEET[2], 4, 0, 'vertical'),
      place(FLEET[3], 6, 2, 'vertical'),
      place(FLEET[4], 8, 0, 'vertical', 2),
    ],
    [],
  )
  const hiddenFleet = useMemo(() => [place(FLEET[4], 0, 8, 'horizontal', 2), place(FLEET[2], 5, 8, 'horizontal', 1)], [])

  const target = inFlight ? cellToWorld(inFlight.coord) : null

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0b2a3a' }}>
      <Canvas camera={{ position: [4, 11, 17], fov: 45 }} shadows>
        <color attach="background" args={['#0b2a3a']} />
        <fog attach="fog" args={['#0b2a3a', 30, 60]} />
        <ambientLight intensity={0.55} />
        <hemisphereLight args={['#bfe3ff', '#2a4a3a', 0.6]} />
        <directionalLight position={[8, 14, 6]} intensity={1.6} castShadow />
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -7]} receiveShadow>
          <planeGeometry args={[80, 80]} />
          <meshStandardMaterial color="#1b6a8a" roughness={0.35} metalness={0.1} transparent opacity={0.9} />
        </mesh>
        <gridHelper args={[10, 10, '#9fd8ff', '#3f8db5']} position={[0, 0.01, 0]} />
        <gridHelper args={[10, 10, '#ffb27a', '#b36b3a']} position={[0, 0.01, -14]} />

        <Fleet ships={playerShips} revealed />
        <Fleet ships={otterShips} revealed origin={BOARD_LAYOUT.otter.origin} />
        {/* revealed=false: of these two enemy ships only the sunk Pebble Patrol is drawn */}
        <Fleet ships={hiddenFleet} revealed={false} origin={BOARD_LAYOUT.otter.origin} />

        <ShipGhost spec={FLEET[2]} origin={{ x: 6, y: 9 }} orientation="horizontal" valid boardOrigin={BOARD_LAYOUT.otter.origin} />
        <ShipGhost spec={FLEET[3]} origin={{ x: 2, y: 6 }} orientation="vertical" valid={false} boardOrigin={BOARD_LAYOUT.otter.origin} />

        <ShotMarkers shots={shots} />
        {target && <Projectile key={`${target[0]},${target[2]}`} from={FIRE_FROM} to={target} onImpact={onImpact} />}

        <OtterMascot mood={mood} position={[9.5, 0, -6]} rotation={[0, -0.55, 0]} scale={1.7} />

        <CameraRig view={view} />
      </Canvas>

      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          display: 'grid',
          gap: 10,
          padding: 14,
          borderRadius: 14,
          background: 'rgba(5,25,40,.75)',
          backdropFilter: 'blur(8px)',
          color: '#eaf6ff',
          font: '14px/1.4 Inter, system-ui, sans-serif',
          maxWidth: 360,
        }}
        data-testid="fx-demo-hud"
      >
        <strong style={{ fontSize: 16 }}>fx demo — ships, VFX &amp; Devin</strong>
        <div>
          Near board: five ships (horizontal), Clam Cruiser takes hits and sinks on a loop. Far board: the same five vertical,
          two placement ghosts (green valid / red invalid) and a hidden fleet showing only its sunk ship.
        </div>
        <div>
          Projectile → <b>{inFlight ? `${inFlight.outcome} incoming` : shots.length ? `last: ${shots[shots.length - 1].outcome}` : 'reloading'}</b>{' '}
          ({shots.length}/{DEMO_SHOTS.length} markers)
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <OtterPortrait mood={mood} size={72} showLabel />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {OTTER_MOODS.map((m) => (
              <button
                key={m}
                data-testid={`fx-mood-${m}`}
                onClick={() => {
                  setAutoMood(false)
                  setMood(m)
                }}
                style={{
                  padding: '4px 8px',
                  borderRadius: 8,
                  border: 0,
                  cursor: 'pointer',
                  background: m === mood ? '#f0912d' : '#1d9bd1',
                  color: 'white',
                }}
              >
                {m}
              </button>
            ))}
            <button
              onClick={() => setAutoMood((a) => !a)}
              style={{ padding: '4px 8px', borderRadius: 8, border: 0, cursor: 'pointer', background: '#355', color: 'white' }}
            >
              {autoMood ? 'auto: on' : 'auto: off'}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(Object.keys(VIEWS) as ViewId[]).map((v) => (
            <button
              key={v}
              data-testid={`fx-view-${v}`}
              onClick={() => setView(v)}
              style={{
                padding: '3px 7px',
                borderRadius: 8,
                border: 0,
                cursor: 'pointer',
                fontSize: 12,
                background: v === view ? '#f0912d' : '#2b6f8c',
                color: 'white',
              }}
            >
              {VIEWS[v].label}
            </button>
          ))}
        </div>
        <div style={{ opacity: 0.7, fontSize: 12 }}>Drag to orbit, wheel to zoom.</div>
      </div>
    </div>
  )
}
