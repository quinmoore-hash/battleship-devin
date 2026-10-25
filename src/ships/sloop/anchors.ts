import type { Vec3 } from '../../scene/layout'
import type { ShipAnchors } from '../types'
import { CANNON_BORE_HEIGHT, CANNON_MUZZLE_OFFSET, cellCenterX, deckY, gunStation, hullHalfWidth, SLOOP_DIMS } from './hull'

/**
 * Hand-authored anchors for the Sloop, computed from the same hull functions the model is built from so
 * they stay accurate when the geometry is tuned. Cell 0 is the bow cell (x ∈ [0, 1]), cell 1 the stern cell.
 */
export function buildSloopAnchors(): ShipAnchors {
  const cannons: ShipAnchors['cannons'] = []
  for (let cell = 0; cell < SLOOP_DIMS.length; cell++) {
    for (const side of ['port', 'starboard'] as const) {
      const [x, y, z] = gunStation(cell, side)
      const sign = side === 'starboard' ? 1 : -1
      const dir: Vec3 = [0, 0.06, sign]
      const len = Math.hypot(...dir)
      cannons.push({
        cell,
        side,
        muzzle: [x, y + CANNON_BORE_HEIGHT, z + sign * CANNON_MUZZLE_OFFSET],
        direction: [dir[0] / len, dir[1] / len, dir[2] / len],
      })
    }
  }
  const mastBaseY = deckY(SLOOP_DIMS.mastX)
  const impactY = 0.1
  return {
    cannons,
    masts: [{ base: [SLOOP_DIMS.mastX, mastBaseY, 0], height: SLOOP_DIMS.mastHeight }],
    deckY: SLOOP_DIMS.deckHeight,
    hull: {
      length: SLOOP_DIMS.length,
      beam: SLOOP_DIMS.beam,
      height: mastBaseY + SLOOP_DIMS.mastHeight + 0.1,
      draft: SLOOP_DIMS.draft,
    },
    impactPoints: Array.from({ length: SLOOP_DIMS.length }, (_, cell) => {
      const x = cellCenterX(cell)
      return [x, impactY, -hullHalfWidth(x, impactY)] as Vec3
    }),
  }
}

export const SLOOP_ANCHORS: ShipAnchors = buildSloopAnchors()
