import type { Vec3 } from '../../scene/layout'
import type { ShipAnchors, Side } from '../types'
import { BEAM, CANNON_X, DECK_Y, DRAFT, FOREMAST_HEIGHT, FOREMAST_X, HALF, LENGTH, MAINMAST_HEIGHT, MAINMAST_X, hullHalfWidth } from './hull'

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

export const BRIGANTINE_ANCHORS: ShipAnchors = {
  cannons: CANNON_X.flatMap((x) =>
    (['port', 'starboard'] as const).map((side) => ({
      cell: cellOfX(x),
      side,
      muzzle: cannonMuzzle(x, side),
      direction: [0, 0.04, side === 'starboard' ? 1 : -1] as Vec3,
    })),
  ),
  masts: [
    { base: [FOREMAST_X, DECK_Y, 0], height: FOREMAST_HEIGHT },
    { base: [MAINMAST_X, DECK_Y, 0], height: MAINMAST_HEIGHT },
  ],
  deckY: DECK_Y,
  hull: { length: LENGTH, beam: BEAM, height: DECK_Y + MAINMAST_HEIGHT + 0.25, draft: DRAFT },
  impactPoints: Array.from({ length: LENGTH }, (_, cell) => {
    const x = cellCenterX(cell)
    const y = 0.21
    return [x, y, -hullHalfWidth(x, y)] as Vec3
  }),
}
