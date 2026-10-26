import { useFrame } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStore } from 'zustand'
import type { PlacedShip, Player } from '../engine'
import { BOARD_LAYOUT, type Vec3 } from '../scene/layout'
import { sampleWaveHeight } from '../scene/waves'
import { SHIPS, damageOf, shipWorldTransform } from '../ships'
import type { Livery } from '../ships/types'
import { ParticleBurst } from '../vfx/ParticleFx'
import { Broadside, type BroadsideHandle } from '../vfx/cannon/Broadside'
import type { BroadsideShot } from '../vfx/cannon/ballistics'
import { Splash } from '../vfx/cannon/Splash'
import { Fire, ImpactFlash, Smoke, SplinterBurst } from '../vfx/damage'
import { seededRandom } from '../vfx/random'
import { Bubbles, Debris, HullWash, Steam, Whirlpool, debrisPieces, lastHitIndex, placedShipSeed, placedSinkPose, sinkBias } from '../vfx/sinking'
import { ownBoardOrigin, type ShotPlan } from './battery'
import { director as defaultDirector, type ActiveCinematic, type Director } from './director'
import { beatStart } from './sequence'
import { follow } from './shared'

export interface CinematicLayerProps {
  director?: Director
  /** Liveries of the two fleets (debris colours); defaults pirate = human, navy = enemy. */
  livery?: Record<Player, Livery>
}

type Residual =
  | { id: number; kind: 'splash'; position: Vec3; seed: number; scale: number }
  | { id: number; kind: 'hit'; position: Vec3; normal: Vec3; seed: number; scale: number }
  | { id: number; kind: 'burn'; position: Vec3; seed: number; born: number }

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type NewResidual = DistributiveOmit<Residual, 'id'>

const DEFAULT_LIVERY: Record<Player, Livery> = { human: 'pirate', enemy: 'navy' }
const BURN_SECONDS = 4.5
/** Fireworks budget: bursts × particles. */
const FIREWORKS = { high: { bursts: 14, count: 90 }, low: { bursts: 6, count: 50 } }

/**
 * Everything the director shows in the 3D scene: muzzle flashes, smoke, cannonballs in flight, splashes,
 * hull impacts and short-lived fires for shots; the water effects of a sinking ship (the ship itself is
 * posed by `<Fleet sinkProgress>`); fireworks or burning wrecks for a victory. Mount once inside `<OceanScene>`.
 *
 * Budget per shot: one `<Broadside>` (≤ 3 balls at `full`/high, 1 at `fast` or low), exactly one `<Splash>` or one
 * `<ImpactFlash>` + `<SplinterBurst>` (lead ball), and at `full`/high one `<Fire>` + `<Smoke>` ignition for 4.5 s.
 * Every effect unmounts when done.
 */
export function CinematicLayer({ director = defaultDirector, livery = DEFAULT_LIVERY }: CinematicLayerProps) {
  const active = useStore(director.store, (s) => s.active)
  const [residual, setResidual] = useState<Residual[]>([])
  const nextId = useRef(1)
  const add = useCallback((r: NewResidual) => {
    setResidual((list) => [...list, { ...r, id: nextId.current++ } as Residual])
  }, [])
  const remove = useCallback((id: number) => setResidual((list) => list.filter((r) => r.id !== id)), [])

  return (
    <>
      {active?.event.type === 'shot' && active.plan && <ShotFx key={active.id} active={active} plan={active.plan} director={director} add={add} />}
      {active?.event.type === 'sink' && <SinkFx key={active.id} active={active} director={director} livery={livery} />}
      {active?.event.type === 'victory' && <VictoryFx key={active.id} active={active} />}
      {residual.map((r) => (
        <ResidualFx key={r.id} fx={r} onDone={() => remove(r.id)} />
      ))}
    </>
  )
}

function ShotFx({ active, plan, director, add }: { active: ActiveCinematic; plan: ShotPlan; director: Director; add: (r: NewResidual) => void }) {
  const [fired, setFired] = useState(false)
  const handle = useRef<BroadsideHandle>(null)
  const skipped = useRef(false)
  const fireAt = beatStart(active.seq, 'fire')
  const flight = active.seq.beats.find((b) => b.name === 'flight')
  const seed = useMemo(() => (plan.result.coord.x * 31 + plan.result.coord.y * 7 + active.id * 101) >>> 0, [plan, active.id])

  const shots = useMemo<BroadsideShot[]>(() => {
    const rnd = seededRandom(seed)
    const miss = plan.result.outcome === 'miss'
    return plan.muzzles.map((m, i) => {
      const jitter = miss ? 0.38 : 0.12
      const to: Vec3 = i === 0 ? plan.impact : [plan.impact[0] + (rnd() - 0.5) * 2 * jitter, plan.impact[1], plan.impact[2] + (rnd() - 0.5) * 2 * jitter]
      return { from: m.position, to }
    })
  }, [plan, seed])

  // the balls must land when the flight beat ends: speed from the chord length and the beat's length
  const { speed, stagger } = useMemo(() => {
    const dur = Math.max(0.25, flight?.duration ?? 1)
    const n = Math.max(1, shots.length)
    const stagger = Math.min(0.14, (dur * 0.25) / n)
    const d = shots.reduce((m, s) => m + Math.hypot(s.to[0] - s.from[0], s.to[2] - s.from[2]), 0) / n
    return { speed: d / Math.max(0.2, dur - stagger * (n - 1) - 0.05), stagger }
  }, [shots, flight])

  useFrame(() => {
    const t = active.clock.t
    if (!fired && t >= fireAt) setFired(true)
    if (active.clock.skipped && !skipped.current) {
      skipped.current = true
      handle.current?.skip()
    }
    const lead = handle.current?.lead() ?? null
    if (lead && lead.inFlight) {
      follow.active = true
      follow.position.copy(lead.position)
      follow.velocity.copy(lead.velocity)
    } else follow.active = false
  })
  useEffect(
    () => () => {
      follow.active = false
    },
    [],
  )

  const ignite = active.seq.level === 'full' && active.seq.budget === 'high'
  const onImpact = useCallback(
    (point: Vec3, index: number) => {
      const s = director.store.getState()
      if (!s.impacted && s.active?.id === active.id) director.store.setState({ impacted: true })
      if (index !== 0) return // one splash / one impact per shot: the lead ball
      if (plan.result.outcome === 'miss') add({ kind: 'splash', position: [point[0], BOARD_LAYOUT.surfaceY, point[2]], seed, scale: 1 })
      else {
        add({ kind: 'hit', position: point, normal: plan.normal, seed, scale: 1 })
        if (ignite) add({ kind: 'burn', position: point, seed, born: performance.now() })
      }
    },
    [plan, seed, add, director, active.id, ignite],
  )

  if (!fired || shots.length === 0) return null
  return <Broadside ref={handle} shots={shots} stagger={stagger} speed={speed} minDuration={0.25} seed={seed} muzzleFx onImpact={onImpact} />
}

function ResidualFx({ fx, onDone }: { fx: Residual; onDone: () => void }) {
  if (fx.kind === 'splash') return <Splash position={fx.position} seed={fx.seed} scale={fx.scale} onDone={onDone} />
  if (fx.kind === 'hit') return <HitFx fx={fx} onDone={onDone} />
  return <BurnFx fx={fx} onDone={onDone} />
}

function HitFx({ fx, onDone }: { fx: Extract<Residual, { kind: 'hit' }>; onDone: () => void }) {
  const done = useRef(0)
  const one = () => {
    done.current++
    if (done.current >= 2) onDone()
  }
  return (
    <>
      <ImpactFlash position={fx.position} normal={fx.normal} scale={fx.scale} onDone={one} />
      <SplinterBurst position={fx.position} normal={fx.normal} seed={fx.seed} count={fx.scale < 1 ? 10 : undefined} waterY={BOARD_LAYOUT.surfaceY} onDone={one} />
    </>
  )
}

/** A hit ignites: a short blaze that fades (group scale, no React state per frame) while the persistent damage takes over. */
function BurnFx({ fx, onDone }: { fx: Extract<Residual, { kind: 'burn' }>; onDone: () => void }) {
  const group = useRef<THREE.Group>(null)
  const t = useRef(0)
  const finished = useRef(false)
  useFrame((_, delta) => {
    if (finished.current) return
    t.current += Math.min(delta, 0.1)
    const u = t.current / BURN_SECONDS
    const k = u < 0.15 ? u / 0.15 : Math.max(0.001, 1 - (u - 0.15) / 0.85)
    group.current?.scale.setScalar(k)
    if (u >= 1) {
      finished.current = true
      onDone()
    }
  })
  const pos: Vec3 = [fx.position[0], fx.position[1] + 0.15, fx.position[2]]
  return (
    <group name="cinematic" ref={group} position={pos} scale={0.001}>
      <Fire position={[0, 0, 0]} seed={fx.seed} scale={0.8} intensity={1} />
      <Smoke position={[0, 0, 0]} seed={fx.seed} scale={0.9} intensity={1} />
    </group>
  )
}

function SinkFx({ active, director, livery }: { active: ActiveCinematic; director: Director; livery: Record<Player, Livery> }) {
  const event = active.event as Extract<ActiveCinematic['event'], { type: 'sink' }>
  const fleet = event.owner === 'human' ? active.fleets.human : active.fleets.enemy
  const ship = fleet.find((s) => s.spec.id === event.shipId)
  const progress = useStore(director.store, (s) => s.sinkProgress[event.shipId] ?? 0)
  const timeScale = useStore(director.store, (s) => s.timeScale)
  if (!ship) return null
  return <SinkWater ship={ship} owner={event.owner} progress={progress} timeScale={timeScale} livery={livery[event.owner]} />
}

function SinkWater({ ship, owner, progress, timeScale, livery }: { ship: PlacedShip; owner: Player; progress: number; timeScale: number; livery: Livery }) {
  const def = SHIPS[ship.spec.id]
  const origin = ownBoardOrigin(owner)
  const transform = useMemo(() => shipWorldTransform(ship, origin), [ship, origin])
  const damage = useMemo(() => damageOf(ship), [ship])
  const seed = placedShipSeed(ship)
  const pose = useMemo(() => placedSinkPose(ship, progress), [ship, progress])
  const bias = useMemo(() => sinkBias(seed, damage, lastHitIndex(ship)), [seed, damage, ship])
  const centers = useMemo(() => ship.cells.map((c) => [origin[0] + (c.x + 0.5), origin[1], origin[2] + (c.y + 0.5)] as Vec3), [ship, origin])
  const pieces = useMemo(
    () => debrisPieces(centers, seed, { position: transform.position, rotationY: transform.rotationY, hull: def.anchors.hull, deckY: def.anchors.deckY, side: bias.side }),
    [centers, seed, transform, def, bias.side],
  )
  const [waterY, setWaterY] = useState(0)
  const last = useRef(0)
  useFrame(({ clock }) => {
    const w = sampleWaveHeight(transform.position[0], transform.position[2], clock.elapsedTime)
    if (Math.abs(w - last.current) > 0.02) {
      last.current = w
      setWaterY(w)
    }
  })
  const hull = def.anchors.hull
  return (
    <>
      <group position={transform.position} rotation-y={transform.rotationY}>
        <HullWash length={hull.length} beam={hull.beam} progress={progress} timeScale={timeScale} waterY={waterY} />
        <Bubbles progress={progress} length={hull.length} beam={hull.beam} seed={seed} timeScale={timeScale} waterY={waterY} />
        <Whirlpool progress={progress} radius={hull.length * 0.75} timeScale={timeScale} waterY={waterY} />
      </group>
      <Debris pieces={pieces} progress={progress} livery={livery} timeScale={timeScale} />
      <Steam pose={pose} damage={damage} position={transform.position} rotationY={transform.rotationY} deckY={def.anchors.deckY} waterY={transform.position[1] + waterY} />
    </>
  )
}

const FIREWORK_COLORS = [
  ['#ffd36b', '#fff3c4', '#ff9f43'],
  ['#ff5e5e', '#ffd1d1', '#ffb347'],
  ['#7ad7ff', '#ffffff', '#b3e5ff'],
  ['#c6ff7a', '#ffffff', '#ffe066'],
]

function VictoryFx({ active }: { active: ActiveCinematic }) {
  const event = active.event as Extract<ActiveCinematic['event'], { type: 'victory' }>
  const won = event.winner === 'human'
  const [bursts, setBursts] = useState<{ id: number; position: Vec3; colors: string[]; seed: number }[]>([])
  const next = useRef(0)
  const count = useRef(0)
  const rnd = useMemo(() => seededRandom(7 + active.id), [active.id])
  const fleet = active.fleets.human
  const origin = ownBoardOrigin('human')
  const center = useMemo<Vec3>(() => [origin[0] + 5, origin[1], origin[2] + 5], [origin])
  const budget = active.seq.level === 'full' && active.seq.budget === 'high' ? FIREWORKS.high : FIREWORKS.low
  useFrame(() => {
    if (!won) return
    const t = active.clock.t
    if (t >= next.current && count.current < budget.bursts) {
      next.current = t + 0.45 + rnd() * 0.3
      const id = count.current++
      setBursts((b) => [
        ...b,
        { id, position: [center[0] + (rnd() - 0.5) * 12, 5 + rnd() * 4, center[2] + (rnd() - 0.5) * 10], colors: FIREWORK_COLORS[id % FIREWORK_COLORS.length], seed: 100 + id },
      ])
    }
  })
  if (won)
    return (
      <>
        {bursts.map((b) => (
          <ParticleBurst
            key={b.id}
            position={b.position}
            colors={b.colors}
            count={budget.count}
            seed={b.seed}
            speed={[2.5, 5]}
            up={[-1, 3.5]}
            size={[0.12, 0.22]}
            life={[1.6, 2.6]}
            gravity={2.2}
            drag={1.2}
            emissive
            onDone={() => setBursts((list) => list.filter((x) => x.id !== b.id))}
          />
        ))}
      </>
    )
  // defeat: the pirate fleet burns
  return (
    <>
      {fleet.map((ship, i) => {
        const pose = shipWorldTransform(ship, origin)
        const p: Vec3 = [pose.position[0], pose.position[1] + SHIPS[ship.spec.id].anchors.deckY * 0.6, pose.position[2]]
        return (
          <group key={ship.spec.id}>
            <Fire position={p} seed={i * 13 + 1} scale={1.3} intensity={1} />
            <Smoke position={p} seed={i * 13 + 2} scale={1.6} intensity={1} />
          </group>
        )
      })}
    </>
  )
}
