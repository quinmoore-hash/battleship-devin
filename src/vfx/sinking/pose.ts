import type { PlacedShip } from '../../engine'
import type { CellDamage, ShipAnchors } from '../../ships/types'
import { clamp01, easeInCubic, easeInOutSine, easeOutCubic, lerp } from '../math'
import { hashString, seededRandom } from '../random'

/**
 * Root transform of a sinking ship, in the ship's own frame (bow = +x, y = 0 waterline).
 * - `depth`  metres the origin has dropped below its resting waterline (>= 0, monotonic in progress)
 * - `roll`   rotation about x. Positive = deck tilts toward +z (starboard).
 * - `pitch`  rotation about z. Negative = bow down (bow-first), positive = stern down.
 * - `yaw`    extra rotation about y, added to the placement heading as the wreck slews.
 * Apply as `<group position-y={-depth} rotation-y={heading + yaw}><group rotation={[roll, 0, pitch]}>`.
 */
export interface SinkPose {
  depth: number
  roll: number
  pitch: number
  yaw: number
}

export type HullDims = ShipAnchors['hull']

export interface SinkPoseInput {
  /** Any integer; the same seed always gives the same sequence. */
  seed: number
  hull: HullDims
  /** Per-cell damage, bow first. Decides bow- or stern-first and how violent the list is. */
  damage?: readonly CellDamage[]
  /** Cell index (bow = 0) that took the killing blow: it dominates which end dips first. */
  lastHit?: number
}

/** Which way the ship goes down. `fore` +1 = bow-first, -1 = stern-first. `side` +1 = lists to starboard (+z). */
export interface SinkBias {
  fore: number
  side: 1 | -1
  /** 0..1 how violent the list/lurch is (more burning sections = more violent). */
  violence: number
}

/** Normalised progress windows of the four beats; handy for UIs and for pacing audio. */
export const SINK_PHASES = {
  list: [0, 0.3],
  hang: [0.3, 0.45],
  slide: [0.45, 0.88],
  rest: [0.88, 1],
} as const

/** Smoothstep of `p` across `[a, b]`. */
export const window01 = (p: number, a: number, b: number): number => {
  const t = clamp01((p - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export function sinkBias(seed: number, damage: readonly CellDamage[] = [], lastHit?: number): SinkBias {
  const rnd = seededRandom(seed)
  const n = damage.length
  let sum = 0
  let weight = 0
  let burning = 0
  for (let i = 0; i < n; i++) {
    const d = damage[i]
    if (d === 'intact') continue
    const pos = 1 - (2 * (i + 0.5)) / n // +1 bow … -1 stern
    const w = d === 'burning' ? 1.5 : 1
    if (d === 'burning') burning++
    sum += pos * w
    weight += w
  }
  if (lastHit !== undefined && n > 0 && lastHit >= 0 && lastHit < n) {
    const pos = 1 - (2 * (lastHit + 0.5)) / n
    sum += pos * 2.5
    weight += 2.5
  }
  let fore = weight > 0 ? sum / weight : 0
  const seededSign = rnd() < 0.5 ? -1 : 1
  if (Math.abs(fore) < 0.12) fore = seededSign * (0.3 + rnd() * 0.3)
  fore = Math.max(-1, Math.min(1, fore))
  const side: 1 | -1 = rnd() < 0.5 ? -1 : 1
  const violence = n > 0 ? clamp01(0.35 + burning / n + (weight > 0 ? 0.15 : 0)) : 0.5
  return { fore, side, violence }
}

/** Resting depth of the wreck: hull and the stumps of its masts fully under the surface. */
export const wreckDepth = (hull: HullDims): number => Math.max(1.6, hull.height * 0.7 + hull.draft)

/**
 * Pure pose for `progress` in [0, 1]. Deterministic for a given seed/damage; depth never decreases.
 * Beats: list toward the damaged side → bow/stern dips and hangs → slides under with a lurch → settles.
 */
export function sinkPose(progress: number, input: SinkPoseInput): SinkPose {
  const p = clamp01(progress)
  if (p === 0) return { depth: 0, roll: 0, pitch: 0, yaw: 0 }
  const { fore, side, violence } = sinkBias(input.seed, input.damage, input.lastHit)
  const rnd = seededRandom(input.seed ^ 0x5bd1e995)
  const rollMax = (0.42 + 0.3 * violence + rnd() * 0.1) * side
  const rollList = (0.2 + 0.12 * violence) * side
  const pitchPeak = -(0.22 + 0.28 * Math.abs(fore)) * Math.sign(fore)
  const pitchRest = -0.08 * Math.sign(fore) * (0.6 + 0.4 * rnd())
  const yawEnd = side * (0.1 + rnd() * 0.12) * Math.sign(fore || 1)
  const { hull } = input

  // ---- depth: settle (list beat) → plateau (hang) → slide (ease in, ease out into the seabed)
  const settle = window01(p, 0, SINK_PHASES.list[1]) * hull.draft * 0.35
  const slideT = clamp01((p - SINK_PHASES.slide[0]) / (SINK_PHASES.rest[0] - SINK_PHASES.slide[0]))
  const slide = lerp(easeInCubic(slideT), easeOutCubic(slideT), slideT) * (wreckDepth(hull) - hull.draft * 0.35)
  const depth = settle + slide

  // ---- roll: list, hold, then roll onto the beam ends as it goes under
  const listT = easeInOutSine(clamp01(p / SINK_PHASES.list[1]))
  const slideRoll = window01(p, SINK_PHASES.slide[0], SINK_PHASES.rest[0])
  let roll = lerp(0, rollList, listT) + (rollMax - rollList) * slideRoll
  // lurch while the hull hangs: a damped wobble about the list angle
  const hangT = clamp01((p - SINK_PHASES.hang[0]) / (SINK_PHASES.slide[1] - SINK_PHASES.hang[0]))
  roll += Math.sin(hangT * Math.PI * 3) * (1 - hangT) * 0.035 * violence * side

  // ---- pitch: the damaged end dips during the hang, peaks mid-slide, relaxes as the wreck lies down
  const dipT = window01(p, SINK_PHASES.hang[0] - 0.08, SINK_PHASES.slide[0] + 0.12)
  const relaxT = window01(p, SINK_PHASES.slide[0] + 0.12, 1)
  const pitch = pitchPeak * dipT + (pitchRest - pitchPeak) * relaxT

  // ---- yaw: slews a little as it slides
  const yaw = yawEnd * window01(p, SINK_PHASES.hang[1], 1)

  return { depth, roll, pitch, yaw }
}

/** Deck height (ship frame) of the section at local `x` after the pose, relative to the resting surface. */
export function sectionSurfaceY(pose: SinkPose, x: number, deckY: number, z = 0): number {
  // rotation about z by pitch then about x by roll, then drop by depth
  const y1 = x * Math.sin(pose.pitch) + deckY * Math.cos(pose.pitch)
  const y2 = y1 * Math.cos(pose.roll) - z * Math.sin(pose.roll)
  return y2 - pose.depth
}

/** Local x (bow = +x) of the centre of cell `i` on a length-`n` ship. */
export const cellX = (i: number, n: number): number => n / 2 - (i + 0.5)

/** 0 = well above the surface, 1 = fully under, ramping over `band` metres. */
export function submersion(y: number, band = 0.35): number {
  return clamp01(0.5 - y / band)
}

/** Seed for a placed ship: stable per class and placement. */
export const placedShipSeed = (ship: PlacedShip): number =>
  (hashString(ship.spec.id) + ship.origin.x * 7919 + ship.origin.y * 104729) >>> 0

/** Index (bow = 0) of the most recent hit on a placed ship, or undefined if none. */
export function lastHitIndex(ship: PlacedShip): number | undefined {
  const h = ship.hits[ship.hits.length - 1]
  if (!h) return undefined
  const i = ship.cells.findIndex((c) => c.x === h.x && c.y === h.y)
  return i < 0 ? undefined : i
}
