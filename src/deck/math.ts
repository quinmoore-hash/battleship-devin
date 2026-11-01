/**
 * Pure geometry for the On-deck mode (no three, no React): the walkable-deck fallback, the player clamp
 * (polygons + ramps + obstacles), cannon stations and their usability, look vectors and the crosshair ray.
 * Ship space throughout: bow +x, stern −x, starboard +z, waterline y = 0 (see ARCHITECTURE.md).
 */
import type { Coord } from '../engine'
import { worldToCell, type Vec3 } from '../scene/layout'
import type { ShipAnchors, Side } from '../ships/types'
import { EYE_HEIGHT, type DeckAnchors } from './contract'

/** Walking / running speed, ship units per second (a sailor is EYE_HEIGHT ≈ 0.17 u tall). */
export const WALK_SPEED = 0.25
export const RUN_SPEED = 0.5
/** The player's collision radius against obstacles. */
export const PLAYER_RADIUS = 0.03
/** How close (u) to a station's stand the player must be to man the gun. */
export const STATION_REACH = 0.12
/** Fallback stand: this far inboard of the muzzle. */
export const STAND_INSET = 0.12
/** Fallback rectangle: hull length × beam shrunk by this margin. */
export const FALLBACK_INSET = 0.06
export const MAST_RADIUS = 0.05
/** Half-width of the band around a ramp segment over which the deck height blends between the two levels. */
export const RAMP_BLEND = 0.12
/** Mouse-look pitch clamp, radians (±85°). */
export const PITCH_LIMIT = (85 * Math.PI) / 180
/** Radians of look per pixel of mouse movement at sensitivity 1. */
export const LOOK_PER_PIXEL = 0.0022
/** Radians per second for keyboard look (arrow keys when pointer lock is refused). */
export const KEY_LOOK_SPEED = 1.6

export type Pt = [number, number]

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Axis-aligned rectangle `length × beam` centred on the origin, shrunk by `inset`, as a CCW polygon in x/z. */
export function rectPolygon(length: number, beam: number, inset = 0): Pt[] {
  const hx = Math.max(0.01, length / 2 - inset)
  const hz = Math.max(0.01, beam / 2 - inset)
  return [
    [-hx, -hz],
    [hx, -hz],
    [hx, hz],
    [-hx, hz],
  ]
}

/**
 * Walkable deck for a class that has not authored `ShipAnchors.deck` yet (`DECK_ANCHORS_FALLBACK`): the hull rectangle
 * at `deckY`, masts as round obstacles, one station per cannon 0.12 u inboard of its muzzle, spawn on the quarterdeck.
 */
export function fallbackDeckAnchors(a: ShipAnchors): DeckAnchors {
  const { length, beam } = a.hull
  const hx = length / 2 - FALLBACK_INSET
  return {
    // the waist, aft of the main mast and off the centreline so the mast is not in your face: open main deck on every
    // class (the stern often carries a cabin / poop the fallback rectangle knows nothing about)
    spawn: [clamp(-0.45, -hx + 0.05, hx - 0.05), a.deckY, Math.min(0.25, beam * 0.2)],
    walk: [{ points: rectPolygon(length, beam, FALLBACK_INSET), y: a.deckY }],
    ramps: [],
    obstacles: a.masts.map((m) => ({ center: [m.base[0], m.base[2]] as Pt, radius: MAST_RADIUS })),
    stations: a.cannons.map((c) => ({
      stand: [c.muzzle[0] - c.direction[0] * STAND_INSET, a.deckY, c.muzzle[2] - c.direction[2] * STAND_INSET] as Vec3,
      yaw: yawToward(c.direction[0], c.direction[2]),
    })),
  }
}

/** Eye height over the fallback rectangle: the models' waist bulwarks are ~0.27 u, so the contract's 0.17 would see only planks. */
export const FALLBACK_EYE = 0.3

const fallbackDecks = new WeakSet<DeckAnchors>()

/** The authored deck when session C has shipped it, else the fallback (see `isFallbackDeck`). */
export function resolveDeckAnchors(a: ShipAnchors & { deck?: DeckAnchors }): DeckAnchors {
  if (a.deck && a.deck.walk.length > 0) return a.deck
  const d = fallbackDeckAnchors(a)
  fallbackDecks.add(d)
  return d
}

export const isFallbackDeck = (d: DeckAnchors): boolean => fallbackDecks.has(d)

/** Eye height above the feet for this deck. */
export const eyeFor = (d: DeckAnchors): number => (isFallbackDeck(d) ? FALLBACK_EYE : EYE_HEIGHT)

// ---- polygons -------------------------------------------------------------------------------------------------

/** Twice the signed area (positive = counter-clockwise in x/z). */
function signedArea2(poly: readonly Pt[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s
}

/** Inside-or-on test for a convex polygon of either winding. */
export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  if (poly.length < 3) return false
  const sign = signedArea2(poly) >= 0 ? 1 : -1
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    if (cross * sign < -1e-9) return false
  }
  return true
}

function closestOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const l2 = dx * dx + dz * dz
  const t = l2 > 0 ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2, 0, 1) : 0
  return [a[0] + dx * t, a[1] + dz * t]
}

export const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Closest point on the polygon's boundary. */
export function closestPointOnPolygon(p: Pt, poly: readonly Pt[]): Pt {
  let best: Pt = poly[0]
  let bestD = Infinity
  for (let i = 0; i < poly.length; i++) {
    const q = closestOnSegment(p, poly[i], poly[(i + 1) % poly.length])
    const d = dist(p, q)
    if (d < bestD) {
      bestD = d
      best = q
    }
  }
  return best
}

/** Clamp `p` into the polygon (inside stays put, outside snaps to the nearest boundary point). */
export function clampToPolygon(p: Pt, poly: readonly Pt[]): Pt {
  return pointInPolygon(p, poly) ? p : closestPointOnPolygon(p, poly)
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const o1 = o(a, b, c)
  const o2 = o(a, b, d)
  const o3 = o(c, d, a)
  const o4 = o(c, d, b)
  return o1 * o2 <= 0 && o3 * o4 <= 0
}

/** Push `p` out of every circle it overlaps (player radius added). Two passes settle the usual mast-pair case. */
export function pushOutOfObstacles(p: Pt, obstacles: DeckAnchors['obstacles'], radius = PLAYER_RADIUS): Pt {
  let x = p[0]
  let z = p[1]
  for (let pass = 0; pass < 2; pass++) {
    for (const o of obstacles) {
      const r = o.radius + radius
      let dx = x - o.center[0]
      let dz = z - o.center[1]
      const d = Math.hypot(dx, dz)
      if (d >= r) continue
      if (d < 1e-6) {
        dx = 1
        dz = 0
      } else {
        dx /= d
        dz /= d
      }
      x = o.center[0] + dx * r
      z = o.center[1] + dz * r
    }
  }
  return [x, z]
}

export interface WalkPose {
  x: number
  z: number
  /** Deck height under the feet (ramps blend between levels). */
  y: number
  /** Index into `deck.walk`. */
  level: number
}

/** Which walk polygon contains `p`, preferring `prefer`; −1 when none. */
export function levelAt(p: Pt, deck: DeckAnchors, prefer = 0): number {
  if (deck.walk[prefer] && pointInPolygon(p, deck.walk[prefer].points)) return prefer
  for (let i = 0; i < deck.walk.length; i++) if (i !== prefer && pointInPolygon(p, deck.walk[i].points)) return i
  return -1
}

/** Deck height at `p` on `level`, blended toward the neighbouring level within `RAMP_BLEND` of a ramp segment. */
export function deckHeightAt(p: Pt, level: number, deck: DeckAnchors): number {
  const base = deck.walk[level]?.y ?? 0
  let y = base
  let best = Infinity
  for (const r of deck.ramps) {
    const otherLevel = r.from === level ? r.to : r.to === level ? r.from : -1
    if (otherLevel < 0 || !deck.walk[otherLevel]) continue
    const d = dist(p, closestOnSegment(p, r.a, r.b))
    if (d >= RAMP_BLEND || d >= best) continue
    best = d
    const other = deck.walk[otherLevel].y
    // at the segment itself both levels agree on the midpoint, so crossing it is continuous
    y = base + (other - base) * 0.5 * (1 - d / RAMP_BLEND)
  }
  return y
}

/**
 * Move the player from `from` by (`dx`, `dz`) on the walkable deck: stays inside the current polygon unless the step
 * crosses a ramp into the neighbouring one, never enters an obstacle, and reports the deck height under the feet.
 */
export function stepOnDeck(from: WalkPose, dx: number, dz: number, deck: DeckAnchors): WalkPose {
  const levelOk = deck.walk[from.level] ? from.level : 0
  const start: Pt = [from.x, from.z]
  let level = levelOk
  let p: Pt = [from.x + dx, from.z + dz]
  const here = deck.walk[level]
  if (!here) return { x: from.x, z: from.z, y: from.y, level }
  if (!pointInPolygon(p, here.points)) {
    // may we step onto another level? only across a ramp that joins the two
    let moved = false
    for (const r of deck.ramps) {
      const other = r.from === level ? r.to : r.to === level ? r.from : -1
      if (other < 0 || !deck.walk[other]) continue
      if (segmentsCross(start, p, r.a, r.b) && pointInPolygon(p, deck.walk[other].points)) {
        level = other
        moved = true
        break
      }
    }
    if (!moved) p = clampToPolygon(p, here.points)
  }
  p = pushOutOfObstacles(p, deck.obstacles)
  p = clampToPolygon(p, deck.walk[level].points)
  return { x: p[0], z: p[1], y: deckHeightAt(p, level, deck), level }
}

/** Where boarding puts the player: the spawn, snapped onto the deck. */
export function spawnPose(deck: DeckAnchors): WalkPose {
  const p: Pt = [deck.spawn[0], deck.spawn[2]]
  const level = Math.max(0, levelAt(p, deck))
  return stepOnDeck({ x: p[0], z: p[1], y: deck.walk[level]?.y ?? deck.spawn[1], level }, 0, 0, deck)
}

// ---- look -----------------------------------------------------------------------------------------------------

/** Yaw (radians, 'YXZ' camera convention: yaw 0 looks down −z) that faces the horizontal direction (dx, dz). */
export const yawToward = (dx: number, dz: number): number => Math.atan2(-dx, -dz)

/** Unit forward vector for a yaw / pitch pair. */
export function lookForward(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch)
  return [-cp * Math.sin(yaw), Math.sin(pitch), -cp * Math.cos(yaw)]
}

/** Yaw / pitch that look from `from` toward `to`. */
export function lookAngles(from: Vec3, to: Vec3): { yaw: number; pitch: number } {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const dz = to[2] - from[2]
  return { yaw: yawToward(dx, dz), pitch: clamp(Math.atan2(dy, Math.hypot(dx, dz)), -PITCH_LIMIT, PITCH_LIMIT) }
}

/** Shortest signed difference `b − a` on the circle. */
export const angleDelta = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Rotate a ship-space horizontal direction into world space by the ship's `rotationY`. */
export function rotateY(dx: number, dz: number, rotationY: number): Pt {
  const c = Math.cos(rotationY)
  const s = Math.sin(rotationY)
  return [dx * c + dz * s, -dx * s + dz * c]
}

// ---- cannon stations ------------------------------------------------------------------------------------------

export interface Station {
  /** Index into `ShipAnchors.cannons`. */
  index: number
  cell: number
  side: Side
  muzzle: Vec3
  direction: Vec3
  /** Where the gunner stands (ship space) and the yaw they face. */
  stand: Vec3
  yaw: number
  /** False for guns below the main deck (a lower gun deck): visible in the hull, not reachable from the deck. */
  onDeck: boolean
}

/** One station per cannon, standing on the deck (authored `deck.stations[i]` when present, else inboard of the muzzle). */
export function stationsOf(a: ShipAnchors, deck: DeckAnchors): Station[] {
  return a.cannons.map((c, index) => {
    const authored = deck.stations[index]
    const stand: Vec3 = authored ? authored.stand : [c.muzzle[0] - c.direction[0] * STAND_INSET, a.deckY, c.muzzle[2] - c.direction[2] * STAND_INSET]
    return {
      index,
      cell: c.cell,
      side: c.side,
      muzzle: c.muzzle,
      direction: c.direction,
      stand,
      yaw: authored ? authored.yaw : yawToward(c.direction[0], c.direction[2]),
      onDeck: c.muzzle[1] >= a.deckY - 0.05,
    }
  })
}

/** Does the gun face the enemy board? World-space fire direction · (enemy board centre − ship) > 0. */
export function stationUsable(s: Pick<Station, 'direction'>, rotationY: number, shipPos: Vec3, enemyCenter: Vec3): boolean {
  const [wx, wz] = rotateY(s.direction[0], s.direction[2], rotationY)
  const tx = enemyCenter[0] - shipPos[0]
  const tz = enemyCenter[2] - shipPos[2]
  return wx * tx + wz * tz > 0
}

/** The nearest on-deck station whose stand is within `reach` of (x, z), or null. */
export function nearestStation(stations: readonly Station[], x: number, z: number, reach = STATION_REACH): Station | null {
  let best: Station | null = null
  let bestD = reach
  for (const s of stations) {
    if (!s.onDeck) continue
    const d = Math.hypot(s.stand[0] - x, s.stand[2] - z)
    if (d <= bestD) {
      bestD = d
      best = s
    }
  }
  return best
}

/**
 * Camera pose while manning: sighting along the barrel from just above and behind the muzzle. The muzzle is the one
 * anchor guaranteed to be outside the planking (enclosed gun decks, castles), so the enemy waters are always in view.
 */
export function gunnerPose(s: Station): { position: Vec3; yaw: number; pitch: number } {
  const [dx, , dz] = s.direction
  const h = Math.hypot(dx, dz) || 1
  const fx = dx / h
  const fz = dz / h
  return {
    position: [s.muzzle[0] - fx * 0.06, s.muzzle[1] + 0.11, s.muzzle[2] - fz * 0.06],
    yaw: yawToward(fx, fz),
    pitch: -0.08,
  }
}

/** Walking pose while manning (feet stay on the stand) — the eye is `EYE_HEIGHT` above it. */
export const eyeHeight = (deckY: number): number => deckY + EYE_HEIGHT

// ---- aiming ---------------------------------------------------------------------------------------------------

/** The board cell the ray from `origin` along `dir` hits on the water plane `planeY`, or null (misses / behind). */
export function rayToCell(origin: Vec3, dir: Vec3, planeY: number, boardOrigin: Vec3, size = 10, cellSize = 1): Coord | null {
  if (Math.abs(dir[1]) < 1e-6) return null
  const t = (planeY - origin[1]) / dir[1]
  if (t <= 0) return null
  return worldToCell({ x: origin[0] + dir[0] * t, z: origin[2] + dir[2] * t }, boardOrigin, cellSize, size)
}

/** `uid`s of the own fleet still afloat, in board order; `cycleShip` picks the one after `current`. */
export function afloatUids(ships: readonly { uid: string; hits: readonly unknown[]; spec: { length: number } }[]): string[] {
  return ships.filter((s) => s.hits.length < s.spec.length).map((s) => s.uid)
}

export function cycleShip(afloat: readonly string[], current: string | null, step = 1): string | null {
  if (afloat.length === 0) return null
  const i = current ? afloat.indexOf(current) : -1
  if (i < 0) return afloat[0]
  return afloat[(i + step + afloat.length) % afloat.length]
}
