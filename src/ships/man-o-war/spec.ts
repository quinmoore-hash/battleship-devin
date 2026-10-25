/**
 * Man-o’-War dimensions, hull form and hand-authored anchors. Pure numbers / functions (no three, no DOM)
 * so the model, the geometry builders and the Vitest tests all derive from the same source of truth.
 *
 * Frame: bow = +x, stern = -x, y = 0 waterline, starboard = +z, port = -z (the codebase convention).
 */
import type { Vec3 } from '../../scene/layout'
import type { CannonRef, ShipAnchors, Side } from '../types'

export const LENGTH = 5
export const BEAM = 1.3
export const HALF_BEAM = BEAM / 2

/** Longitudinal extent of the lofted hull (the stern gallery overhangs aft of X_STERN, the bowsprit forward of X_BOW). */
export const X_STERN = -2.3
export const X_BOW = 2.32
export const X_GALLERY = -2.6
export const BOWSPRIT_TIP: Vec3 = [3.1, 1.15, 0]

/** Deck levels (y). */
export const DECK = {
  main: 0.55,
  castle: 0.88,
  poop: 1.16,
} as const

/** Bulwark top (y) per region. */
export const RAIL = {
  waist: 0.82,
  castle: 1.14,
  poop: 1.4,
} as const

/** Longitudinal breaks between decks. */
export const BREAK = {
  /** Forward face of the quarterdeck. */
  quarter: -0.55,
  /** Aft face of the forecastle. */
  fore: 1.35,
  /** Forward face of the poop. */
  poop: -1.85,
} as const

/** Height of maximum beam; the hull tumbles home above it. */
export const Y_MAX_BEAM = 0.18
export const DRAFT = 0.5

export const LOWER_GUN_Y = 0.3
export const UPPER_GUN_Y = DECK.main + 0.13
export const PORT_SIZE = 0.15

export interface MastSpec {
  x: number
  baseY: number
  height: number
  /** Height of the top (platform) above the base. */
  top: number
  /** Height of the crosstrees above the base. */
  crosstrees: number
  /** Square sails: [yardWidth, yardHeightAboveBase, sailHeight]. */
  yards: [number, number, number][]
}

export const MASTS: readonly MastSpec[] = [
  { x: 1.4, baseY: DECK.castle, height: 2.3, top: 1.15, crosstrees: 1.8, yards: [[1.6, 0.95, 0.62], [1.2, 1.75, 0.5], [0.85, 2.15, 0.33]] },
  { x: 0.05, baseY: DECK.main, height: 2.8, top: 1.4, crosstrees: 2.18, yards: [[1.9, 1.15, 0.8], [1.45, 2.1, 0.62], [1.0, 2.62, 0.4]] },
  { x: -1.3, baseY: DECK.castle, height: 2.1, top: 1.05, crosstrees: 1.65, yards: [[1.1, 1.55, 0.45], [0.75, 1.95, 0.28]] },
]

export const MAST_RAKE = 0.045

export interface GunSpec {
  x: number
  deck: 'lower' | 'upper'
  /** Upper-deck guns in the open waist get a full carriage; the rest show a barrel through a port. */
  carriage: boolean
}

const LOWER_X = [-1.925, -1.375, -0.825, -0.275, 0.275, 0.825, 1.375, 1.925]
const UPPER_X = [-1.65, -1.1, -0.55, 0, 0.55, 1.1, 1.65]

export const GUNS: readonly GunSpec[] = [
  ...LOWER_X.map((x) => ({ x, deck: 'lower' as const, carriage: false })),
  ...UPPER_X.map((x) => ({ x, deck: 'upper' as const, carriage: x >= BREAK.quarter - 0.01 && x <= BREAK.fore })),
]

export const SIDES: readonly Side[] = ['port', 'starboard']
export const sideSign = (side: Side) => (side === 'starboard' ? 1 : -1)

/** Cell index (0 = bow) containing longitudinal position x. */
export function cellOf(x: number): number {
  return Math.min(LENGTH - 1, Math.max(0, Math.floor(LENGTH / 2 - x)))
}

/** Centre x of a cell. */
export const cellX = (cell: number) => LENGTH / 2 - (cell + 0.5)

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Station 0 at the transom … 1 at the stem. */
export const station = (x: number) => clamp01((x - X_STERN) / (X_BOW - X_STERN))

/** Half-beam of the plan-view envelope at height Y_MAX_BEAM. Bluff bow, narrower transom. */
export function envelope(x: number): number {
  const t = station(x)
  const tMax = 0.42
  if (t >= tMax) {
    const s = (t - tMax) / (1 - tMax)
    return Math.max(0.035, HALF_BEAM * Math.sqrt(Math.max(0, 1 - Math.pow(s, 2.6))))
  }
  const s = (tMax - t) / tMax
  return HALF_BEAM * (1 - 0.42 * s * s)
}

/** Keel depth along the hull: deepest midships, rising to the forefoot and the stern post. */
export function keelY(x: number): number {
  const t = station(x)
  const fwd = smoothstep(0.68, 1, t)
  const aft = smoothstep(0.22, 0, t)
  return -DRAFT + 0.3 * fwd * fwd + 0.18 * aft * aft
}

/** Top of the hull side (bulwark cap) along the hull. */
export function railY(x: number): number {
  const sheer = 0.03 * Math.pow((x - 0.4) / 2.4, 2)
  let y: number = RAIL.waist
  y = lerp(y, RAIL.castle, smoothstep(BREAK.quarter + 0.15, BREAK.quarter - 0.2, x))
  y = lerp(y, RAIL.poop, smoothstep(BREAK.poop + 0.15, BREAK.poop - 0.2, x))
  y = lerp(y, RAIL.castle, smoothstep(BREAK.fore - 0.15, BREAK.fore + 0.2, x))
  return y + sheer
}

/** Deck level under a given x (the open deck you would stand on). */
export function deckY(x: number): number {
  if (x < BREAK.poop) return DECK.poop
  if (x < BREAK.quarter) return DECK.castle
  if (x > BREAK.fore) return DECK.castle
  return DECK.main
}

/**
 * Half-width of the hull at (x, y). Full U sections midships, V sections at the ends, tumblehome above
 * the maximum beam. Below the keel it returns the keel thickness.
 */
export function hullHalfWidth(x: number, y: number): number {
  const t = station(x)
  const b = envelope(x)
  const k = keelY(x)
  if (y <= Y_MAX_BEAM) {
    const u = clamp01((y - k) / (Y_MAX_BEAM - k))
    const fullness = lerp(0.42, 1.15, Math.pow(Math.abs(t - 0.45) / 0.55, 1.6))
    return b * (0.04 + 0.96 * Math.pow(u, fullness))
  }
  const u = (y - Y_MAX_BEAM) / (RAIL.poop - Y_MAX_BEAM)
  return b * (1 - 0.2 * Math.pow(u, 1.4))
}

/** Which anchor cannons sit on a cell (bow = 0). */
export function gunsInCell(cell: number): GunSpec[] {
  return GUNS.filter((g) => cellOf(g.x) === cell)
}

export function muzzleOf(g: GunSpec, side: Side): Vec3 {
  const y = g.deck === 'lower' ? LOWER_GUN_Y : UPPER_GUN_Y
  return [g.x, y, sideSign(side) * (hullHalfWidth(g.x, y) + 0.14)]
}

export function isFiring(firing: readonly CannonRef[] | undefined, g: GunSpec, side: Side): boolean {
  if (!firing || firing.length === 0) return false
  const cell = cellOf(g.x)
  return firing.some((f) => f.cell === cell && f.side === side)
}

export const IMPACT_Y = 0.25

export const MAN_O_WAR_ANCHORS: ShipAnchors = {
  cannons: SIDES.flatMap((side) =>
    GUNS.map((g) => ({
      cell: cellOf(g.x),
      side,
      muzzle: muzzleOf(g, side),
      direction: [0, 0.06, sideSign(side)] as Vec3,
    })),
  ),
  masts: MASTS.map((m) => ({ base: [m.x, m.baseY, 0] as Vec3, height: m.height })),
  deckY: DECK.main,
  hull: { length: LENGTH, beam: BEAM, height: MASTS[1].baseY + MASTS[1].height, draft: DRAFT },
  impactPoints: Array.from({ length: LENGTH }, (_, i) => [cellX(i), IMPACT_Y, -hullHalfWidth(cellX(i), IMPACT_Y)] as Vec3),
}

/** Point on a (raked) mast `h` above its base, in the ship frame. */
export function mastPoint(m: MastSpec, h: number, dz = 0): Vec3 {
  return [m.x - Math.sin(MAST_RAKE) * h, m.baseY + Math.cos(MAST_RAKE) * h, dz]
}

/** Snap amount (0 standing … 1 fallen) of mast `i` for a given sink progress: fore, then main, then mizzen. */
export function mastSnap(i: number, sinkProgress: number): number {
  const start = 0.18 + i * 0.2
  return smoothstep(start, start + 0.28, sinkProgress)
}

/** How shredded the canvas is for a given sink progress. */
export const sinkTorn = (sinkProgress: number) => smoothstep(0.1, 0.85, sinkProgress)

/** Mast index standing on a cell, or -1. */
export function mastOnCell(cell: number): number {
  return MASTS.findIndex((m) => cellOf(m.x) === cell)
}
