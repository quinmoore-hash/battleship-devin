import type { Vec3 } from '../../scene/layout'
import type { ShipAnchors, Side } from '../types'
import { fitAnchors } from '../kit/fit'
import { BEAM, BULWARK_THICKNESS, CABIN_FRONT_X, CABIN_TOP_Y, CANNON_X, DECK_Y, DRAFT, FIT, FOREMAST_HEIGHT, FOREMAST_X, HALF, LENGTH, MAINMAST_HEIGHT, MAINMAST_X, STEM_X, TRANSOM_X, hullHalfWidth } from './hull'
import type { DeckAnchors } from '../../deck/contract'
import { breakRamp, deckPolygon, gunStations, mastObstacles } from '../kit/deck'

/** Height of the cannon bore above the deck (kit `Cannon` barrel axis × CANNON_SCALE). */
export const CANNON_SCALE = 0.5
export const CANNON_BORE_Y = DECK_Y + 0.22 * CANNON_SCALE
/** Length from a kit `Cannon`'s origin to its muzzle along its firing axis. */
export const CANNON_MUZZLE_LEN = 0.45 * CANNON_SCALE

/** Cell index (0 = bow) that contains hull x. */
export function cellOfX(x: number): number {
  return Math.min(LENGTH - 1, Math.max(0, Math.floor(HALF - x)))
}

/** Centre x of a cell. */
export function cellCenterX(cell: number): number {
  return HALF - (cell + 0.5)
}

/** Where a cannon's origin sits on deck so that its muzzle just clears the gun port. */
export function cannonPosition(x: number, side: Side): Vec3 {
  const hw = hullHalfWidth(x, CANNON_BORE_Y)
  const z = hw + 0.015 - CANNON_MUZZLE_LEN
  return [x, DECK_Y, side === 'starboard' ? z : -z]
}

export function cannonMuzzle(x: number, side: Side): Vec3 {
  const hw = hullHalfWidth(x, CANNON_BORE_Y)
  const z = hw + 0.015
  return [x, CANNON_BORE_Y, side === 'starboard' ? z : -z]
}

const MODEL_CANNONS: ShipAnchors['cannons'] = CANNON_X.flatMap((x) =>
  (['port', 'starboard'] as const).map((side) => ({
    cell: cellOfX(x),
    side,
    muzzle: cannonMuzzle(x, side),
    direction: [0, 0.04, side === 'starboard' ? 1 : -1] as Vec3,
  })),
)
const MODEL_MASTS: ShipAnchors['masts'] = [
  { base: [FOREMAST_X, DECK_Y, 0], height: FOREMAST_HEIGHT },
  { base: [MAINMAST_X, DECK_Y, 0], height: MAINMAST_HEIGHT },
]

/**
 * Walkable deck (model frame): the main deck from the cabin front to the bow, and the cabin roof aft of it as a
 * raised quarterdeck (skylight + companionway as obstacles) reached by the ladder at the cabin front. Hatches,
 * bitts and the stern barrels block walking; the helmsman stands on the cabin roof by the tiller.
 */
export function buildBrigantineDeck(): DeckAnchors {
  const hw = (x: number) => hullHalfWidth(x, DECK_Y) - BULWARK_THICKNESS
  const walk = [
    deckPolygon({ x0: CABIN_FRONT_X + 0.02, x1: STEM_X - 0.3, y: DECK_Y, halfWidth: hw, steps: 8 }),
    deckPolygon({ x0: TRANSOM_X + 0.06, x1: CABIN_FRONT_X - 0.02, y: CABIN_TOP_Y, halfWidth: (x) => hw(x) - 0.03, inset: 0.06, steps: 3 }),
  ]
  return {
    spawn: [-1.3, CABIN_TOP_Y, 0.16],
    walk,
    ramps: [breakRamp(0, 1, CABIN_FRONT_X, 0.12)],
    obstacles: [
      ...mastObstacles(MODEL_MASTS, 0.09),
      { center: [FOREMAST_X + 0.1, 0], radius: 0.05 },
      { center: [MAINMAST_X + 0.1, 0], radius: 0.05 },
      { center: [0.45, 0], radius: 0.14 },
      { center: [-0.76, 0], radius: 0.11 },
      { center: [-0.9, 0.2], radius: 0.09 },
      { center: [-0.9, -0.2], radius: 0.09 },
      { center: [-1.0, 0.05], radius: 0.08 },
      { center: [-1.3, 0], radius: 0.1 },
      { center: [-1.17, -0.14], radius: 0.07 },
    ],
    stations: gunStations(MODEL_CANNONS, walk, () => DECK_Y),
  }
}

/** Anchors in the unscaled model frame (what the geometry code uses). */
export const BRIGANTINE_MODEL_ANCHORS: ShipAnchors = {
  cannons: MODEL_CANNONS,
  masts: MODEL_MASTS,
  deckY: DECK_Y,
  deck: buildBrigantineDeck(),
  hull: { length: LENGTH, beam: BEAM, height: DECK_Y + MAINMAST_HEIGHT + 0.25, draft: DRAFT },
  impactPoints: Array.from({ length: LENGTH }, (_, cell) => {
    const x = cellCenterX(cell)
    const y = 0.21
    return [x, y, -hullHalfWidth(x, y)] as Vec3
  }),
}

/** Anchors in the ship frame the game sees, after the root FIT scale/shift. */
export const BRIGANTINE_ANCHORS: ShipAnchors = fitAnchors(BRIGANTINE_MODEL_ANCHORS, FIT.scale, FIT.dx)
