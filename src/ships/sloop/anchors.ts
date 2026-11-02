import type { Vec3 } from '../../scene/layout'
import type { ShipAnchors } from '../types'
import { CANNON_BORE_HEIGHT, CANNON_MUZZLE_OFFSET, cellCenterX, deckEdgeHalfWidth, deckY, gunStation, hullHalfWidth, SLOOP_DIMS } from './hull'
import type { DeckAnchors } from '../../deck/contract'
import { deckPolygon, gunStations, mastObstacles } from '../kit/deck'

/** Deck furniture the player walks around (ship frame): hatch grating, stern barrels, rope coils and the cabin trunk (x −0.93…−0.68, ±0.12). */
export const SLOOP_DECK_OBSTACLES: DeckAnchors['obstacles'] = [
  { center: [-0.86, 0], radius: 0.13 },
  { center: [-0.74, 0], radius: 0.13 },
  { center: [0.55, 0], radius: 0.1 },
  { center: [-0.15, 0.2], radius: 0.09 },
  { center: [-0.16, -0.22], radius: 0.1 },
  { center: [0.33, 0.17], radius: 0.07 },
  { center: [-0.42, -0.05], radius: 0.07 },
]

/** One open deck from the transom to the bow; the helmsman stands at the tiller aft of the stern barrels. */
export function buildSloopDeck(cannons: ShipAnchors['cannons'], masts: ShipAnchors['masts']): DeckAnchors {
  const walk = [deckPolygon({ x0: -0.92, x1: 0.88, y: SLOOP_DIMS.deckHeight, halfWidth: (x) => deckEdgeHalfWidth(x) - 0.035, inset: 0.06, steps: 8 })]
  const obstacles = [...mastObstacles(masts, 0.08), ...SLOOP_DECK_OBSTACLES]
  return {
    spawn: [-0.55, SLOOP_DIMS.deckHeight, 0.1],
    walk,
    ramps: [],
    obstacles,
    stations: gunStations(cannons, walk, () => SLOOP_DIMS.deckHeight, { back: 0.06, barrel: CANNON_MUZZLE_OFFSET + 0.25 * 0.45, obstacles, railYAt: (x) => deckY(x) + SLOOP_DIMS.bulwark }),
  }
}

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
  const masts: ShipAnchors['masts'] = [{ base: [SLOOP_DIMS.mastX, mastBaseY, 0], height: SLOOP_DIMS.mastHeight }]
  return {
    cannons,
    masts,
    deck: buildSloopDeck(cannons, masts),
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
