import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { FLEET, type ShipId } from '../../engine'
import { OceanScene } from '../../scene'
import { SHIPS } from '../../ships'
import type { CellDamage, Livery } from '../../ships/types'
import { useGameStore } from '../../store/gameStore'
import { FlotsamPieces } from './Debris'
import { flotsamLayout, footprintCenters } from './debris'
import { SINK_PHASES, sinkPose } from './pose'
import { SinkingShip, SURFACE_Y } from './SinkingShip'
import { DEFAULT_SLOW_MO, sinkProgressAt, sinkRateAt, sinkTimeline, type SinkTimeline } from './timeline'

type Pattern = 'bow' | 'stern' | 'midships' | 'raked' | 'all'
const PATTERNS: Pattern[] = ['bow', 'stern', 'midships', 'raked', 'all']

export function damagePattern(pattern: Pattern, length: number): { damage: CellDamage[]; lastHit: number } {
  const d: CellDamage[] = Array(length).fill('hit')
  switch (pattern) {
    case 'bow':
      d[0] = 'burning'
      if (length > 2) d[1] = 'burning'
      return { damage: d, lastHit: 0 }
    case 'stern':
      d[length - 1] = 'burning'
      if (length > 2) d[length - 2] = 'burning'
      return { damage: d, lastHit: length - 1 }
    case 'midships':
      d[Math.floor(length / 2)] = 'burning'
      return { damage: d, lastHit: Math.floor(length / 2) }
    case 'raked':
      return { damage: d.map((_, i) => (i % 2 === 0 ? 'burning' : 'hit')), lastHit: length - 1 }
    case 'all':
      return { damage: Array(length).fill('burning'), lastHit: Math.floor(length / 2) }
  }
}

interface Orbit {
  yaw: number
  pitch: number
  dist: number
}
const SHOTS: Record<string, Orbit> = {
  'bow close': { yaw: Math.PI / 2 - 0.45, pitch: 0.26, dist: 3.2 },
  broadside: { yaw: 0.08, pitch: 0.22, dist: 5.5 },
  'stern quarter': { yaw: -Math.PI / 2 + 0.6, pitch: 0.35, dist: 4.5 },
  high: { yaw: 0.6, pitch: 0.95, dist: 9 },
  wide: { yaw: 0.35, pitch: 0.3, dist: 14 },
}

/** Orbit camera for the demo, overriding the scene's CameraRig every frame (it runs after it). */
function DemoCamera({ orbit, target, drag }: { orbit: Orbit; target: THREE.Vector3; drag: React.RefObject<Orbit> }) {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    let down: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY }
    }
    const onMove = (e: PointerEvent) => {
      if (!down || !drag.current) return
      drag.current.yaw += (e.clientX - down.x) * 0.006
      drag.current.pitch = Math.max(0.05, Math.min(1.4, drag.current.pitch + (e.clientY - down.y) * 0.004))
      down = { x: e.clientX, y: e.clientY }
    }
    const onUp = () => {
      down = null
    }
    const onWheel = (e: WheelEvent) => {
      if (!drag.current) return
      drag.current.dist = Math.max(2, Math.min(30, drag.current.dist * (1 + e.deltaY * 0.001)))
    }
    el.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      el.removeEventListener('wheel', onWheel)
    }
  }, [gl, drag])
  const cur = useRef<Orbit>({ ...orbit })
  useEffect(() => {
    if (drag.current) Object.assign(drag.current, orbit)
  }, [orbit, drag])
  useFrame((state, delta) => {
    const want = drag.current ?? orbit
    const c = cur.current
    const k = 1 - Math.exp(-Math.min(delta, 0.1) * 5)
    c.yaw += (want.yaw - c.yaw) * k
    c.pitch += (want.pitch - c.pitch) * k
    c.dist += (want.dist - c.dist) * k
    const cam = state.camera as THREE.PerspectiveCamera
    cam.position.set(
      target.x + Math.sin(c.yaw) * Math.cos(c.pitch) * c.dist,
      Math.max(0.6, target.y + Math.sin(c.pitch) * c.dist),
      target.z + Math.cos(c.yaw) * Math.cos(c.pitch) * c.dist,
    )
    cam.lookAt(target)
    if (Math.abs(cam.fov - 38) > 0.01) {
      cam.fov = 38
      cam.updateProjectionMatrix()
    }
  })
  return null
}

function Playhead({ playing, timeline, speed, onProgress, onEnd }: { playing: boolean; timeline: SinkTimeline; speed: number; onProgress: (p: number) => void; onEnd: () => void }) {
  const elapsed = useRef<number | null>(null)
  const progressRef = useRef(0)
  useFrame((_, delta) => {
    if (!playing) {
      elapsed.current = null
      return
    }
    if (elapsed.current === null) elapsed.current = 0
    elapsed.current += Math.min(delta, 0.1) * speed
    const p = sinkProgressAt(elapsed.current, timeline)
    if (p !== progressRef.current) {
      progressRef.current = p
      onProgress(p)
    }
    if (p >= 1) onEnd()
  })
  return null
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

const param = (name: string) => new URLSearchParams(window.location.search).get(name)
const phaseName = (p: number) => (Object.entries(SINK_PHASES).find(([, [a, b]]) => p >= a && p < b)?.[0] ?? 'rest')

/**
 * `?vfx-sinking-demo[&ship=galleon&livery=navy&pattern=bow&progress=0.5&shot=broadside&seed=3]`
 * One ship from `src/ships` sinking under a close camera: scrubber, play (with the director's slow-mo
 * window), damage pattern, livery, seed, time scale, camera shots (drag to orbit, wheel to zoom).
 */
export function SinkingDemo() {
  const [ship, setShip] = useState<ShipId>(() => (param('ship') && SHIPS[param('ship') as ShipId] ? (param('ship') as ShipId) : 'galleon'))
  const [livery, setLivery] = useState<Livery>(() => (param('livery') === 'navy' ? 'navy' : 'pirate'))
  const [pattern, setPattern] = useState<Pattern>(() => (PATTERNS.includes(param('pattern') as Pattern) ? (param('pattern') as Pattern) : 'bow'))
  const [seed, setSeed] = useState(() => Number(param('seed') ?? 3) || 3)
  const [progress, setProgress] = useState(() => Math.min(1, Math.max(0, Number(param('progress') ?? 0) || 0)))
  const [playing, setPlaying] = useState(() => param('play') !== null)
  const [level, setLevel] = useState<'full' | 'fast'>('full')
  const [speed, setSpeed] = useState(1)
  const [shotName, setShotName] = useState<string>(() => (param('shot') && SHOTS[param('shot')!] ? param('shot')! : 'broadside'))
  const [effects, setEffects] = useState(param('effects') !== 'off')
  const [afterFlotsam, setAfterFlotsam] = useState(true)
  const [fps, setFps] = useState(0)
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const updateSettings = useGameStore((s) => s.updateSettings)
  const drag = useRef<Orbit>({ ...SHOTS[shotName] })

  const def = SHIPS[ship]
  const { damage, lastHit } = useMemo(() => damagePattern(pattern, def.length), [pattern, def.length])
  const timeline = useMemo(() => sinkTimeline(level), [level])
  const pose = useMemo(() => sinkPose(progress, { seed, hull: def.anchors.hull, damage, lastHit }), [progress, seed, def, damage, lastHit])
  const target = useMemo(() => new THREE.Vector3(0, SURFACE_Y + 0.4 - Math.min(pose.depth, 1.2) * 0.5, 0), [pose.depth])
  const inSlowMo = level === 'full' && progress >= DEFAULT_SLOW_MO.from && progress < DEFAULT_SLOW_MO.to
  const timeScale = inSlowMo ? DEFAULT_SLOW_MO.scale : 1
  const flotsam = useMemo(() => flotsamLayout(footprintCenters([0, SURFACE_Y, 0], 0, def.length), seed), [def.length, seed])
  const showFlotsam = afterFlotsam && progress >= 1

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => {
          if (!p) setProgress((v) => (v >= 1 ? 0 : v))
          return !p
        })
      }
      if (e.key === 'r') setProgress(0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const btn = (active: boolean): React.CSSProperties => ({ padding: '4px 8px', fontSize: 12, background: active ? '#1d9bd1' : '#345' })
  const play = () => {
    setProgress((v) => (v >= 1 ? 0 : v))
    setPlaying(true)
  }

  return (
    <>
      <OceanScene view="placement" interactive={false} dressing={false}>
        <DemoCamera orbit={SHOTS[shotName]} target={target} drag={drag} />
        <Playhead playing={playing} timeline={timeline} speed={speed} onProgress={setProgress} onEnd={() => setPlaying(false)} />
        <FpsProbe onFps={setFps} />
        {!showFlotsam && (
          <SinkingShip ship={ship} livery={livery} damage={damage} progress={progress} seed={seed} lastHit={lastHit} timeScale={timeScale} effects={effects} />
        )}
        {showFlotsam && <FlotsamPieces pieces={flotsam} livery={livery} />}
      </OceanScene>
      <div
        data-testid="sinking-demo"
        style={{
          position: 'fixed',
          left: 12,
          bottom: 12,
          zIndex: 2,
          display: 'grid',
          gap: 8,
          padding: 12,
          borderRadius: 12,
          background: 'rgba(5,25,40,0.72)',
          backdropFilter: 'blur(8px)',
          color: '#eaf6ff',
          font: '13px Inter, system-ui, sans-serif',
          width: 340,
        }}
      >
        <strong>
          Sinking demo · <span data-testid="sinking-demo-fps">{fps} fps</span>
        </strong>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>
            progress {progress.toFixed(2)} · <em>{phaseName(progress)}</em>
            {inSlowMo ? ' · slow-mo 0.4×' : ''} · depth {pose.depth.toFixed(2)} m · roll {((pose.roll * 180) / Math.PI).toFixed(0)}° · pitch{' '}
            {((pose.pitch * 180) / Math.PI).toFixed(0)}°
          </span>
          <input data-testid="sinking-demo-progress" type="range" min={0} max={1} step={0.001} value={progress} onChange={(e) => setProgress(Number(e.target.value))} />
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button data-testid="sinking-demo-play" onClick={() => (playing ? setPlaying(false) : play())} style={btn(playing)}>
            {playing ? 'pause' : progress >= 1 ? 'replay' : 'play'}
          </button>
          <button onClick={() => setProgress(0)} style={btn(false)}>
            reset
          </button>
          <button onClick={() => setLevel(level === 'full' ? 'fast' : 'full')} style={btn(false)}>
            {level === 'full' ? `full ${timeline.duration}s + slow-mo` : `fast ${timeline.duration}s`}
          </button>
          <label>
            speed{' '}
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ fontSize: 12 }}>
              {[0.25, 0.5, 1, 2].map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
          </label>
          <span style={{ opacity: 0.7 }}>rate {(sinkRateAt(progress, timeline) * speed).toFixed(2)}/s</span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FLEET.map((s) => (
            <button key={s.id} data-testid={`sinking-demo-ship-${s.id}`} onClick={() => setShip(s.id)} style={btn(s.id === ship)}>
              {s.id}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ alignSelf: 'center', opacity: 0.7 }}>damage:</span>
          {PATTERNS.map((p) => (
            <button key={p} data-testid={`sinking-demo-pattern-${p}`} onClick={() => setPattern(p)} style={btn(p === pattern)}>
              {p}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ alignSelf: 'center', opacity: 0.7 }}>camera:</span>
          {Object.keys(SHOTS).map((name) => (
            <button key={name} data-testid={`sinking-demo-shot-${name.replace(' ', '-')}`} onClick={() => setShotName(name)} style={btn(name === shotName)}>
              {name}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button data-testid="sinking-demo-livery" onClick={() => setLivery(livery === 'pirate' ? 'navy' : 'pirate')} style={btn(false)}>
            livery: {livery}
          </button>
          <button onClick={() => setSeed((s) => s + 1)} style={btn(false)}>
            seed: {seed}
          </button>
          <button onClick={() => setEffects(!effects)} style={btn(effects)}>
            water fx
          </button>
          <button onClick={() => setAfterFlotsam(!afterFlotsam)} style={btn(afterFlotsam)}>
            flotsam at end
          </button>
          <button data-testid="sinking-demo-reduced" onClick={() => updateSettings({ reducedMotion: !reducedMotion })} style={btn(reducedMotion)}>
            reduced motion
          </button>
        </div>
        <span style={{ opacity: 0.6 }}>drag to orbit · wheel to zoom · space play/pause · r reset</span>
      </div>
    </>
  )
}
