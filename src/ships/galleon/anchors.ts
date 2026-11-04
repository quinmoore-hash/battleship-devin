/**
 * Hand-authored Galleon anchors, derived from the analytic hull in `hull.ts` so they match the geometry exactly.
 * Pure; unit-tested in `anchors.test.ts`.
 */
import type { Vec3 } from '../../scene/layout'
import type { CannonRef, ShipAnchors, Side } from '../types'
import { GALLEON, deckY, halfWidth, railY } from './hull'
import type { DeckAnchors } from '../../deck/contract'
import { breakRamp, deckPolygon, gunStations, mastObstacles } from '../kit/deck'
import { shroudLines } from '../kit/Rope'

/** Kit `Cannon` scale used on the galleon; its muzzle sits at local z = 0.45 × scale. */
export const CANNON_SCALE = 0.5
/** Barrel axis above the gun deck (kit cannon: 0.22 × scale). */
export const GUN_PORT_Y = GALLEON.mainDeckY + 0.22 * CANNON_SCALE
export const GUN_PORT_SIZE: [number, number] = [0.15, 0.13]
/** Muzzle stands this far outboard of the planking. */
export const MUZZLE_CLEARANCE = 0.03

/** Two guns per cell, bow (cell 0) to stern (cell 3). The bow pair sits aft in its cell where the hull is still wide. */
export const CANNON_X: readonly (readonly [number, number])[] = [
  [1.26, 1.02],
  [0.76, 0.26],
  [-0.24, -0.74],
  [-1.24, -1.62],
]

export const SIDES: readonly Side[] = ['starboard', 'port']
export const sideSign = (side: Side) => (side === 'starboard' ? 1 : -1)

export const cellCenterX = (cell: number) => GALLEON.length / 2 - (cell + 0.5)
export const cellOfX = (x: number) => Math.min(GALLEON.length - 1, Math.max(0, Math.floor(GALLEON.length / 2 - x)))

export interface CannonPlacement extends CannonRef {
  x: number
  /** Half-breadth of the planking at the gun port. */
  hw: number
  muzzle: Vec3
  direction: Vec3
}

export function cannonPlacements(): CannonPlacement[] {
  const out: CannonPlacement[] = []
  CANNON_X.forEach((xs, cell) => {
    for (const x of xs) {
      for (const side of SIDES) {
        const hw = halfWidth(x, GUN_PORT_Y)
        const s = sideSign(side)
        out.push({ cell, side, x, hw, muzzle: [x, GUN_PORT_Y, s * (hw + MUZZLE_CLEARANCE)], direction: [0, 0.05, s] })
      }
    }
  })
  return out
}

export interface MastSpec {
  name: 'fore' | 'main' | 'mizzen'
  x: number
  height: number
  /** Index 0 = snaps first while sinking. */
  snapOrder: number
}

export const MASTS: readonly MastSpec[] = [
  { name: 'fore', x: 1.18, height: 2.05, snapOrder: 0 },
  { name: 'main', x: -0.02, height: 2.45, snapOrder: 1 },
  { name: 'mizzen', x: -1.0, height: 1.85, snapOrder: 2 },
]

export const mastBase = (m: MastSpec): Vec3 => [m.x, deckY(m.x), 0]
/** A point `k` of the way up mast `m`. */
export const mastTop = (m: MastSpec, k = 1): Vec3 => [m.x, deckY(m.x) + m.height * k, 0]

/** Fore-and-aft spread of each mast's chain plates (the lower shroud fan reaches ±0.15 u from the mast along the rail). */
export const SHROUD_SPREAD = 0.3
/** The lower shroud fan of mast `m`: chain plates at the rail, converging at the top (shared by the renderer and the spawn-view test). */
export function shroudRig(m: MastSpec): { from: Vec3; to: Vec3 } {
  const ry = railY(m.x) + 0.02
  return { from: [m.x, ry, halfWidth(m.x, ry) - GALLEON.plank - 0.02], to: mastTop(m, 0.62) }
}

export interface StaySpec {
  /** The mast the stay rises from; hidden with that mast's rigging while it is culled. */
  mast: MastSpec['name']
  from: Vec3
  to: Vec3
  sag?: number
}

/** Stays run forward and down from each top; the main and mizzen backstays land on the quarterdeck / poop rails. */
export function staySpecs(): StaySpec[] {
  const [fore, main, mizzen] = MASTS
  const G = GALLEON
  const out: StaySpec[] = [
    { mast: 'fore', from: mastTop(fore, 0.98), to: [G.xBow + 0.95, 1.48, 0], sag: 0.03 },
    { mast: 'fore', from: mastTop(fore, 0.62), to: [G.xBow + 0.3, 1.18, 0], sag: 0.03 },
    { mast: 'main', from: mastTop(main, 0.98), to: mastTop(fore, 0.62), sag: 0.03 },
    { mast: 'main', from: mastTop(main, 0.62), to: [fore.x - 0.1, G.forecastleDeckY + 0.05, 0], sag: 0.03 },
    { mast: 'mizzen', from: mastTop(mizzen, 0.98), to: mastTop(main, 0.62), sag: 0.03 },
    { mast: 'mizzen', from: mastTop(mizzen, 0.6), to: [main.x - 0.12, G.mainDeckY + 0.05, 0], sag: 0.03 },
  ]
  for (const s of [1, -1]) {
    out.push({ mast: 'main', from: mastTop(main, 0.97), to: [G.poopX + 0.05, G.quarterDeckY + 0.08, s * (halfWidth(G.poopX + 0.05, 1.05) - 0.08)] })
    out.push({ mast: 'mizzen', from: mastTop(mizzen, 0.97), to: [G.xStern + 0.1, G.poopDeckY + 0.08, s * (halfWidth(G.xStern + 0.1, 1.45) - 0.08)] })
  }
  return out
}

/** Every standing-rigging line (shrouds of all three masts, stays, backstays) as ship-space segments, for view-cone tests. */
export function riggingSegments(): { a: Vec3; b: Vec3 }[] {
  return [...MASTS.flatMap((m) => shroudLines(shroudRig(m).from, shroudRig(m).to, 3, SHROUD_SPREAD)), ...staySpecs().map(({ from, to }) => ({ a: from, b: to }))]
}

/** Cannonballs hit the side just above the wales, at the cell's centre. Port side; mirror z for starboard. */
export const IMPACT_Y = 0.32

/**
 * Walkable decks: waist (main deck) between the castles, quarterdeck and poop aft, forecastle forward, each
 * joined by a central stair at its break. Guns under the castles are served from the deck above them.
 * Obstacles: masts, the waist grating, wheel + binnacle, the belfry. The spawn stands in the waist between the two forward
 * waist guns (BUG-893): the quarterdeck stand sat inside the mizzen shroud fan and under the main backstays, so the first
 * look after V / Tab / respawn was a wall of ratline planes; from here the main fan (chain plates x −0.17 … 0.13) and the
 * fore fan (1.03 … 1.33) are both outside the ±25° view cone over the rail.
 */
export function buildGalleonDeck(cannons: ShipAnchors['cannons'], masts: ShipAnchors['masts']): DeckAnchors {
  const G = GALLEON
  const hw = (x: number) => halfWidth(x, deckY(x) + 0.02) - G.plank - 0.02
  const walk = [
    deckPolygon({ x0: G.quarterX + 0.02, x1: G.forecastleX - 0.02, y: G.mainDeckY, halfWidth: hw, steps: 6 }),
    deckPolygon({ x0: G.poopX + 0.02, x1: G.quarterX - 0.02, y: G.quarterDeckY, halfWidth: hw, steps: 4 }),
    deckPolygon({ x0: G.xStern + 0.1, x1: G.poopX - 0.02, y: G.poopDeckY, halfWidth: hw, steps: 3 }),
    deckPolygon({ x0: G.forecastleX + 0.02, x1: G.xBow - 0.2, y: G.forecastleDeckY, halfWidth: hw, steps: 3 }),
  ]
  const obstacles: DeckAnchors['obstacles'] = [
      ...mastObstacles(masts, 0.1),
      { center: [0.3, 0], radius: 0.3 },
      { center: [-0.7, 0], radius: 0.14 },
      { center: [-0.62, 0.3], radius: 0.09 },
      { center: [-0.62, -0.3], radius: 0.09 },
      { center: [1.4, 0], radius: 0.1 },
    ]
  return {
    spawn: [0.55, G.mainDeckY, 0.25],
    walk,
    ramps: [breakRamp(0, 1, G.quarterX, 0.12), breakRamp(1, 2, G.poopX, 0.1, 0.15), breakRamp(0, 3, G.forecastleX, 0.12)],
    obstacles,
    stations: gunStations(cannons, walk, deckY, { barrel: MUZZLE_CLEARANCE + 0.7 * CANNON_SCALE, obstacles, railYAt: (x) => railY(x) + 0.03 }),
  }
}

export function buildAnchors(): ShipAnchors {
  const cannons = cannonPlacements().map(({ cell, side, muzzle, direction }) => ({ cell, side, muzzle, direction }))
  const masts = MASTS.map((m) => ({ base: mastBase(m), height: m.height }))
  const impactPoints: Vec3[] = Array.from({ length: GALLEON.length }, (_, i) => {
    const x = cellCenterX(i)
    return [x, IMPACT_Y, -halfWidth(x, IMPACT_Y)]
  })
  const mastTop = Math.max(...MASTS.map((m) => deckY(m.x) + m.height))
  return {
    cannons,
    masts,
    deckY: GALLEON.mainDeckY,
    deck: buildGalleonDeck(cannons, masts),
    hull: { length: GALLEON.length, beam: GALLEON.beam, height: mastTop, draft: -GALLEON.keelY },
    impactPoints,
  }
}

export const GALLEON_ANCHORS: ShipAnchors = buildAnchors()
