import { useFrame } from '@react-three/fiber'
import { useParticlesScale } from '../perf'
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
import { Fire, HullBreach, ImpactFlash, Smoke, SplinterBurst } from '../vfx/damage'
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
  | { id: number; kind: 'splash'; position: Vec3; seed: number; scale: number; delay?: number }
  | { id: number; kind: 'hit'; position: Vec3; normal: Vec3; seed: number; scale: number }
  | { id: number; kind: 'burn'; position: Vec3; seed: number; born: number; deck?: boolean; uid?: string }
  /** A section of the ship the player stands on breaks up: rail and plank chunks tumble into the sea, splashes where they land. */
  | { id: number; kind: 'breakup'; position: Vec3; normal: Vec3; seed: number }
  /** The charred, ragged gap that section leaves for the rest of the game. */
  | { id: number; kind: 'gap'; position: Vec3; normal: Vec3; seed: number; uid?: string }

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type NewResidual = DistributiveOmit<Residual, 'id'>

const DEFAULT_LIVERY: Record<Player, Livery> = { human: 'pirate', enemy: 'navy' }
const BURN_SECONDS = 4.5
/** On-deck blaze at a hit section: full for this long, then it dims to `EMBERS` of its size and stays. */
const DECK_BLAZE_SECONDS = 10
const EMBERS = 0.4
/** A shot lost in the storm only shows a muted splash where it went astray: no marker, no impact, no fire. */
const LOST_SPLASH_SCALE = 0.55
/** Fireworks budget: bursts × particles. */
const FIREWORKS = { high: { bursts: 14, count: 90 }, low: { bursts: 6, count: 50 } }

/**
 * Everything the director shows in the 3D scene: muzzle flashes, smoke, cannonballs in flight, splashes,
 * hull impacts and short-lived fires for shots; the water effects of a sinking ship (the ship itself is
 * posed by `<Fleet sinkProgress>`); fireworks or burning wrecks for a victory. Mount once inside `<OceanScene>`.
 *
 * Budget per shot: one `<Broadside>` (≤ 3 balls at `full`/high, 1 at `fast` or low), exactly one `<Splash>` or one
 * `<ImpactFlash>` + `<SplinterBurst>` (lead ball), and at `full`/high one `<Fire>` + `<Smoke>` ignition for 4.5 s.
 * A shot lost in the storm (stormy seas) is the same broadside with a half-size splash off the target and nothing else.
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
  // persistent damage (gap, blaze) sits at the hull in world space; when that ship goes down it goes with her (BUG-727)
  const sinkingUid = active?.event.type === 'sink' ? active.uid : null
  useEffect(() => {
    if (sinkingUid) setResidual((list) => list.filter((r) => !('uid' in r) || r.uid !== sinkingUid))
  }, [sinkingUid])

  return (
    <>
      {active?.event.type === 'shot' && active.plan && <ShotFx key={active.id} active={active} plan={active.plan} director={director} add={add} />}
      {active?.event.type === 'sink' && <SinkFx key={active.id} active={active} director={director} livery={livery} />}
      {active?.event.type === 'victory' && <VictoryFx key={active.id} active={active} director={director} />}
      {residual.map((r) => (
        <ResidualFx key={r.id} fx={r} onDone={() => remove(r.id)} />
      ))}
    </>
  )
}

function ShotFx({ active, plan, director, add }: { active: ActiveCinematic; plan: ShotPlan; director: Director; add: (r: NewResidual) => void }) {
  const [fired, setFired] = useState(false)
  // the firing ship's wave height at the fire beat: the muzzles ride the hull the eye is attached to, not the still waterline
  const [bob, setBob] = useState(0)
  const handle = useRef<BroadsideHandle>(null)
  const skipped = useRef(false)
  const fireAt = beatStart(active.seq, 'fire')
  const flight = active.seq.beats.find((b) => b.name === 'flight')
  const seed = useMemo(() => (plan.result.coord.x * 31 + plan.result.coord.y * 7 + active.id * 101) >>> 0, [plan, active.id])

  const shots = useMemo<BroadsideShot[]>(() => {
    const rnd = seededRandom(seed)
    const water = plan.result.outcome === 'miss' || plan.result.outcome === 'lost'
    return plan.muzzles.map((m, i) => {
      const jitter = water ? 0.38 : 0.12
      const to: Vec3 = i === 0 ? plan.impact : [plan.impact[0] + (rnd() - 0.5) * 2 * jitter, plan.impact[1], plan.impact[2] + (rnd() - 0.5) * 2 * jitter]
      return { from: [m.position[0], m.position[1] + bob, m.position[2]] as Vec3, to }
    })
  }, [plan, seed, bob])

  // the balls must land when the flight beat ends: speed from the chord length and the beat's length
  const { speed, stagger } = useMemo(() => {
    const dur = Math.max(0.25, flight?.duration ?? 1)
    const n = Math.max(1, shots.length)
    const stagger = Math.min(0.14, (dur * 0.25) / n)
    const d = shots.reduce((m, s) => m + Math.hypot(s.to[0] - s.from[0], s.to[2] - s.from[2]), 0) / n
    return { speed: d / Math.max(0.2, dur - stagger * (n - 1) - 0.05), stagger }
  }, [shots, flight])

  useFrame(({ clock }) => {
    const t = active.clock.t
    if (!fired && t >= fireAt) {
      if (plan.shooter) setBob(sampleWaveHeight(plan.shooter.position[0], plan.shooter.position[2], clock.elapsedTime))
      setFired(true)
    }
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

  // on deck: a ball into the ship you stand on reads at eye height (bigger splinter burst, blaze on the deck at the cell)
  const standingHit = !!active.pov?.standingHit
  const nearby = !!active.pov?.ownSide
  const ignite = (active.seq.level === 'full' || standingHit) && active.seq.budget === 'high'
  const onImpact = useCallback(
    (point: Vec3, index: number) => {
      const s = director.store.getState()
      if (!s.impacted && s.active?.id === active.id) director.store.setState({ impacted: true })
      if (index !== 0) return // one splash / one impact per shot: the lead ball
      if (plan.result.outcome === 'miss') add({ kind: 'splash', position: [point[0], BOARD_LAYOUT.surfaceY, point[2]], seed, scale: nearby ? 1.25 : 1 })
      else if (plan.result.outcome === 'lost') add({ kind: 'splash', position: [point[0], BOARD_LAYOUT.surfaceY, point[2]], seed, scale: LOST_SPLASH_SCALE })
      else {
        add({ kind: 'hit', position: point, normal: plan.normal, seed, scale: standingHit ? 1.6 : 1 })
        const ob = active.pov?.overboard
        if (ob) {
          // the ball took the player's own section: splinters burst where they stood, the sea closes over them a moment later
          add({ kind: 'hit', position: ob.point, normal: [0, 1, 0], seed: seed + 7, scale: 1.3 })
          add({ kind: 'splash', position: ob.splashAt, seed: seed + 3, scale: 1.2, delay: (active.seq.beats.find((b) => b.name === 'overboard')?.duration ?? 1) * 0.3 })
        } else if (standingHit) {
          add({ kind: 'breakup', position: point, normal: plan.normal, seed: seed + 5 })
          add({ kind: 'gap', position: point, normal: plan.normal, seed: seed + 9, uid: plan.victim?.ship.uid })
        }
        if (ignite) {
          const v = plan.victim
          const deckPoint: Vec3 | null = standingHit && v ? [plan.cellCenter[0], v.pose.position[1] + SHIPS[v.ship.spec.id].anchors.deckY, plan.cellCenter[2]] : null
          add({ kind: 'burn', position: deckPoint ?? point, seed, born: performance.now(), deck: deckPoint !== null, uid: v?.ship.uid })
        }
      }
    },
    [plan, seed, add, director, active.id, ignite, standingHit, nearby, active.pov?.overboard, active.seq.beats],
  )

  if (!fired || shots.length === 0) return null
  return <Broadside ref={handle} shots={shots} stagger={stagger} speed={speed} minDuration={0.25} seed={seed} muzzleFx onImpact={onImpact} />
}

function ResidualFx({ fx, onDone }: { fx: Residual; onDone: () => void }) {
  if (fx.kind === 'splash') return <Splash position={fx.position} seed={fx.seed} scale={fx.scale} delay={fx.delay} onDone={onDone} />
  if (fx.kind === 'hit') return <HitFx fx={fx} onDone={onDone} />
  if (fx.kind === 'breakup') return <BreakupFx fx={fx} onDone={onDone} />
  if (fx.kind === 'gap') return <HullBreach position={fx.position} normal={fx.normal} seed={fx.seed} radius={0.26} glowing />
  return <BurnFx fx={fx} onDone={onDone} />
}

/**
 * Budget: one instanced shard mesh (12 big chunks) + two small splashes, all transient; the gap is one persistent decal.
 * The splashes are High-tier only (particlesScale 1): at Medium they pushed the shot frames past the 350-draw budget.
 */
const BREAKUP_SPLASHES: [number, number, number][] = [
  [0.55, 0.35, 0.6],
  [1.0, -0.3, 0.55],
]

/** A hull section of the standing ship breaks up: bulwark and plank chunks tumble out and down into the sea, each landing with a splash. */
function BreakupFx({ fx, onDone }: { fx: Extract<Residual, { kind: 'breakup' }>; onDone: () => void }) {
  const done = useRef(0)
  const splashes = useParticlesScale() >= 1 ? BREAKUP_SPLASHES : []
  const one = () => {
    done.current++
    if (done.current >= 1 + splashes.length) onDone()
  }
  const n = fx.normal
  const out: Vec3 = [n[0], 0.35, n[2]]
  return (
    <>
      <SplinterBurst position={fx.position} normal={out} seed={fx.seed} count={12} size={3.4} speed={[0.9, 2.6]} waterY={BOARD_LAYOUT.surfaceY} onDone={one} />
      {splashes.map(([delay, along, outward], i) => (
        <Splash
          key={i}
          position={[fx.position[0] + n[0] * outward - n[2] * along, BOARD_LAYOUT.surfaceY, fx.position[2] + n[2] * outward + n[0] * along]}
          seed={fx.seed + i}
          scale={0.55}
          delay={delay}
          onDone={one}
        />
      ))}
    </>
  )
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
      <SplinterBurst position={fx.position} normal={fx.normal} seed={fx.seed} count={fx.scale < 1 ? 10 : fx.scale > 1 ? 30 : undefined} waterY={BOARD_LAYOUT.surfaceY} onDone={one} />
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
    if (fx.deck) {
      // the section the player's ship lost keeps burning for the rest of the game: full blaze, then embers after ~10 s (cheaper)
      const a = t.current
      const k = a < 0.6 ? a / 0.6 : a < DECK_BLAZE_SECONDS ? 1 : Math.max(EMBERS, 1 - (a - DECK_BLAZE_SECONDS) / 3)
      group.current?.scale.setScalar(k)
      return
    }
    const u = t.current / BURN_SECONDS
    const k = u < 0.15 ? u / 0.15 : Math.max(0.001, 1 - (u - 0.15) / 0.85)
    group.current?.scale.setScalar(k)
    if (u >= 1) {
      finished.current = true
      onDone()
    }
  })
  // `deck`: the blaze sits on the planks of the ship the player stands on, sized to read from 0.3–3 u
  const pos: Vec3 = [fx.position[0], fx.position[1] + (fx.deck ? 0.04 : 0.15), fx.position[2]]
  return (
    <group name="cinematic" ref={group} position={pos} scale={0.001}>
      <Fire position={[0, 0, 0]} seed={fx.seed} scale={fx.deck ? 1.1 : 0.8} intensity={1} />
      <Smoke position={[0, 0, 0]} seed={fx.seed} scale={fx.deck ? 1.2 : 0.9} intensity={1} />
    </group>
  )
}

function SinkFx({ active, director, livery }: { active: ActiveCinematic; director: Director; livery: Record<Player, Livery> }) {
  const event = active.event as Extract<ActiveCinematic['event'], { type: 'sink' }>
  const fleet = event.owner === 'human' ? active.fleets.human : active.fleets.enemy
  const uid = event.uid ?? event.shipId
  const ship = fleet.find((s) => s.uid === uid)
  const progress = useStore(director.store, (s) => s.sinkProgress[uid] ?? 0)
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

function VictoryFx({ active, director }: { active: ActiveCinematic; director: Director }) {
  const event = active.event as Extract<ActiveCinematic['event'], { type: 'victory' }>
  // single player celebrates / mourns the pirates' board; a hot-seat game celebrates on the winner's side (the director's perspective)
  const perspective = useStore(director.store, (s) => s.perspective)
  const won = event.winner === perspective
  const [bursts, setBursts] = useState<{ id: number; position: Vec3; colors: string[]; seed: number }[]>([])
  const next = useRef(0)
  const count = useRef(0)
  const rnd = useMemo(() => seededRandom(7 + active.id), [active.id])
  const fleet = active.fleets[perspective]
  const origin = ownBoardOrigin(perspective)
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
          <group key={ship.uid}>
            <Fire position={p} seed={i * 13 + 1} scale={1.3} intensity={1} />
            <Smoke position={p} seed={i * 13 + 2} scale={1.6} intensity={1} />
          </group>
        )
      })}
    </>
  )
}
