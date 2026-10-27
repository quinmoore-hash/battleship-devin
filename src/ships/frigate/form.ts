/**
 * Frigate hull form — pure math describing the hull as a function of (x, y) in the ship frame
 * (bow = +x, y = 0 waterline, one unit per cell). Everything else in this folder (lofts, bulwarks,
 * anchors, deck layout) samples these functions so the parts always agree with each other.
 */
import type { HullSection } from '../kit/hull'

export const FRIGATE = {
  length: 3,
  /** x of the transom (stern face) and of the stem head at deck level. */
  xStern: -1.42,
  xBow: 1.46,
  /** x of maximum beam. */
  xMid: -0.1,
  beam: 0.95,
  /** Main (weather) deck, quarterdeck and forecastle heights above the waterline. */
  deckY: 0.4,
  qdY: 0.58,
  fcY: 0.54,
  /** Deck breaks: quarterdeck aft of `qdBreakX`, forecastle forward of `fcBreakX`. */
  qdBreakX: -0.85,
  fcBreakX: 1.16,
  /** Solid bulwark above each deck edge. */
  bulwarkH: 0.2,
  bulwarkT: 0.035,
  /** Keel bottom at midships (draft) and the top of the copper sheathing. */
  draft: 0.4,
  copperTop: 0.03,
  /** Tumblehome: the rail is this fraction narrower than the maximum beam. */
  tumble: 0.05,
} as const

/** Longitudinal centre of grid cell `i` (0 = bow). */
export const cellCenterX = (cell: number): number => FRIGATE.length / 2 - (cell + 0.5)

/** Gun positions along the ship, bow to stern: two per cell (see `gunX` for the per-side stagger). */
export const GUN_X: readonly number[] = [0.96, 0.62, 0.26, -0.18, -0.62, -1.1]
export const GUN_PORT_W = 0.15
/** Where the hull is narrow (the bow pair) the port and starboard guns are staggered so they don't overlap. */
export const GUN_STAGGER = 0.07
export function gunX(x: number, side: 'port' | 'starboard'): number {
  if (halfBeamAtDeck(x) >= 0.3) return x
  return x + (side === 'port' ? GUN_STAGGER : -GUN_STAGGER)
}
export const gunCell = (x: number): number => Math.min(FRIGATE.length - 1, Math.max(0, Math.floor(FRIGATE.length / 2 - x)))

export interface MastSpec {
  x: number
  height: number
  /** Aft rake in radians. */
  rake: number
  /** Yards bottom→top: [halfwidth-independent full width, height above the mast base, sail drop]. */
  yards: [width: number, y: number, sailH: number][]
}

export const MASTS: readonly MastSpec[] = [
  {
    x: 0.72,
    height: 1.95,
    rake: 0.05,
    yards: [
      [1.15, 0.8, 0.38],
      [0.9, 1.27, 0.4],
      [0.64, 1.63, 0.3],
      [0.42, 1.85, 0.17],
    ],
  },
  {
    x: -0.08,
    height: 2.2,
    rake: 0.06,
    yards: [
      [1.3, 0.92, 0.44],
      [1.0, 1.45, 0.46],
      [0.72, 1.85, 0.35],
      [0.48, 2.09, 0.19],
    ],
  },
  {
    x: -1.0,
    height: 1.6,
    rake: 0.1,
    yards: [
      [0.78, 1.0, 0.3],
      [0.56, 1.33, 0.26],
      [0.38, 1.52, 0.14],
    ],
  },
]

/** Bowsprit: root on the stem head, pointing forward and up; the jibboom extends it. */
export const BOWSPRIT = { root: [1.3, 0.6, 0] as const, angle: 0.3, length: 0.65, jibboom: 0.28 }

/**
 * Root fit applied to the whole model (and its anchors): the hull + bowsprit span [xStern, bowsprit tip] = ~3.7
 * units, more than the 3 cells the frigate occupies, so the model is scaled down and shifted aft to keep the
 * footprint inside its cells (BUG-110b spar overhang). Keep stern >= -1.5 and bowsprit tip <= 1.5 after fitting.
 */
export const FIT = { scale: 0.74, dx: -0.16 } as const

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** Half-beam of the deck outline at `x` (the plan view). */
export function halfBeamAtDeck(x: number): number {
  const { xBow, xStern, xMid, beam } = FRIGATE
  const half = (beam / 2) * (1 - FRIGATE.tumble)
  if (x >= xMid) {
    const t = clamp01((x - xMid) / (xBow - xMid))
    return Math.max(0.012, half * Math.pow(1 - Math.pow(t, 2.0), 1.15))
  }
  const t = clamp01((xMid - x) / (xMid - xStern))
  return half * (1 - 0.36 * Math.pow(t, 2.6))
}

/** Bottom of the hull (keel rabbet) at `x`. */
export function keelY(x: number): number {
  const { xBow, xStern, draft } = FRIGATE
  const base = -(draft - 0.04)
  if (x > 0.55) {
    const t = clamp01((x - 0.55) / (xBow - 0.55))
    return base + 0.3 * Math.pow(t, 2.2)
  }
  if (x < -1.05) {
    const t = clamp01((-1.05 - x) / (-1.05 - xStern))
    return base + 0.22 * Math.pow(t, 1.3)
  }
  return base
}

/** Deck height at `x`: forecastle / main deck / quarterdeck. */
export function deckY(x: number): number {
  if (x >= FRIGATE.fcBreakX) return FRIGATE.fcY
  if (x <= FRIGATE.qdBreakX) return FRIGATE.qdY
  return FRIGATE.deckY
}

/** Top of the lofted hull side at `x` (deck edge, a hair above the deck planking). */
export const railY = (x: number): number => deckY(x) + 0.006

/** Fineness exponent of the section at `x`: round-bilged midships, a sharp V at the bow, a lean run aft. */
function fineness(x: number): number {
  const { xBow, xStern, xMid } = FRIGATE
  if (x >= xMid) {
    const t = clamp01((x - xMid) / (xBow - xMid))
    return 0.55 + 1.1 * Math.pow(t, 1.5)
  }
  const t = clamp01((xMid - x) / (xMid - xStern))
  return 0.55 + 0.5 * Math.pow(t, 2)
}

/**
 * Half-width of the hull surface at (`x`, `y`) between the keel and the rail. Below the keel or above the
 * rail the nearest edge value is returned, so callers may sample slightly outside the hull.
 */
export function sectionHalfWidth(x: number, y: number): number {
  const kY = keelY(x)
  const rY = railY(x)
  const s = clamp01((y - kY) / (rY - kY))
  const maxHW = halfBeamAtDeck(x) / (1 - FRIGATE.tumble)
  const sk = 0.78
  let profile: number
  if (s <= sk) profile = Math.pow(Math.sin((s / sk) * Math.PI * 0.5), fineness(x))
  else profile = 1 - FRIGATE.tumble * Math.pow((s - sk) / (1 - sk), 1.4)
  // the run: underwater sections aft pinch toward the sternpost
  const run = x < -0.95 ? clamp01((-0.95 - x) / (-0.95 - FRIGATE.xStern)) : 0
  const pinch = 1 - 0.9 * run * Math.pow(1 - s, 1.3)
  return Math.max(0.01, maxHW * profile * pinch)
}

/** Half-width of the bulwark planking at (`x`, `y`) above the deck edge (continues the tumblehome). */
export function bulwarkHalfWidth(x: number, y: number): number {
  return Math.max(0.01, halfBeamAtDeck(x) - Math.max(0, y - railY(x)) * 0.1)
}

/** Longitudinal stations for lofting, denser toward the ends; `extra` x's (deck breaks…) are merged in. */
export function hullStations(count: number, extra: number[] = []): number[] {
  const { xBow, xStern } = FRIGATE
  const xs: number[] = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const e = 0.5 - 0.5 * Math.cos(t * Math.PI) // ease: dense near ends
    xs.push(xStern + (xBow - xStern) * (0.35 * t + 0.65 * e))
  }
  for (const x of extra) xs.push(x)
  return [...new Set(xs.map((x) => Math.round(x * 1e4) / 1e4))].sort((a, b) => a - b)
}

/**
 * Cross-sections for `loftHull`, sampling `sectionHalfWidth` between `yFrom(x)` and `yTo(x)` with
 * `rings` evenly spaced heights (pass the same `rings` to `loftHull`).
 */
export function hullSections(xs: number[], yFrom: (x: number) => number, yTo: (x: number) => number, rings: number): HullSection[] {
  return xs.map((x) => {
    const a = yFrom(x)
    const b = yTo(x)
    const halfWidths: number[] = []
    for (let i = 0; i < rings; i++) halfWidths.push(sectionHalfWidth(x, a + ((b - a) * i) / (rings - 1)))
    return { x, keelY: a, railY: b, halfWidths }
  })
}

/** Points of the deck outline (starboard side, bow→stern) inset from the bulwark inner face. */
export function deckOutline(x0: number, x1: number, inset: number = FRIGATE.bulwarkT, steps = 24): [number, number][] {
  const pts: [number, number][] = []
  for (let i = 0; i <= steps; i++) {
    const x = x1 - ((x1 - x0) * i) / steps
    pts.push([x, Math.max(0.005, halfBeamAtDeck(x) - inset)])
  }
  return pts
}
