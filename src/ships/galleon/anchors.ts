/**
 * Hand-authored Galleon anchors, derived from the analytic hull in `hull.ts` so they match the geometry exactly.
 * Pure; unit-tested in `anchors.test.ts`.
 */
import type { Vec3 } from '../../scene/layout'
import type { CannonRef, ShipAnchors, Side } from '../types'
import { GALLEON, deckY, halfWidth } from './hull'

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

/** Cannonballs hit the side just above the wales, at the cell's centre. Port side; mirror z for starboard. */
export const IMPACT_Y = 0.32

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
    hull: { length: GALLEON.length, beam: GALLEON.beam, height: mastTop, draft: -GALLEON.keelY },
    impactPoints,
  }
}

export const GALLEON_ANCHORS: ShipAnchors = buildAnchors()
