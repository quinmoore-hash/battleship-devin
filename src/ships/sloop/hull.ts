/**
 * Analytic hull of the Sloop: every part of the model (loft sections, wales, bulwarks, chainplates, gun
 * ports, anchors) samples these functions so they agree with each other. Pure maths, no three.js, so the
 * anchors can be unit-tested in node.
 *
 * Frame: bow = +x, stern = -x, centred, y = 0 waterline, one unit per cell (length 2 → x ∈ [-1, 1]).
 */
import type { Vec3 } from '../../scene/layout'

export const SLOOP_DIMS = {
  length: 2,
  beam: 0.7,
  /** Nominal main-deck height amidships. */
  deckHeight: 0.3,
  draft: 0.3,
  /** Bulwark height above the deck edge (top of the cap rail). */
  bulwark: 0.13,
  mastX: 0.15,
  mastHeight: 1.7,
  bowspritTip: 1.62,
} as const

export const HALF_LENGTH = SLOOP_DIMS.length / 2
const HALF_BEAM = SLOOP_DIMS.beam / 2

/** Kit `Cannon` scale used on the broadside guns; the muzzle sits at local z = 0.45 × scale. */
export const CANNON_SCALE = 0.45
/** Distance from the cannon group origin to the muzzle along its firing axis. */
export const CANNON_MUZZLE_OFFSET = 0.45 * CANNON_SCALE
/** Height of the bore axis above the deck for the kit cannon at CANNON_SCALE. */
export const CANNON_BORE_HEIGHT = 0.22 * CANNON_SCALE
/** Carriage origin distance inboard of the deck edge. */
export const CANNON_INSET = 0.15

export const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
export const smoothstep = (t: number) => {
  const k = clamp01(t)
  return k * k * (3 - 2 * k)
}

/** 0 at the transom … 1 at the stem. */
const along = (x: number) => clamp01((x + HALF_LENGTH) / SLOOP_DIMS.length)

/** Half-beam of the sheer line (before tumblehome) at x. Fine entry forward, transom ≈ 60 % of the beam. */
export function sheerHalfWidth(x: number): number {
  const t = along(x)
  const tm = 0.42
  if (t <= tm) {
    const k = t / tm
    return HALF_BEAM * (0.6 + 0.4 * Math.sin((k * Math.PI) / 2))
  }
  const k = (t - tm) / (1 - tm)
  return Math.max(0.012, HALF_BEAM * Math.pow(Math.max(0, 1 - k * k), 0.85))
}

/** Deck edge height at x (sheer: bow 0.36, midships 0.30, stern 0.335). */
export function deckY(x: number): number {
  const t = along(x)
  const c = 0.45
  return t > c ? SLOOP_DIMS.deckHeight + 0.06 * ((t - c) / (1 - c)) ** 2 : SLOOP_DIMS.deckHeight + 0.035 * ((c - t) / c) ** 2
}

/** Bottom of the hull (keel rabbet) at x. Deepest just aft of midships; the sternpost rakes up to the transom. */
export function keelY(x: number): number {
  const t = along(x)
  const bowRise = smoothstep((t - 0.5) / 0.5)
  const sternRise = smoothstep((-0.72 - x) / 0.28)
  return -(SLOOP_DIMS.draft - 0.17 * bowRise * bowRise - 0.21 * sternRise)
}

/** Half-width of the hull surface at (x, y). Round bilge amidships blending into a V entry forward. */
export function hullHalfWidth(x: number, y: number): number {
  const w = sheerHalfWidth(x)
  const k = keelY(x)
  const d = deckY(x)
  const s = clamp01((y - k) / (d - k))
  const bowness = smoothstep((along(x) - 0.5) / 0.5)
  const round = Math.pow(Math.sin((s * Math.PI) / 2), 0.7)
  const vee = Math.pow(s, 1.35)
  const f = round * (1 - bowness) + vee * bowness
  const tumble = 1 - 0.05 * smoothstep((s - 0.75) / 0.25) * (1 - bowness)
  return Math.max(0.008, w * f * tumble)
}

/** Half-width of the deck edge at x (sheer with tumblehome applied). */
export const deckEdgeHalfWidth = (x: number) => hullHalfWidth(x, deckY(x))

/** d(halfWidth)/dx at height y, for outward normals of surface-following bands. */
export function hullSlope(x: number, y: number): number {
  const h = 0.004
  return (hullHalfWidth(Math.min(HALF_LENGTH, x + h), y) - hullHalfWidth(Math.max(-HALF_LENGTH, x - h), y)) / (2 * h)
}

/** Kit `loftHull` sections. `yFrom`/`yTo` select a band (e.g. keel → waterline, waterline → deck). */
export interface Band {
  x: number
  keelY: number
  railY: number
  halfWidths: number[]
}

/** Longitudinal stations, denser at the ends where the curvature is. */
export function stations(n = 25): number[] {
  return Array.from({ length: n }, (_, i) => {
    const u = i / (n - 1)
    const eased = 0.5 - 0.5 * Math.cos(u * Math.PI)
    return -HALF_LENGTH + (0.35 * u + 0.65 * eased) * SLOOP_DIMS.length
  })
}

export function hullSections(part: 'below' | 'above', n = 25, rings = 9): Band[] {
  return stations(n).map((x) => {
    const k = keelY(x)
    const d = deckY(x)
    const lo = part === 'below' ? k : 0
    const hi = part === 'below' ? 0 : d
    const halfWidths = Array.from({ length: rings }, (_, i) => hullHalfWidth(x, lo + ((hi - lo) * i) / (rings - 1)))
    return { x, keelY: lo, railY: hi, halfWidths }
  })
}

/** Closed deck outline (x, z) running bow → port → stern → starboard. */
export function deckOutline(n = 32): [number, number][] {
  const xs = stations(n)
  const port = xs.map((x) => [x, -deckEdgeHalfWidth(x)] as [number, number]).reverse()
  const stbd = xs.map((x) => [x, deckEdgeHalfWidth(x)] as [number, number])
  return [...port, ...stbd]
}

/** Longitudinal centre of grid cell `cell` (0 = bow). */
export const cellCenterX = (cell: number) => HALF_LENGTH - (cell + 0.5)

/** Where the broadside gun for `cell` stands (carriage origin, deck level). */
export function gunStation(cell: number, side: 'port' | 'starboard'): Vec3 {
  const x = cellCenterX(cell) - 0.08
  const sign = side === 'starboard' ? 1 : -1
  return [x, deckY(x), sign * (deckEdgeHalfWidth(x) - CANNON_INSET)]
}

/** Gun-port opening in the bulwark for `cell`: x range and sill height. */
export function gunPort(cell: number): { x0: number; x1: number; sillY: number; lidHeight: number } {
  const x = cellCenterX(cell) - 0.08
  return { x0: x - 0.075, x1: x + 0.075, sillY: deckY(x) + 0.035, lidHeight: 0.075 }
}

/** Where the bow chaser stands (centreline, fires toward +x). */
export const BOW_CHASER: Vec3 = [0.78, deckY(0.78), 0]
