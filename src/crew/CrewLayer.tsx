/**
 * Crew on deck. One `InstancedMesh` of a unit box per board draws every figure part of every ship on that board
 * (9 boxes a figure: 2 legs, torso, 2 arms, head, hat brim + crown) — 1 draw call per board, ~108 triangles a figure,
 * ≤ 864 a ship. Poses come from `samplePose` on the CPU; the instance matrices are rebuilt every frame from
 * module-level scratch objects (no per-frame allocation). Figures ride the same wave + `sinkPose` transform as `Fleet`.
 *
 * Reactions: a new hit on a ship throws the nearest figure overboard (splash → swim ~3 s → fade) and stumbles the
 * others within a cell; a sinking ship empties its deck over the first ~1.5 s. Reduced motion swaps the tumble for a
 * short fade; the Low tier carries 2 crew a ship and skips the swim.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { PlacedShip } from '../engine'
import { BOARD_LAYOUT, type Vec3 } from '../scene/layout'
import { sampleWaveHeight } from '../scene/waves'
import { SHIPS, damageOf, shipWorldTransform } from '../ships'
import type { CellDamage, Livery } from '../ships/types'
import { clampToPolygon, pushOutOfObstacles, resolveDeckAnchors, dist, type Pt } from '../deck/math'
import { Splash } from '../vfx/cannon'
import { lastHitIndex, placedShipSeed, sinkPose } from '../vfx/sinking'
import { CLIPS, blendPose, makePose, samplePose, type AnimName, type Pose } from './anim'
import { CREW_RADIUS, PLAYER_CLEARANCE, crewCountFor, placeCrew, reactionFor, rng, type CrewSlot } from './placement'
import { playerDeck } from './playerPose'

export const PARTS = 9
const GRAVITY = 3.2
const SWIM_SECONDS = 3
const FADE_SECONDS = 0.6
const ABANDON_WINDOW = 1.5
const MAX_SPLASHES = 4
const SHUFFLE_SPEED = 0.35
const CROSSFADE = 0.18

export interface CrewLayerProps {
  ships: readonly PlacedShip[]
  livery: Livery
  /** false = crew only on sunk ships (same rule as `Fleet`: hidden enemy ships must not leak). */
  revealed?: boolean
  boardOrigin?: Vec3
  sinkProgress?: Partial<Record<string, number>>
  low?: boolean
  reducedMotion?: boolean
}

type FigState = 'deck' | 'jump' | 'thrown' | 'swim' | 'fade' | 'gone'

interface Fig {
  slot: CrewSlot
  x: number
  z: number
  y: number
  yaw: number
  anim: AnimName
  time: number
  /** Clip to return to after a one-shot. */
  resume: AnimName
  prev: AnimName | null
  prevTime: number
  blend: number
  state: FigState
  timer: number
  /** World-space position / velocity once off the deck. */
  wx: number
  wy: number
  wz: number
  vx: number
  vy: number
  vz: number
  spin: number
  tumble: number
  /** Overall scale (fades). */
  scale: number
  displaced: boolean
  colour: number
}

interface ShipCrew {
  uid: string
  figs: Fig[]
  hitsSeen: number
  damage: readonly CellDamage[]
  sunk: boolean
  random: () => number
}

export const crewPerf = { ms: 0, max: 0, figures: 0, deck: 0, thrown: 0, swim: 0 }
const layerPerf = new Map<string, { ms: number; figures: number; deck: number; thrown: number; swim: number }>()
function reportPerf(key: string, ms: number, figures: number, deck: number, thrown: number, swim: number): void {
  let l = layerPerf.get(key)
  if (!l) layerPerf.set(key, (l = { ms: 0, figures: 0, deck: 0, thrown: 0, swim: 0 }))
  l.ms = ms
  l.figures = figures
  l.deck = deck
  l.thrown = thrown
  l.swim = swim
  let sum = 0
  let fig = 0
  let d = 0
  let th = 0
  let sw = 0
  for (const x of layerPerf.values()) {
    sum += x.ms
    fig += x.figures
    d += x.deck
    th += x.thrown
    sw += x.swim
  }
  crewPerf.ms = crewPerf.ms * 0.9 + sum * 0.1
  crewPerf.max = Math.max(crewPerf.max, sum)
  crewPerf.figures = fig
  crewPerf.deck = d
  crewPerf.thrown = th
  crewPerf.swim = sw
}
if (typeof window !== 'undefined') (window as unknown as { __crewPerf?: typeof crewPerf }).__crewPerf = crewPerf

// ---- colours -----------------------------------------------------------------------------------------------------
const SKIN = [0xd9a066, 0x8d5524, 0xeac086]
const SHIRTS: Record<Livery, number[]> = { pirate: [0xe8dcc0, 0x8b1e1e, 0x2c2c2c], navy: [0x1c2f5a, 0xe8dcc0, 0x3b4f7a] }
const HAT: Record<Livery, number> = { pirate: 0xb01c1c, navy: 0x15161c }
const TROUSERS = [0x3a2a1e, 0x1f1f2a, 0x4a3b2a]
const tmpColor = new THREE.Color()

// ---- scratch -----------------------------------------------------------------------------------------------------
const ONE = new THREE.Vector3(1, 1, 1)
const IDENT_Q = new THREE.Quaternion()
const v = new THREE.Vector3()
const v2 = new THREE.Vector3()
const s = new THREE.Vector3()
const e = new THREE.Euler()
const q = new THREE.Quaternion()
const q2 = new THREE.Quaternion()
const shipM = new THREE.Matrix4()
const figM = new THREE.Matrix4()
const torsoM = new THREE.Matrix4()
const partM = new THREE.Matrix4()
const tmpM = new THREE.Matrix4()
const poseA = makePose()
const poseB = makePose()
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0)
/** Figures are drawn a little over scale so they read from the overview camera (a figure ≈ 0.24 u tall). */
export const FIGURE_SCALE = 1.25
const FIG = new THREE.Vector3(FIGURE_SCALE, FIGURE_SCALE, FIGURE_SCALE)

/** parent × T(pivot) × R(euler) → `out`; also writes the part box (centre offset `c`, size `sz`) to `mesh[index]`. */
function part(mesh: THREE.InstancedMesh, index: number, parent: THREE.Matrix4, px: number, py: number, pz: number, rx: number, ry: number, rz: number, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, out: THREE.Matrix4): void {
  q.setFromEuler(e.set(rx, ry, rz, 'YXZ'))
  out.compose(v.set(px, py, pz), q, ONE).premultiply(parent)
  partM.compose(v.set(cx, cy, cz), IDENT_Q, s.set(sx, sy, sz)).premultiply(out)
  mesh.setMatrixAt(index, partM)
}

/** Write the 9 part matrices of one figure (frame `fig`: feet at origin, facing −z) posed by `p`. */
function writeFigure(mesh: THREE.InstancedMesh, base: number, fig: THREE.Matrix4, p: Pose): void {
  const hipY = 0.075 - p.crouch * 0.03
  const legLen = 0.075 * (1 - 0.4 * p.crouch)
  const kneeBend = p.crouch * 0.5
  // legs
  part(mesh, base, fig, -0.013, hipY, 0, p.legL + kneeBend, 0, 0, 0, -legLen / 2, 0, 0.022, legLen, 0.022, tmpM)
  part(mesh, base + 1, fig, 0.013, hipY, 0, p.legR - kneeBend * 0.6, 0, 0, 0, -legLen / 2, 0, 0.022, legLen, 0.022, tmpM)
  // torso
  part(mesh, base + 2, fig, 0, hipY, 0, p.lean, p.twist, p.roll, 0, 0.03, 0, 0.05, 0.06, 0.03, torsoM)
  // arms (shoulders at the torso's top corners)
  part(mesh, base + 3, torsoM, -0.033, 0.055, 0, p.armL, 0, -p.armLOut, 0, -0.03, 0, 0.016, 0.06, 0.016, tmpM)
  part(mesh, base + 4, torsoM, 0.033, 0.055, 0, p.armR, 0, p.armROut, 0, -0.03, 0, 0.016, 0.06, 0.016, tmpM)
  // head + hat
  part(mesh, base + 5, torsoM, 0, 0.06, 0, p.head, 0, 0, 0, 0.017, 0, 0.03, 0.03, 0.03, tmpM)
  partM.compose(v.set(0, 0.035, 0), IDENT_Q, s.set(0.046, 0.007, 0.046)).premultiply(tmpM)
  mesh.setMatrixAt(base + 6, partM)
  partM.compose(v.set(0, 0.045, 0), IDENT_Q, s.set(0.028, 0.016, 0.028)).premultiply(tmpM)
  mesh.setMatrixAt(base + 7, partM)
  // belt / sash
  partM.compose(v.set(0, 0.004, 0), IDENT_Q, s.set(0.052, 0.008, 0.032)).premultiply(torsoM)
  mesh.setMatrixAt(base + 8, partM)
}

function paintFigure(mesh: THREE.InstancedMesh, base: number, livery: Livery, variant: number): void {
  const shirt = SHIRTS[livery][variant % 3]
  const skin = SKIN[Math.floor(variant / 2) % 3]
  const trousers = TROUSERS[variant % 3]
  const hat = variant % 4 === 3 ? 0x2a2a2a : HAT[livery]
  const set = (i: number, c: number) => mesh.setColorAt(base + i, tmpColor.setHex(c))
  set(0, trousers)
  set(1, trousers)
  set(2, shirt)
  set(3, shirt)
  set(4, shirt)
  set(5, skin)
  set(6, hat)
  set(7, hat)
  set(8, livery === 'pirate' ? 0x5a1414 : 0xd9c27a)
}

const sunkOf = (ship: PlacedShip): boolean => ship.hits.length >= ship.spec.length

function makeFig(slot: CrewSlot): Fig {
  return { slot, x: slot.x, z: slot.z, y: slot.y, yaw: slot.yaw, anim: slot.anim, time: slot.variant * 0.37, resume: slot.anim, prev: null, prevTime: 0, blend: 1, state: 'deck', timer: 0, wx: 0, wy: 0, wz: 0, vx: 0, vy: 0, vz: 0, spin: 0, tumble: 0, scale: 1, displaced: false, colour: slot.variant }
}

function play(f: Fig, anim: AnimName, resume: AnimName = f.resume): void {
  if (f.anim === anim) return
  f.prev = f.anim
  f.prevTime = f.time
  f.blend = 0
  f.anim = anim
  f.time = 0
  f.resume = resume
}

function samplePoseOf(f: Fig, out: Pose): Pose {
  samplePose(CLIPS[f.anim], f.time, out)
  if (f.prev && f.blend < 1) {
    samplePose(CLIPS[f.prev], f.prevTime, poseB)
    blendPose(poseB, out, f.blend, out)
  }
  return out
}

interface SplashFx {
  id: number
  position: Vec3
  seed: number
}

export function CrewLayer({ ships, livery, revealed = true, boardOrigin = BOARD_LAYOUT.player.origin, sinkProgress, low = false, reducedMotion = false }: CrewLayerProps) {
  'use no memo'
  const capacity = Math.max(1, ships.length) * 8 * PARTS
  const mesh = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff })
    const m = new THREE.InstancedMesh(geo, mat, capacity)
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    m.frustumCulled = false
    m.castShadow = false
    m.receiveShadow = false
    m.count = 0
    m.name = 'crew'
    return m
  }, [capacity])
  useEffect(() => () => disposeMesh(mesh), [mesh])

  const crews = useRef(new Map<string, ShipCrew>())
  const painted = useRef(new Map<string, number>())
  const [splashes, setSplashes] = useState<SplashFx[]>([])
  const splashId = useRef(0)
  const pending = useRef<SplashFx[]>([])

  const visible = useMemo(() => ships.filter((ship) => revealed || sunkOf(ship)), [ships, revealed])
  const perfKey = `${boardOrigin[0]},${boardOrigin[2]}`
  useEffect(() => () => void layerPerf.delete(perfKey), [perfKey])

  useFrame(({ clock }, dt) => {
    const t0 = performance.now()
    const delta = Math.min(dt, 0.1)
    const time = clock.elapsedTime
    const map = crews.current
    // retire crews of ships that left the list
    if (map.size > visible.length) {
      for (const uid of map.keys()) if (!visible.some((sh) => sh.uid === uid)) map.delete(uid)
    }
    let index = 0
    let figures = 0
    let onDeck = 0
    let thrown = 0
    let swimming = 0
    let repaint = false
    for (const ship of visible) {
      const anchors = SHIPS[ship.spec.id].anchors
      const sunk = sunkOf(ship)
      let crew = map.get(ship.uid)
      if (!crew) {
        const seed = placedShipSeed(ship)
        const slots = placeCrew(anchors, seed, crewCountFor(ship.spec.id, low))
        crew = { uid: ship.uid, figs: slots.map(makeFig), hitsSeen: ship.hits.length, damage: damageOf(ship), sunk: false, random: rng(seed ^ 0x9e3779b9) }
        map.set(ship.uid, crew)
        repaint = true
        if (sunk) {
          // joined already sunk (e.g. enemy revealed by sinking mid-cinematic): empty the deck quickly
          for (const f of crew.figs) if ((sinkProgress?.[ship.uid] ?? 1) >= 0.6) f.state = 'gone'
        }
      }
      // --- new hits → reactions
      if (ship.hits.length !== crew.hitsSeen) {
        const next = damageOf(ship)
        const gone = crew.figs.map((f) => f.state !== 'deck')
        for (let c = 0; c < next.length; c++) {
          if (next[c] === crew.damage[c] || crew.damage[c] !== 'intact') continue
          const r = reactionFor(crew.figs.map((f) => f.slot), c, ship.spec.length, gone)
          if (r.thrown >= 0 && !sunk) throwFig(crew.figs[r.thrown], ship, boardOrigin, crew.random, reducedMotion, 1.0)
          for (const i of r.stumble) {
            const f = crew.figs[i]
            if (f.state === 'deck') play(f, 'stumble', f.resume)
          }
        }
        crew.damage = next
        crew.hitsSeen = ship.hits.length
      }
      // --- sink → abandon ship over the first ~1.5 s
      if (sunk && !crew.sunk) {
        crew.sunk = true
        for (const f of crew.figs) {
          if (f.state !== 'deck') continue
          f.state = 'jump'
          f.timer = crew.random() * ABANDON_WINDOW
        }
      }
      // --- ship transform (same as Fleet / DeckController)
      const { position, rotationY } = shipWorldTransform(ship, boardOrigin)
      const sink = sinkProgress?.[ship.uid] ?? (sunk ? 1 : 0)
      let depth = 0
      let roll = 0
      let pitch = 0
      let yaw = 0
      if (sink > 0) {
        const sp = sinkPose(sink, { seed: placedShipSeed(ship), hull: anchors.hull, damage: crew.damage, lastHit: lastHitIndex(ship) })
        depth = sp.depth
        roll = sp.roll
        pitch = sp.pitch
        yaw = sp.yaw
      }
      const shipY = position[1] - depth + sampleWaveHeight(position[0], position[2], time)
      q.setFromEuler(e.set(0, rotationY + yaw, 0))
      q.multiply(q2.setFromEuler(e.set(roll, 0, pitch)))
      shipM.compose(v.set(position[0], shipY, position[2]), q, ONE)
      const onThisDeck = playerDeck.uid === ship.uid

      for (const f of crew.figs) {
        const base = index
        index += PARTS
        if (f.state === 'gone') {
          for (let i = 0; i < PARTS; i++) mesh.setMatrixAt(base + i, ZERO_M)
          continue
        }
        figures++
        if (f.state === 'deck') onDeck++
        else if (f.state === 'thrown' || f.state === 'jump') thrown++
        else swimming++
        f.time += delta
        if (f.blend < 1) f.blend = Math.min(1, f.blend + delta / CROSSFADE)
        const clip = CLIPS[f.anim]
        if (!clip.loop && f.time >= clip.duration && f.state === 'deck') play(f, f.resume)

        if (f.state === 'deck') {
          stepAside(f, anchors, onThisDeck)
          figM.compose(v.set(f.x, f.y, f.z), q.setFromEuler(e.set(0, f.yaw, 0)), FIG).premultiply(shipM)
          writeFigure(mesh, base, figM, samplePoseOf(f, poseA))
        } else if (f.state === 'jump') {
          f.timer -= delta
          if (f.timer <= 0) {
            play(f, 'jump')
            f.timer = 0.3
            f.state = 'thrown'
            // launch at the end of the crouch
            throwFig(f, ship, boardOrigin, crew.random, reducedMotion, 0.8, shipM)
          } else {
            figM.compose(v.set(f.x, f.y, f.z), q.setFromEuler(e.set(0, f.yaw, 0)), FIG).premultiply(shipM)
            writeFigure(mesh, base, figM, samplePoseOf(f, poseA))
          }
        } else if (f.state === 'thrown') {
          f.vy -= GRAVITY * delta
          f.wx += f.vx * delta
          f.wy += f.vy * delta
          f.wz += f.vz * delta
          f.tumble += f.spin * delta
          const water = BOARD_LAYOUT.surfaceY + sampleWaveHeight(f.wx, f.wz, time)
          if (f.wy <= water && f.vy < 0) {
            f.wy = water
            queueSplash(pending.current, splashId, f.wx, water, f.wz, crew.random())
            if (low) {
              f.state = 'gone'
              for (let i = 0; i < PARTS; i++) mesh.setMatrixAt(base + i, ZERO_M)
              continue
            }
            f.state = 'swim'
            f.timer = SWIM_SECONDS
            play(f, 'swim')
          } else {
            q.setFromEuler(e.set(f.tumble, f.yaw, f.tumble * 0.6))
            figM.compose(v.set(f.wx, f.wy, f.wz), q, FIG)
            writeFigure(mesh, base, figM, samplePoseOf(f, poseA))
          }
        } else if (f.state === 'swim') {
          f.timer -= delta
          const water = BOARD_LAYOUT.surfaceY + sampleWaveHeight(f.wx, f.wz, time)
          f.wx += f.vx * 0.15 * delta
          f.wz += f.vz * 0.15 * delta
          if (f.timer <= 0) {
            f.state = 'fade'
            f.timer = FADE_SECONDS
          }
          figM.compose(v.set(f.wx, water - 0.03, f.wz), q.setFromEuler(e.set(0, f.yaw, 0)), FIG)
          writeFigure(mesh, base, figM, samplePoseOf(f, poseA))
        } else if (f.state === 'fade') {
          f.timer -= delta
          const k = Math.max(0, f.timer / FADE_SECONDS)
          if (k <= 0) {
            f.state = 'gone'
            for (let i = 0; i < PARTS; i++) mesh.setMatrixAt(base + i, ZERO_M)
            continue
          }
          if (f.wy === Infinity) {
            // reduced-motion fade in place on deck
            figM.compose(v.set(f.x, f.y, f.z), q.setFromEuler(e.set(0, f.yaw, 0)), s.set(k * FIGURE_SCALE, k * FIGURE_SCALE, k * FIGURE_SCALE)).premultiply(shipM)
          } else {
            const water = BOARD_LAYOUT.surfaceY + sampleWaveHeight(f.wx, f.wz, time)
            figM.compose(v.set(f.wx, water - 0.03 - (1 - k) * 0.12, f.wz), q.setFromEuler(e.set(0, f.yaw, 0)), s.set(k * FIGURE_SCALE, k * FIGURE_SCALE, k * FIGURE_SCALE))
          }
          writeFigure(mesh, base, figM, samplePoseOf(f, poseA))
        }
      }
    }
    if (repaint || painted.current.size !== map.size) {
      let base = 0
      painted.current.clear()
      for (const ship of visible) {
        const crew = map.get(ship.uid)
        if (!crew) continue
        for (const f of crew.figs) {
          paintFigure(mesh, base, livery, f.colour)
          base += PARTS
        }
        painted.current.set(ship.uid, 1)
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    mesh.count = index
    mesh.instanceMatrix.needsUpdate = true
    if (pending.current.length) {
      const batch = pending.current
      pending.current = []
      setSplashes((prev) => [...prev, ...batch].slice(-MAX_SPLASHES))
    }
    reportPerf(perfKey, performance.now() - t0, figures, onDeck, thrown, swimming)
  })

  return (
    <group name="crew-layer">
      <primitive object={mesh} />
      {splashes.map((sp) => (
        <Splash key={sp.id} position={sp.position} seed={sp.seed} scale={0.45} onDone={() => setSplashes((prev) => prev.filter((x) => x.id !== sp.id))} />
      ))}
    </group>
  )
}

function disposeMesh(m: THREE.InstancedMesh): void {
  m.geometry.dispose()
  ;(m.material as THREE.Material).dispose()
  m.dispose()
}

function queueSplash(list: SplashFx[], idRef: { current: number }, x: number, y: number, z: number, r: number): void {
  if (list.length >= MAX_SPLASHES) return
  list.push({ id: ++idRef.current, position: [x, y, z], seed: Math.floor(r * 1e6) })
}

/** Launch `f` over the nearest rail: world position from its current deck spot, outward velocity, tumble. */
function throwFig(f: Fig, ship: PlacedShip, boardOrigin: Vec3, random: () => number, reducedMotion: boolean, power: number, ready?: THREE.Matrix4): void {
  if (f.state !== 'deck' && f.state !== 'thrown') return
  if (reducedMotion) {
    f.state = 'fade'
    f.timer = FADE_SECONDS
    f.wy = Infinity
    return
  }
  let m = ready
  if (!m) {
    const { position, rotationY } = shipWorldTransform(ship, boardOrigin)
    // on a hit the ship is still afloat: wave height only (sink pose starts at the sink event)
    shipM.compose(v.set(position[0], position[1] + sampleWaveHeight(position[0], position[2], performance.now() / 1000), position[2]), q.setFromEuler(e.set(0, rotationY, 0)), ONE)
    m = shipM
  }
  v2.set(f.x, f.y + 0.02, f.z).applyMatrix4(m)
  f.wx = v2.x
  f.wy = v2.y
  f.wz = v2.z
  const side = f.z >= 0 ? 1 : -1
  const beam = SHIPS[ship.spec.id].anchors.hull.beam
  // outward (ship-local +/−z) plus a little along the hull, rotated into the world
  v2.set((random() - 0.5) * 0.5, 0, side * (0.5 + beam * 0.6)).applyMatrix4(tmpM.extractRotation(m))
  const speed = power * (0.9 + random() * 0.3)
  f.vx = v2.x * speed
  f.vz = v2.z * speed
  f.vy = (0.9 + random() * 0.4) * power
  f.spin = (random() - 0.5) * 10
  f.tumble = 0
  f.state = 'thrown'
  play(f, 'fall')
}

/** Keep the figure ≥ PLAYER_CLEARANCE from the player (and off a manned station); drift home when the way is clear. */
function stepAside(f: Fig, anchors: (typeof SHIPS)[keyof typeof SHIPS]['anchors'], onThisDeck: boolean): void {
  if (!onThisDeck) {
    if (!f.displaced) return
    moveToward(f, f.slot.x, f.slot.z)
    return
  }
  const dx = f.x - playerDeck.x
  const dz = f.z - playerDeck.z
  const d = Math.hypot(dx, dz)
  const manned = f.slot.station >= 0 && f.slot.station === playerDeck.station
  if (d < PLAYER_CLEARANCE || (manned && d < PLAYER_CLEARANCE + 0.15)) {
    const away = d > 1e-4 ? 1 / d : 0
    const ux = d > 1e-4 ? dx * away : Math.sin(f.yaw)
    const uz = d > 1e-4 ? dz * away : Math.cos(f.yaw)
    const want = PLAYER_CLEARANCE + 0.08
    const deck = resolveDeckAnchors(anchors)
    let p: Pt = [playerDeck.x + ux * want, playerDeck.z + uz * want]
    if (deck.walk[0]) p = clampToPolygon(p, deck.walk[0].points)
    p = pushOutOfObstacles(p, deck.obstacles, CREW_RADIUS)
    // if the clamp pushed us back into the player, slide along the rail instead
    if (dist(p, [playerDeck.x, playerDeck.z]) < PLAYER_CLEARANCE - 0.02) p = [f.x + uz * 0.2, f.z - ux * 0.2]
    f.displaced = true
    moveToward(f, p[0], p[1])
    return
  }
  if (f.displaced) {
    const homeD = Math.hypot(f.slot.x - playerDeck.x, f.slot.z - playerDeck.z)
    if (homeD > PLAYER_CLEARANCE + 0.1 && !(manned)) moveToward(f, f.slot.x, f.slot.z)
    else if (f.anim === 'shuffle') play(f, 'idle', f.resume)
  }
}

function moveToward(f: Fig, tx: number, tz: number): void {
  const dx = tx - f.x
  const dz = tz - f.z
  const d = Math.hypot(dx, dz)
  if (d < 0.01) {
    f.x = tx
    f.z = tz
    if (Math.abs(tx - f.slot.x) < 0.01 && Math.abs(tz - f.slot.z) < 0.01) {
      f.displaced = false
      f.yaw = f.slot.yaw
      if (f.anim === 'shuffle') play(f, f.resume, f.resume)
    } else if (f.anim === 'shuffle') play(f, 'idle', f.resume)
    return
  }
  const step = Math.min(d, SHUFFLE_SPEED * (1 / 60))
  f.x += (dx / d) * step
  f.z += (dz / d) * step
  f.yaw = Math.atan2(-dx, -dz)
  if (f.anim !== 'shuffle') play(f, 'shuffle', f.resume)
}
