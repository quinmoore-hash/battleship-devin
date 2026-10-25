import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OceanScene } from '../../scene'
import { BOARD_LAYOUT, type Vec3 } from '../../scene/layout'
import { SHIPS, Ship } from '../../ships'
import type { CellDamage, Livery, Side } from '../../ships/types'
import { useGameStore } from '../../store/gameStore'
import { ParticleBurst } from '../ParticleFx'
import { batteryMuzzles, impactPointWorld, type ShipPose } from './anchors'
import type { BroadsideShot } from './ballistics'
import { Broadside, type BroadsideHandle } from './Broadside'
import { Splash } from './Splash'

const SHIP_ID = 'frigate'
const anchors = SHIPS[SHIP_ID].anchors
const LENGTH = SHIPS[SHIP_ID].length

interface Combatant {
  key: 'a' | 'b'
  livery: Livery
  pose: ShipPose
  /** The battery that faces the other ship. */
  side: Side
}

/** Two frigates lying broadside to each other across the gap between the boards. */
const SHIPS_IN_DEMO: Record<'a' | 'b', Combatant> = {
  a: { key: 'a', livery: 'pirate', pose: { position: [0, BOARD_LAYOUT.surfaceY, 6], rotationY: 0 }, side: 'port' },
  b: { key: 'b', livery: 'navy', pose: { position: [1.5, BOARD_LAYOUT.surfaceY, -8], rotationY: 0 }, side: 'starboard' },
}
const other = (k: 'a' | 'b') => (k === 'a' ? SHIPS_IN_DEMO.b : SHIPS_IN_DEMO.a)

type Kind = 'single' | 'broadside' | 'miss'

interface Volley {
  id: number
  kind: Kind
  shooter: 'a' | 'b'
  seed: number
  shots: BroadsideShot[]
  /** Cell hit by each shot on the target (null = water). */
  cells: (number | null)[]
}

interface Impact {
  id: number
  point: Vec3
  seed: number
  kind: 'splash' | 'hit'
}

/** World-space miss point: a splash in the water short of / beyond the target's hull. */
function missPoint(target: Combatant, i: number): Vec3 {
  const beyond = target.side === 'starboard' ? 1 : -1
  const x = target.pose.position[0] + (i - (LENGTH - 1) / 2) * 1.3
  const z = target.pose.position[2] + beyond * (anchors.hull.beam / 2 + 2.2 + (i % 2) * 1.4)
  return [x, BOARD_LAYOUT.surfaceY, z]
}

function makeVolley(id: number, kind: Kind, shooter: 'a' | 'b', seed: number): Volley {
  const me = SHIPS_IN_DEMO[shooter]
  const target = other(shooter)
  const muzzles = batteryMuzzles(anchors, me.pose, me.side)
  const guns = kind === 'single' ? [muzzles[Math.floor(muzzles.length / 2)]] : muzzles
  const shots: BroadsideShot[] = []
  const cells: (number | null)[] = []
  guns.forEach((m, i) => {
    const hit = kind !== 'miss' && (kind === 'single' || (seed + i) % 3 !== 0)
    const cell = Math.min(m.cell, anchors.impactPoints.length - 1)
    shots.push({ from: m.position, to: hit ? impactPointWorld(anchors, target.pose, cell, target.side) : missPoint(target, i) })
    cells.push(hit ? cell : null)
  })
  return { id, kind, shooter, seed, shots, cells }
}

type Cam = 'overview' | 'side' | 'deck' | 'follow'
const CAMS: Cam[] = ['overview', 'side', 'deck', 'follow']
/** Fixed demo shots (the rig's `battle` view is the overview). `side` sees the whole arc, `deck` sits by the pirate's guns. */
const FIXED_SHOTS: Record<'side' | 'deck', { position: Vec3; target: Vec3 }> = {
  side: { position: [15, 4.5, -1], target: [0.5, 0.8, -1] },
  deck: { position: [-5.5, 2.4, 9.5], target: [0.5, 1.2, 1] },
}

/**
 * Demo camera on top of the scene's rig: fixed close shots, or riding the lead cannonball of the newest
 * volley (hands the camera back when nothing is in flight).
 */
function DemoCamera({ volleyRef, cam }: { volleyRef: React.RefObject<Map<number, BroadsideHandle>>; cam: Cam }) {
  const camera = useThree((s) => s.camera)
  const wanted = useRef(new THREE.Vector3())
  const look = useRef(new THREE.Vector3())
  const back = useRef(new THREE.Vector3())
  const tracking = useRef(false)
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    if (cam === 'overview') {
      tracking.current = false
      return
    }
    if (cam !== 'follow') {
      const shot = FIXED_SHOTS[cam]
      wanted.current.set(...shot.position)
      look.current.set(...shot.target)
      camera.position.lerp(wanted.current, 1 - Math.exp(-4 * dt))
      camera.lookAt(look.current)
      tracking.current = false
      return
    }
    let lead = null
    for (const b of volleyRef.current.values()) {
      const l = b.lead()
      if (l && l.inFlight) lead = l
    }
    if (!lead) {
      tracking.current = false
      return
    }
    back.current.copy(lead.velocity)
    back.current.y = 0
    if (back.current.lengthSq() < 1e-4) back.current.set(0, 0, 1)
    back.current.normalize()
    wanted.current.copy(lead.position).addScaledVector(back.current, -4.5)
    wanted.current.y = Math.max(lead.position.y + 1.6, 2.2)
    look.current.copy(lead.position).addScaledVector(lead.velocity, 0.12)
    const k = tracking.current ? 1 - Math.exp(-9 * dt) : 1
    camera.position.lerp(wanted.current, k)
    camera.lookAt(look.current)
    tracking.current = true
  })
  return null
}

const param = (name: string) => new URLSearchParams(window.location.search).get(name)

/**
 * `?vfx-cannon-demo`: two frigates trade broadsides on a loop. Buttons fire a single ball, a full broadside or
 * a deliberate miss; the follow-cam rides the lead ball. `&loop=0` starts paused, `&cam=side|deck|follow` picks a
 * camera, `&reduced=1` turns reduced motion on.
 */
export function CannonDemo() {
  const [volleys, setVolleys] = useState<Volley[]>([])
  const [impacts, setImpacts] = useState<Impact[]>([])
  const [damage, setDamage] = useState<Record<'a' | 'b', CellDamage[]>>({ a: Array(LENGTH).fill('intact'), b: Array(LENGTH).fill('intact') })
  const [loop, setLoop] = useState(param('loop') !== '0')
  const [cam, setCam] = useState<Cam>(() => {
    const c = param('cam') as Cam | null
    return c && CAMS.includes(c) ? c : 'overview'
  })
  const [log, setLog] = useState<string[]>([])
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const updateSettings = useGameStore((s) => s.updateSettings)
  const ids = useRef(0)
  const shooter = useRef<'a' | 'b'>('a')
  const handles = useRef(new Map<number, BroadsideHandle>())
  const busy = useRef(false)

  useEffect(() => {
    if (param('reduced') === '1') updateSettings({ reducedMotion: true })
  }, [updateSettings])

  const fire = useCallback((kind: Kind) => {
    const id = ++ids.current
    const who = shooter.current
    shooter.current = who === 'a' ? 'b' : 'a'
    busy.current = true
    setVolleys((v) => [...v, makeVolley(id, kind, who, id * 7 + 3)])
    setLog((l) => [`#${id} ${who === 'a' ? 'pirate' : 'navy'} fires ${kind}`, ...l].slice(0, 6))
  }, [])

  useEffect(() => {
    if (!loop) return
    const t = window.setInterval(() => {
      if (!busy.current) fire(ids.current % 3 === 2 ? 'miss' : 'broadside')
    }, 1200)
    if (ids.current === 0) fire('broadside')
    return () => window.clearInterval(t)
  }, [loop, fire])

  const onImpact = useCallback((v: Volley, point: Vec3, index: number) => {
    const cell = v.cells[index]
    const id = ++ids.current
    if (cell === null) {
      setImpacts((s) => [...s, { id, point, seed: id, kind: 'splash' }])
    } else {
      const target = other(v.shooter).key
      setImpacts((s) => [...s, { id, point, seed: id, kind: 'hit' }])
      setDamage((d) => {
        const next = [...d[target]]
        next[cell] = 'hit'
        return { ...d, [target]: next }
      })
    }
  }, [])

  const skipAll = () => handles.current.forEach((h) => h.skip())
  const reset = () => setDamage({ a: Array(LENGTH).fill('intact'), b: Array(LENGTH).fill('intact') })

  const ships = useMemo(
    () =>
      (['a', 'b'] as const).map((k) => {
        const c = SHIPS_IN_DEMO[k]
        return (
          <group key={k} position={c.pose.position} rotation-y={c.pose.rotationY}>
            <Ship id={SHIP_ID} livery={c.livery} damage={damage[k]} phase={k === 'a' ? 0 : 1.7} />
          </group>
        )
      }),
    [damage],
  )

  return (
    <>
      <OceanScene view="battle" interactive={cam === 'overview'}>
        {ships}
        {volleys.map((v) => (
          <Broadside
            key={v.id}
            ref={(h) => {
              if (h) handles.current.set(v.id, h)
              else handles.current.delete(v.id)
            }}
            shots={v.shots}
            seed={v.seed}
            onImpact={(p, i) => onImpact(v, p, i)}
            onAllImpacted={() => {
              busy.current = false
            }}
            onDone={() => setVolleys((s) => s.filter((x) => x.id !== v.id))}
          />
        ))}
        {impacts.map((im) =>
          im.kind === 'splash' ? (
            <Splash key={im.id} position={im.point} seed={im.seed} onDone={() => setImpacts((s) => s.filter((x) => x.id !== im.id))} />
          ) : (
            <ParticleBurst
              key={im.id}
              position={im.point}
              seed={im.seed}
              count={reducedMotion ? 14 : 36}
              colors={['#8a5a2b', '#5c3a1a', '#d9b27c', '#2b1a0c']}
              gravity={9}
              drag={0.6}
              shape="shard"
              speed={[1.5, 5]}
              up={[2, 6]}
              size={[0.03, 0.1]}
              life={[0.6, 1.4]}
              spread={0.2}
              onDone={() => setImpacts((s) => s.filter((x) => x.id !== im.id))}
            />
          ),
        )}
        <DemoCamera volleyRef={handles} cam={cam} />
      </OceanScene>
      <div
        data-testid="vfx-cannon-demo"
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
          minWidth: 280,
        }}
      >
        <strong>Cannon VFX demo</strong>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['single', 'broadside', 'miss'] as Kind[]).map((k) => (
            <button key={k} data-testid={`vfx-fire-${k}`} onClick={() => fire(k)} style={{ padding: '4px 8px', fontSize: 12, background: '#1d9bd1' }}>
              fire {k}
            </button>
          ))}
          <button data-testid="vfx-skip" onClick={skipAll} style={{ padding: '4px 8px', fontSize: 12, background: '#345' }}>
            skip
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button data-testid="vfx-loop" onClick={() => setLoop(!loop)} style={{ padding: '4px 8px', fontSize: 12, background: loop ? '#1d9bd1' : '#345' }}>
            loop: {loop ? 'on' : 'off'}
          </button>
          {CAMS.map((c) => (
            <button key={c} data-testid={`vfx-cam-${c}`} onClick={() => setCam(c)} style={{ padding: '4px 8px', fontSize: 12, background: c === cam ? '#1d9bd1' : '#345' }}>
              {c === 'follow' ? 'follow-cam' : `cam: ${c}`}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            data-testid="vfx-reduced"
            onClick={() => updateSettings({ reducedMotion: !reducedMotion })}
            style={{ padding: '4px 8px', fontSize: 12, background: reducedMotion ? '#1d9bd1' : '#345' }}
          >
            reduced motion: {reducedMotion ? 'on' : 'off'}
          </button>
          <button onClick={reset} style={{ padding: '4px 8px', fontSize: 12, background: '#345' }}>
            repair ships
          </button>
        </div>
        <span data-testid="vfx-status" style={{ opacity: 0.8 }}>
          in flight: {volleys.length} · effects: {impacts.length}
        </span>
        <div data-testid="vfx-log" style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.4 }}>
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>
    </>
  )
}
