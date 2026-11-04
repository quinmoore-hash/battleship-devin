/**
 * Pure geometry for the On-deck mode (no three, no React): the walkable-deck fallback, the player clamp
 * (polygons + ramps + obstacles), cannon stations and their usability, look vectors and the crosshair ray.
 * Ship space throughout: bow +x, stern −x, starboard +z, waterline y = 0 (see ARCHITECTURE.md).
 */
import type { Coord } from '../engine'
import { worldToCell, type Vec3 } from '../scene/layout'
import type { ShipAnchors, Side } from '../ships/types'
import { EYE_HEIGHT, type DeckAnchors } from './contract'

/**
 * Walking / running speed, ship units per second (a sailor is EYE_HEIGHT ≈ 0.17 u tall). 0.6 u/s crosses a frigate's
 * waist (≈ 2 u between the deck breaks) in ~3.3 s and its beam in 1.6 s; Shift runs 1.7× that.
 */
export const WALK_SPEED = 0.6
export const RUN_SPEED = 1.0
/** Seconds for the velocity to reach ~63 % of the wanted speed (and to coast to a stop): short, so turns stay crisp. */
export const ACCEL_TIME = 0.1
/** Jump: apex height above the deck and total air time on a flat deck (gravity / take-off speed follow from both). */
export const JUMP_APEX = 0.12
export const JUMP_TIME = 0.5
export const JUMP_GRAVITY = (8 * JUMP_APEX) / (JUMP_TIME * JUMP_TIME)
export const JUMP_SPEED = (4 * JUMP_APEX) / JUMP_TIME
/**
 * The player's collision radius against obstacles (the pirate figure is ~0.06 u wide). Also the eye's clearance: it must
 * stay ≥ `DECK_NEAR` + `EYE_CLEARANCE` so the near plane can never cut into a mast or a bulwark (BUG-7xx).
 */
export const PLAYER_RADIUS = 0.045
export const EYE_CLEARANCE = 0.01
/** How close (u) to a station's stand the player must be to man the gun. */
export const STATION_REACH = 0.22
/** Within this distance of a usable gun the floating "E — Man the gun" label shows. */
export const STATION_APPROACH = 0.6
/** Fallback stand: this far inboard of the muzzle. */
export const STAND_INSET = 0.12
/** Fallback deck: hull plan shrunk by this margin so the figure's shoulders stay inboard of the bulwark. */
export const FALLBACK_INSET = 0.08
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
 * Per-class deck profile for the fallback (`DECK_ANCHORS_FALLBACK`): where the raised decks start and how high they
 * sit, and how much the plan tapers toward the ends. Read from each class's hull form constants; replaced wholesale
 * by session C's authored `ShipAnchors.deck`.
 */
export interface DeckProfile {
  /** Transom / stem x of the walkable plan (the hull length anchor includes the bowsprit on some classes). */
  xStern: number
  xBow: number
  /** Raised decks aft (quarterdeck / poop) and forward (forecastle): `x` is the break, `y` the deck height. Aft list stern-most last. */
  aft: { x: number; y: number }[]
  fore: { x: number; y: number } | null
  /** Plan half-width at the transom and at the stem, as a fraction of the half beam (1 = no taper). */
  sternTaper: number
  bowTaper: number
}

/**
 * Profiles in each class's *model* space, fitted like its anchors (`fitAnchors`: scale about the origin, shift along x) so
 * they match the rendered hull. Numbers come from the hull form constants named in the comments.
 */
/**
 * Per-class profiles are gone: every shipped class carries authored `ShipAnchors.deck` (session C). A class without one falls
 * back to `flushProfile` (one tapered deck from the hull plan). Kept as a record so a new class can be sketched here first.
 */
export const DECK_PROFILES: Record<string, DeckProfile> = {}

/** Flush rectangle profile for an unknown class. */
export const flushProfile = (a: ShipAnchors): DeckProfile => ({ xStern: -a.hull.length / 2, xBow: a.hull.length / 2, aft: [], fore: null, sternTaper: 0.8, bowTaper: 0.4 })

/** Half-width of the walkable plan at `x`: full beam midships, tapering linearly over the last 30 % toward each end. */
export function planHalfWidth(x: number, halfBeam: number, prof: DeckProfile): number {
  const len = prof.xBow - prof.xStern
  const t = (x - prof.xStern) / len
  const taperLen = 0.3
  let f = 1
  if (t > 1 - taperLen) f = 1 + (prof.bowTaper - 1) * ((t - (1 - taperLen)) / taperLen)
  else if (t < taperLen) f = 1 + (prof.sternTaper - 1) * ((taperLen - t) / taperLen)
  return Math.max(0.02, halfBeam * clamp(f, 0, 1))
}

/** Convex CCW polygon of the plan between `x0` and `x1` (two stations per end so the taper reads). */
function planPolygon(x0: number, x1: number, halfBeam: number, inset: number, prof: DeckProfile): Pt[] {
  const xs = [x0, x0 + (x1 - x0) * 0.5, x1]
  const w = (x: number) => Math.max(0.01, planHalfWidth(x, halfBeam, prof) - inset)
  const low: Pt[] = xs.map((x) => [x, -w(x)] as Pt)
  const high: Pt[] = xs.map((x) => [x, w(x)] as Pt).reverse()
  return [...low, ...high]
}

/**
 * Walkable deck for a class that has not authored `ShipAnchors.deck` yet (`DECK_ANCHORS_FALLBACK`): the hull plan
 * (tapered toward bow and stern, inset so you cannot lean through the bulwark) split into the main deck and the raised
 * decks of `DECK_PROFILES[id]`, joined by ramps at every break; masts as round obstacles; one station per cannon
 * `STAND_INSET` inboard of its muzzle on the deck level under it (guns enclosed under a castle are not reachable);
 * spawn in the waist, off the centreline.
 */
export function fallbackDeckAnchors(a: ShipAnchors, id?: string): DeckAnchors {
  const prof = (id && DECK_PROFILES[id]) || flushProfile(a)
  const halfBeam = a.hull.beam / 2
  const inset = FALLBACK_INSET
  const aft = [...prof.aft].sort((p, q) => q.x - p.x) // nearest the waist first
  const mainStart = aft.length ? aft[0].x : prof.xStern + inset
  const mainEnd = prof.fore ? prof.fore.x : prof.xBow - inset
  const walk: DeckAnchors['walk'] = [{ points: planPolygon(mainStart, mainEnd, halfBeam, inset, prof), y: a.deckY }]
  const ramps: DeckAnchors['ramps'] = []
  const breakSeg = (x: number): [Pt, Pt] => {
    const w = planHalfWidth(x, halfBeam, prof) - inset + 0.01
    return [
      [x, -w],
      [x, w],
    ]
  }
  let prev = 0
  for (let i = 0; i < aft.length; i++) {
    const x0 = i + 1 < aft.length ? aft[i + 1].x : prof.xStern + inset
    walk.push({ points: planPolygon(x0, aft[i].x, halfBeam, inset, prof), y: aft[i].y })
    const [p, q] = breakSeg(aft[i].x)
    ramps.push({ from: prev, to: walk.length - 1, a: p, b: q })
    prev = walk.length - 1
  }
  if (prof.fore) {
    walk.push({ points: planPolygon(prof.fore.x, prof.xBow - inset, halfBeam, inset, prof), y: prof.fore.y })
    const [p, q] = breakSeg(prof.fore.x)
    ramps.push({ from: 0, to: walk.length - 1, a: p, b: q })
  }
  const levelY = (x: number): number => {
    let y = a.deckY
    for (const d of aft) if (x < d.x) y = d.y
    if (prof.fore && x >= prof.fore.x) y = prof.fore.y
    return y
  }
  // spawn in the waist between the aft break and the first mast forward of it (the camera orbits behind you without
  // hitting the mast), off the centreline; the controller mirrors z onto the enemy's side
  const mastAhead = a.masts.map((m) => m.base[0]).filter((x) => x > mainStart + 0.2 && x < mainEnd).sort((p, q) => p - q)[0]
  const spawnX = clamp(mastAhead !== undefined ? mainStart + (mastAhead - mainStart) * 0.35 : mainStart + (mainEnd - mainStart) * 0.3, mainStart + 0.08, mainEnd - 0.08)
  return {
    spawn: [spawnX, a.deckY, Math.min(0.25, Math.max(0.08, (planHalfWidth(spawnX, halfBeam, prof) - inset) * 0.5))],
    walk,
    ramps,
    obstacles: a.masts.map((m) => ({ center: [m.base[0], m.base[2]] as Pt, radius: MAST_RADIUS })),
    stations: a.cannons.map((c) => {
      const x = c.muzzle[0] - c.direction[0] * STAND_INSET
      return {
        stand: [x, levelY(x), c.muzzle[2] - c.direction[2] * STAND_INSET] as Vec3,
        yaw: yawToward(c.direction[0], c.direction[2]),
      }
    }),
  }
}

/** Eye height over the fallback rectangle: the models' waist bulwarks are ~0.27 u, so the contract's 0.17 would see only planks. */
export const FALLBACK_EYE = 0.3

const fallbackDecks = new WeakSet<DeckAnchors>()

/** The authored deck when session C has shipped it, else the fallback (see `isFallbackDeck`). */
export function resolveDeckAnchors(a: ShipAnchors & { deck?: DeckAnchors }, id?: string): DeckAnchors {
  if (a.deck && a.deck.walk.length > 0) return a.deck
  const d = fallbackDeckAnchors(a, id)
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
  // two clearance rings that overlap (a mast beside a hatch) leave no room between them: pushing out of one lands
  // inside the other, so settle on the nearer point where the two rings meet instead of oscillating half inside both
  for (let i = 0; i < obstacles.length; i++) {
    for (let j = i + 1; j < obstacles.length; j++) {
      const a = obstacles[i]
      const b = obstacles[j]
      const ra = a.radius + radius
      const rb = b.radius + radius
      if (Math.hypot(x - a.center[0], z - a.center[1]) >= ra - 1e-6 && Math.hypot(x - b.center[0], z - b.center[1]) >= rb - 1e-6) continue
      const ex = b.center[0] - a.center[0]
      const ez = b.center[1] - a.center[1]
      const d = Math.hypot(ex, ez)
      if (d < 1e-6 || d >= ra + rb) continue
      const along = (d * d + ra * ra - rb * rb) / (2 * d)
      const h = Math.sqrt(Math.max(0, ra * ra - along * along))
      const mx = a.center[0] + (ex / d) * along
      const mz = a.center[1] + (ez / d) * along
      const side = (x - mx) * -ez + (z - mz) * ex >= 0 ? 1 : -1
      x = mx + (-ez / d) * h * side
      z = mz + (ex / d) * h * side
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
/** A step that ends this close to a ramp line counts as taking the ramp (the authored levels leave a gap at a break). */
export const RAMP_REACH = 0.06
function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const vx = b[0] - a[0]
  const vz = b[1] - a[1]
  const len2 = vx * vx + vz * vz || 1
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / len2))
  return Math.hypot(p[0] - (a[0] + vx * t), p[1] - (a[1] + vz * t))
}

export function stepOnDeck(from: WalkPose, dx: number, dz: number, deck: WalkableDeck): WalkPose {
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
      // crossing the ramp line is enough: the authored polygons leave a small gap at a break, so a slow step may land
      // between them — snap onto the other level rather than stalling at the edge (a run jumped the gap, a walk did not)
      if (segmentsCross(start, p, r.a, r.b) || distanceToSegment(p, r.a, r.b) < RAMP_REACH) {
        level = other
        moved = true
        if (!pointInPolygon(p, deck.walk[other].points)) p = clampToPolygon(p, deck.walk[other].points)
        break
      }
    }
    if (!moved) p = clampToPolygon(p, here.points)
  }
  const walk = deck.walk[level].points
  // the rail clamp can drag a pushed-out point a hair back into a clearance ring: a few passes settle it on both
  const settle = (obstacles: DeckAnchors['obstacles']): Pt => {
    let q = p
    for (let pass = 0; pass < 3; pass++) q = clampToPolygon(pushOutOfObstacles(q, obstacles), walk)
    return q
  }
  let q = settle(deck.obstacles)
  // pinned: the rail clamp drops the player back inside an obstacle they already stood in and the step goes nowhere
  // (a narrow bow tip, a landing) — then that obstacle does not push this frame so they can walk out of it; a mere
  // graze that still slides along the ring keeps pushing as usual
  const inside = (o: DeckAnchors['obstacles'][number], at: Pt) => Math.hypot(at[0] - o.center[0], at[1] - o.center[1]) < o.radius + PLAYER_RADIUS - 1e-6
  const progress = (q[0] - start[0]) * dx + (q[1] - start[1]) * dz
  const pinned =
    progress <= 1e-9 && Math.hypot(dx, dz) > 1e-6
      ? deck.obstacles.filter((o) => inside(o, start) && inside(o, q) && !pointInPolygon(pushOutOfObstacles(start, [o]), walk))
      : []
  if (pinned.length) q = settle(deck.obstacles.filter((o) => !pinned.includes(o)))
  q = keepOutOfBands(start, q, deck, walk)
  return { x: q[0], z: q[1], y: deckHeightAt(q, level, deck), level }
}

/**
 * The step landed on a hit hull section (`deck.blocked`): leave the band on the side the player came from, settled on
 * the polygon and clear of obstacles. A level the breach swallows whole cannot be left along x — then the step is
 * refused from outside, but a player already standing in the band when the ball struck keeps walking (never pinned).
 */
function keepOutOfBands(start: Pt, q: Pt, deck: WalkableDeck, walk: readonly Pt[]): Pt {
  const band = deck.blocked?.find((b) => inBand(q[0], b))
  if (!band) return q
  let s: Pt = [start[0] <= (band.x0 + band.x1) / 2 ? band.x0 - PLAYER_RADIUS : band.x1 + PLAYER_RADIUS, q[1]]
  for (let pass = 0; pass < 3; pass++) s = clampToPolygon(pushOutOfObstacles(s, deck.obstacles), walk)
  if (!deck.blocked!.some((b) => inBand(s[0], b))) return s
  return deck.blocked!.some((b) => inBand(start[0], b)) ? q : start
}


/** Exponential approach of `v` toward `target` with time constant `tau` (frame-rate independent). */
export const approach = (v: number, target: number, dt: number, tau = ACCEL_TIME): number => v + (target - v) * (1 - Math.exp(-dt / tau))

export interface AirPose {
  /** Feet height above the deck surface (0 = on the deck). */
  height: number
  /** Vertical speed, u/s (positive up). */
  vy: number
  airborne: boolean
}

export const GROUNDED: AirPose = { height: 0, vy: 0, airborne: false }

/** Take off, unless already in the air (no double jump). */
export function startJump(air: AirPose): AirPose {
  return air.airborne ? air : { height: 0, vy: JUMP_SPEED, airborne: true }
}

/**
 * One frame of the hop. `deckBefore` / `deckAfter` are the deck heights under the feet at the start and end of the
 * frame (walking across a ramp while airborne lands on the new level): the absolute foot height follows gravity and
 * the hop ends the moment it meets the deck. `dt` is clamped by the caller.
 */
export function stepJump(air: AirPose, dt: number, deckBefore: number, deckAfter: number): AirPose {
  if (!air.airborne) return air
  const vy = air.vy - JUMP_GRAVITY * dt
  const absolute = deckBefore + air.height + ((air.vy + vy) / 2) * dt
  const height = absolute - deckAfter
  if (height <= 0 && vy <= 0) return GROUNDED
  return { height: Math.max(0, height), vy, airborne: true }
}

/** Where boarding puts the player: the spawn, snapped onto the deck (and out of any blocked band). */
export function spawnPose(deck: WalkableDeck): WalkPose {
  const p: Pt = [deck.spawn[0], deck.spawn[2]]
  const level = Math.max(0, levelAt(p, deck))
  return stepOnDeck({ x: p[0], z: p[1], y: deck.walk[level]?.y ?? deck.spawn[1], level }, 0, 0, deck)
}

// ---- damage: hit hull sections are no-walk bands ---------------------------------------------------------------

/** A band of ship-space x the player may not stand in (a hit hull section: breach + fire). */
export interface XBand {
  x0: number
  x1: number
}
/** Resolved deck anchors of one ship instance: the authored deck plus its hit sections as no-walk bands. */
export type WalkableDeck = DeckAnchors & { blocked?: readonly XBand[] }

/** Hull cells are one ship unit long, so a section is the ±0.5 band around `sectionX`. */
export const SECTION_HALF = 0.5

/** Ship-space x of hull cell `i` of an `n`-cell ship: the origin cell is the stern (−x), as the breach / fire placement (`impactPointFor`) and `shipWorldTransform` lay the cells out. */
export const sectionX = (i: number, n: number): number => i - (n - 1) / 2

/** Index of the hull section under ship-space `x` (clamped to the hull). */
export const sectionAtX = (x: number, n: number): number => clamp(Math.round(x + (n - 1) / 2), 0, n - 1)

/** Indices of the ship's hit hull cells (the engine's hit list → cell order). */
export const hitSections = (ship: { cells: readonly Coord[]; hits: readonly Coord[] }): number[] =>
  ship.cells.map((c, i) => (ship.hits.some((h) => h.x === c.x && h.y === c.y) ? i : -1)).filter((i) => i >= 0)

/** No-walk bands for the hit sections `hit` of an `n`-cell ship, one hull cell wide each. */
export const blockedBands = (hit: readonly number[], n: number): XBand[] =>
  hit.filter((i) => i >= 0 && i < n).map((i) => ({ x0: sectionX(i, n) - SECTION_HALF, x1: sectionX(i, n) + SECTION_HALF }))

/** Is a player of radius `r` standing at `x` overlapping the band? */
export const inBand = (x: number, b: XBand, r = PLAYER_RADIUS): boolean => x > b.x0 - r && x < b.x1 + r

/** `deck` with `blocked` attached; the same object when nothing is blocked (the fallback-deck identity is kept). */
export function withBlocked(deck: DeckAnchors, blocked: readonly XBand[]): WalkableDeck {
  if (!blocked.length) return deck
  const d: WalkableDeck = { ...deck, blocked }
  if (fallbackDecks.has(deck)) fallbackDecks.add(d)
  return d
}

/**
 * Where boarding a damaged ship puts the player: on the intact section farthest from the fire (nearest the authored
 * spawn among equals), at the walkable point of that section closest to the authored spawn — never on a hit section,
 * never inside an obstacle. Falls back to `spawnPose` when the ship is whole (or nothing intact is walkable).
 */
export function spawnPoseAvoiding(deck: WalkableDeck, hit: readonly number[], n: number): WalkPose {
  const bands = deck.blocked ?? blockedBands(hit, n)
  const d = deck.blocked ? deck : withBlocked(deck, bands)
  const hits = hit.filter((i) => i >= 0 && i < n)
  if (!hits.length) return spawnPose(d)
  const home: Pt = [deck.spawn[0], deck.spawn[2]]
  const intact = Array.from({ length: n }, (_, i) => i).filter((i) => !hits.includes(i))
  const fireDistance = (i: number) => Math.min(...hits.map((h) => Math.abs(h - i)))
  intact.sort((a, b) => fireDistance(b) - fireDistance(a) || Math.abs(sectionX(a, n) - home[0]) - Math.abs(sectionX(b, n) - home[0]))
  const step = 0.05
  for (const i of intact) {
    const cx = sectionX(i, n)
    let best: { p: Pt; level: number; d: number } | null = null
    d.walk.forEach((w, level) => {
      const zs = w.points.map((p) => p[1])
      const z0 = Math.min(...zs)
      const z1 = Math.max(...zs)
      for (let x = cx - SECTION_HALF + PLAYER_RADIUS; x <= cx + SECTION_HALF - PLAYER_RADIUS + 1e-9; x += step) {
        if (bands.some((b) => inBand(x, b))) continue
        for (let z = z0; z <= z1 + 1e-9; z += step) {
          const p: Pt = [x, z]
          if (!pointInPolygon(p, w.points)) continue
          if (d.obstacles.some((o) => dist(p, o.center) < o.radius + PLAYER_RADIUS)) continue
          const dd = dist(p, home)
          if (!best || dd < best.d) best = { p, level, d: dd }
        }
      }
    })
    if (best) {
      const { p, level } = best as { p: Pt; level: number }
      return stepOnDeck({ x: p[0], z: p[1], y: d.walk[level].y, level }, 0, 0, d)
    }
  }
  return spawnPose(d)
}

// ---- look -----------------------------------------------------------------------------------------------------

/** How far ahead of a freshly spawned player the view must be clear of obstacles (a mast trunk 0.2 u ahead fills the screen). */
export const SPAWN_CLEAR_AHEAD = 0.6

/** Distance along the look direction `yaw` from `p` before the ray (a player-radius wide) meets an obstacle; ≥ `reach` when clear. */
export function clearAhead(deck: DeckAnchors, p: Pt, yaw: number, reach = SPAWN_CLEAR_AHEAD, radius = PLAYER_RADIUS): number {
  const f = lookForward(yaw, 0)
  let best = reach
  for (const o of deck.obstacles) {
    // ray–circle: |p + t·f − c| = r + radius, smallest t ≥ 0
    const r = o.radius + radius
    const ox = p[0] - o.center[0]
    const oz = p[1] - o.center[1]
    const b = ox * f[0] + oz * f[2]
    const c = ox * ox + oz * oz - r * r
    if (c <= 1e-9) {
      // inside or touching (a clamp leaves the player exactly on the clearance ring): blocked only when looking into it
      if (b < 0) return 0
      continue
    }
    const disc = b * b - c
    if (disc < 0 || b >= 0) continue
    const t = -b - Math.sqrt(disc)
    if (t < best) best = t
  }
  return best
}

/**
 * The spawn facing: `yaw` (toward the enemy waters) when the first `reach` ahead is free of obstacles, else the first
 * of `fallbacks` that is (the enemy's side of the ship, then the other beam, then along the deck), else the yaw that
 * sees farthest (fallbacks, then a 16-point sweep).
 */
export function clearLookYaw(deck: DeckAnchors, p: Pt, yaw: number, fallbacks: readonly number[], reach = SPAWN_CLEAR_AHEAD): number {
  let best = yaw
  let bestD = clearAhead(deck, p, yaw, reach)
  if (bestD >= reach) return yaw
  const consider = (y: number) => {
    const d = clearAhead(deck, p, y, reach)
    if (d > bestD + 1e-9) {
      best = y
      bestD = d
    }
    return d >= reach
  }
  for (const y of fallbacks) if (consider(y)) return y
  // boxed in on every preferred side (a cramped cabin roof): sweep the compass for the farthest view
  for (let i = 0; i < 16; i++) consider(yaw + (i * Math.PI) / 8)
  return best
}

/** Distance from `p` along the unit xz direction `dir` to the first edge of `poly` (Infinity when the ray meets none). */
export function rayToPolygonEdge(p: Pt, dir: Pt, poly: readonly Pt[]): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const ex = b[0] - a[0]
    const ez = b[1] - a[1]
    const den = dir[0] * ez - dir[1] * ex
    if (Math.abs(den) < 1e-12) continue
    const wx = a[0] - p[0]
    const wz = a[1] - p[1]
    const t = (wx * ez - wz * ex) / den
    const u = (wx * dir[1] - wz * dir[0]) / den
    if (t >= -1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) best = Math.max(0, t)
  }
  return best
}

/** Deck the spawn keeps between the stand and the rail it faces (the eye over the rail would otherwise see only water). */
export const RAIL_INSET = 0.12
/** The spawn look starts a touch downward so rail and planks are in frame. */
export const SPAWN_PITCH = -0.12

/** Deck ahead of `p` along `yaw` on `level` before the rail (the walk polygon's edge). */
export function railAhead(deck: DeckAnchors, p: Pt, level: number, yaw: number): number {
  const f = lookForward(yaw, 0)
  const len = Math.hypot(f[0], f[2]) || 1
  const walk = deck.walk[level]?.points
  return walk ? rayToPolygonEdge(p, [f[0] / len, f[2] / len], walk) : Infinity
}

/** How far along the deck (±x, in `SPAWN_SHIFT_STEP`s) the spawn stand may back off to find a clear view. */
export const SPAWN_SHIFT_MAX = 0.3
export const SPAWN_SHIFT_STEP = 0.05

/**
 * The stand a boarding player takes from the chosen pose `p`: on the enemy's side of the deck (`side` = sign of z toward
 * the enemy) but at least `RAIL_INSET` (+ the player radius) from that rail, settled on the deck, out of obstacles and
 * blocked bands — and, when the view from there is boxed in (a mast trunk, a cabin fixture), backed off along the deck
 * up to `SPAWN_SHIFT_MAX` to the nearest stand whose look (`clearLookYaw` from `yaw`) is clear. A deck too narrow for the
 * inset stands on its centreline.
 */
export function spawnStand(deck: WalkableDeck, p: WalkPose, side: 1 | -1, yaw: number, inset = RAIL_INSET): WalkPose {
  const walk = deck.walk[p.level]?.points
  if (!walk) return p
  const keep = inset + PLAYER_RADIUS
  const standAt = (x: number): WalkPose => {
    const q: Pt = clampToPolygon([x, side * Math.abs(p.z)], walk)
    const toRail = rayToPolygonEdge(q, [0, side], walk)
    if (toRail < keep) {
      const toOther = rayToPolygonEdge(q, [0, -side], walk)
      q[1] = toOther + toRail < 2 * keep ? q[1] - side * (toOther - toRail) * 0.5 : q[1] - side * (keep - toRail)
    }
    return stepOnDeck({ ...p, x: q[0], z: q[1] }, 0, 0, deck)
  }
  let best: WalkPose | null = null
  let bestScore = -Infinity
  for (let k = 0; k * SPAWN_SHIFT_STEP <= SPAWN_SHIFT_MAX + 1e-9; k++) {
    for (const dir of k === 0 ? [0] : [-1, 1]) {
      const st = standAt(p.x + dir * k * SPAWN_SHIFT_STEP)
      if (st.level !== p.level || deck.blocked?.some((b) => inBand(st.x, b))) continue
      const at: Pt = [st.x, st.z]
      const insetOk = rayToPolygonEdge(at, [0, side], walk) >= keep - 1e-6
      const view = clearAhead(deck, at, clearLookYaw(deck, at, yaw, spawnYawFallbacks(side)))
      if (insetOk && view >= SPAWN_CLEAR_AHEAD) return st
      const score = (insetOk ? 1 : 0) + view / SPAWN_CLEAR_AHEAD - k * 0.01
      if (score > bestScore) {
        bestScore = score
        best = st
      }
    }
  }
  return best ?? p
}

/** Yaws to try after the enemy-facing one: the enemy's beam (`side` = sign of z toward the enemy), the other beam, bow, stern. */
export const spawnYawFallbacks = (side: 1 | -1): number[] => [yawToward(0, side), yawToward(0, -side), yawToward(1, 0), yawToward(-1, 0)]


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
  /** Inboard end of the barrel (authored `breech` when present, else 0.1 u behind the muzzle): where the glow marker sits. */
  breech: Vec3
  /** False for guns below the main deck (a lower gun deck): visible in the hull, not reachable from the deck. */
  onDeck: boolean
  /** Top of the rail / netting the gunner looks over at this gun (authored `deck.stations[i].rail`), ship space. */
  rail?: number
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
      breech: authored?.breech ?? [c.muzzle[0] - c.direction[0] * 0.1, c.muzzle[1], c.muzzle[2] - c.direction[2] * 0.1],
      onDeck: c.muzzle[1] >= stand[1] - 0.05,
      ...(authored?.rail !== undefined ? { rail: authored.rail } : {}),
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

// ---- station pick with hysteresis + marker fade (BUG-7xx) --------------------------------------------------------

export interface StationPick {
  /** `Station.index` of the picked station, −1 for none. */
  index: number
  /** Clock time of the last change (`-Infinity` = never). */
  since: number
}
export const NO_PICK: StationPick = { index: -1, since: -Infinity }
/** A rival stand must be closer than the current one by this fraction of its distance (and by `PICK_MIN_GAIN` at least). */
export const PICK_HYSTERESIS = 0.15
export const PICK_MIN_GAIN = 0.05
/** The pick changes at most this often, seconds (≈ 4 ×/s). */
export const PICK_MIN_INTERVAL = 0.25
/** Once picked, a stand stays picked until the player is this far beyond `reach`. */
export const PICK_RELEASE_MARGIN = 0.03

/**
 * `nearestStation` with hysteresis: the current pick is kept while it stays within `reach` + margin and no other stand is
 * clearly closer (15 % / 0.05 u), and any change is at least `PICK_MIN_INTERVAL` after the last one — so two stands at
 * equal distance can no longer flip the hot marker and the HUD prompt every frame. `stations` is indexed by `Station.index`.
 */
export function pickStation(stations: readonly Station[], x: number, z: number, prev: StationPick, now: number, reach = STATION_REACH): StationPick {
  const cur = prev.index >= 0 ? stations[prev.index] : undefined
  const settled = now - prev.since >= PICK_MIN_INTERVAL
  const cand = nearestStation(stations, x, z, reach)
  if (cur && cur.onDeck) {
    const dCur = Math.hypot(cur.stand[0] - x, cur.stand[2] - z)
    if (dCur <= reach + PICK_RELEASE_MARGIN) {
      if (!cand || cand.index === cur.index || !settled) return prev
      const dNew = Math.hypot(cand.stand[0] - x, cand.stand[2] - z)
      return dNew < dCur - Math.max(PICK_MIN_GAIN, dCur * PICK_HYSTERESIS) ? { index: cand.index, since: now } : prev
    }
  }
  if (!settled) return prev
  if (!cand) return prev.index < 0 ? prev : { index: -1, since: now }
  return cand.index === prev.index ? prev : { index: cand.index, since: now }
}

/** The ring / glow fade and shrink as the eye comes close: full at `MARKER_FADE_FAR`, gone at `MARKER_FADE_NEAR`. */
export const MARKER_FADE_FAR = 0.6
export const MARKER_FADE_NEAR = 0.25
export function markerFade(distance: number): number {
  const t = clamp((distance - MARKER_FADE_NEAR) / (MARKER_FADE_FAR - MARKER_FADE_NEAR), 0, 1)
  return t * t * (3 - 2 * t)
}

/** The glow never subtends more than this on screen (radians of its diameter). */
export const GLOW_MAX_ANGLE = (3 * Math.PI) / 180
export const GLOW_RADIUS = 0.018
/** Largest glow scale at `distance` that keeps it under `GLOW_MAX_ANGLE` (an icosahedron of `GLOW_RADIUS`). */
export const glowScaleCap = (distance: number): number => (Math.max(0, distance) * Math.tan(GLOW_MAX_ANGLE / 2)) / GLOW_RADIUS

/** The walking eye sits at least this far over the lowest cap rail of the ship's reachable guns. */
export const WALK_EYE_OVER_RAIL = 0.04
export const WALK_EYE_MAX = 0.4
/**
 * Eye height over the feet while walking `deck`: `EYE_HEIGHT` (0.17), lifted to see over the bulwark where the authored
 * rails are taller than that (man-o'-war / galleon 0.27 u, frigate 0.235 u) — the sailor's eye was below the cap rail
 * on three classes, so standing at the side showed nothing but the inside of the planking (BUG-7xx, owner's clip b).
 */
export function walkEyeHeight(deck: DeckAnchors, stations: readonly Station[]): number {
  // the lowest rail of each deck level (a quarterdeck's low rail must not drop the eye under the waist's bulwark), then the
  // tallest of those: one eye height per ship, so crossing a ramp never bobs the view
  const lowestPerLevel = new Map<number, number>()
  for (const s of stations) {
    if (!s.onDeck || s.rail === undefined) continue
    const key = Math.round(s.stand[1] * 1000)
    lowestPerLevel.set(key, Math.min(lowestPerLevel.get(key) ?? Infinity, s.rail - s.stand[1]))
  }
  let eye = eyeFor(deck)
  for (const rail of lowestPerLevel.values()) eye = Math.max(eye, rail + WALK_EYE_OVER_RAIL)
  return Math.min(WALK_EYE_MAX, eye)
}

/** The manned eye clears the authored rail / netting top by this much. */
export const GUN_EYE_OVER_RAIL = 0.08
/** Horizontal distance behind the muzzle: just inside the bulwark planking on every class (muzzles poke 0.015–0.05 u out). */
export const GUN_EYE_BACK = 0.1
/** Default pitch while manning: a little down, so the near water shows under the horizon (horizon ≈ 7° above centre). */
export const GUN_PITCH = -0.12

/**
 * Camera pose while manning: the gunner leaning over the rail at the gun — the eye 0.1 u behind the muzzle (just inside
 * the planking, outboard of the stand where the crew figure stands and of the mast shroud fans) and lifted over that
 * class's authored `rail` (cap rail / hammock netting top), sighting along the barrel. It used to sit 0.11 over the muzzle,
 * which on the galleon and man-o'-war waists is below the rail and on the frigate inside the netting roll (BUG-770).
 * Without a rail (fallback deck) the muzzle-relative height is kept; the muzzle is the one anchor guaranteed outside the planking.
 */
export function gunnerPose(s: Station): { position: Vec3; yaw: number; pitch: number } {
  const [dx, , dz] = s.direction
  const h = Math.hypot(dx, dz) || 1
  const fx = dx / h
  const fz = dz / h
  const yaw = yawToward(fx, fz)
  if (s.rail === undefined) return { position: [s.muzzle[0] - fx * 0.06, s.muzzle[1] + 0.11, s.muzzle[2] - fz * 0.06], yaw, pitch: -0.08 }
  const y = Math.max(s.muzzle[1] + 0.11, s.rail + GUN_EYE_OVER_RAIL)
  return { position: [s.muzzle[0] - fx * GUN_EYE_BACK, y, s.muzzle[2] - fz * GUN_EYE_BACK], yaw, pitch: GUN_PITCH }
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

/**
 * Sink depth input for the standing ship. The director keys `sinkProgress` by ship uid and keeps it across games, and
 * uids repeat (spec ids, both hot-seat fleets), so a stale 1 from a wreck of the previous game must not drown an afloat ship.
 */
export const sinkProgressFor = (sunk: boolean, progress: number | undefined): number => (sunk ? (progress ?? 1) : 0)

/**
 * The gun a chart shot leaves from while on deck: the manned station, else (walking) the usable gun — one facing the
 * enemy waters — whose stand is nearest the player's feet, so a deck shot never fires from thin air. Null only when
 * no gun of the ship can bear.
 */
export function deckGun(stations: readonly Station[], station: number | null, rotationY: number, shipPos: Vec3, enemyCenter: Vec3, feet?: Vec3): Station | null {
  if (station !== null && stations[station]) return stations[station]
  let best: Station | null = null
  let bestD = Infinity
  for (const s of stations) {
    if (!stationUsable(s, rotationY, shipPos, enemyCenter)) continue
    const d = feet ? Math.hypot(s.stand[0] - feet[0], s.stand[2] - feet[2]) : s.index
    if (d < bestD) {
      bestD = d
      best = s
    }
  }
  return best
}
