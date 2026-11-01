import type { Vec3 } from '../../scene/layout'
import type { ShipAnchors } from '../types'
import { fitAnchors } from '../kit/fit'
import { BOWSPRIT, FIT, FRIGATE, GUN_X, MASTS, bulwarkHalfWidth, cellCenterX, deckY, gunCell, gunX, halfBeamAtDeck, sectionHalfWidth } from './form'
import type { DeckAnchors } from '../../deck/contract'
import { breakRamp, deckPolygon, gunStations, mastObstacles } from '../kit/deck'

/** Scale of the kit cannon and the resulting height of its bore above the deck. */
export const CANNON_SCALE = 0.4
export const GUN_AXIS_Y = 0.22 * CANNON_SCALE
/** How far the muzzle pokes out past the bulwark planking. */
export const MUZZLE_OUT = 0.05

export function gunMuzzle(x: number, side: 'port' | 'starboard'): Vec3 {
  const y = deckY(x) + GUN_AXIS_Y
  const z = bulwarkHalfWidth(x, y) + MUZZLE_OUT
  return [x, y, side === 'starboard' ? z : -z]
}

/**
 * Walkable decks (model frame): weather deck between the breaks, quarterdeck aft and forecastle forward, each
 * joined by a central ladder at its break. The wheel and binnacle on the quarterdeck and the masts are obstacles;
 * the helmsman spawns aft of the wheel.
 */
export function buildFrigateDeck(cannons: ShipAnchors['cannons'], masts: ShipAnchors['masts']): DeckAnchors {
  const F = FRIGATE
  // the forecastle (x > fcBreakX) is a 0.3 u ledge at the stem, too narrow to stand on: not walkable
  const hw = (x: number) => halfBeamAtDeck(x) - F.bulwarkT
  const walk = [
    deckPolygon({ x0: F.qdBreakX + 0.02, x1: F.fcBreakX - 0.02, y: F.deckY, halfWidth: hw, steps: 8 }),
    deckPolygon({ x0: F.xStern + 0.06, x1: F.qdBreakX - 0.02, y: F.qdY, halfWidth: hw, steps: 4 }),
  ]
  return {
    spawn: [-0.92, F.qdY, -0.25],
    walk,
    ramps: [breakRamp(0, 1, F.qdBreakX, 0.12)],
    obstacles: [...mastObstacles(masts, 0.09), { center: [-1.2, 0], radius: 0.08 }],
    stations: gunStations(cannons, walk, deckY),
  }
}

/** Hand-authored anchors, derived from the same form functions the geometry samples. */
export function buildAnchors(): ShipAnchors {
  const cannons: ShipAnchors['cannons'] = []
  for (const gx of GUN_X) {
    for (const side of ['port', 'starboard'] as const) {
      const x = gunX(gx, side)
      const sign = side === 'starboard' ? 1 : -1
      const len = Math.hypot(0.04, 1)
      cannons.push({ cell: gunCell(gx), side, muzzle: gunMuzzle(x, side), direction: [0, 0.04 / len, sign / len] })
    }
  }
  const masts = MASTS.map((m) => ({ base: [m.x, deckY(m.x), 0] as Vec3, height: m.height }))
  const impactPoints = Array.from({ length: FRIGATE.length }, (_, i) => {
    const x = cellCenterX(i)
    const y = 0.14
    return [x, y, -sectionHalfWidth(x, y)] as Vec3
  })
  const bowspritTip = BOWSPRIT.root[0] + Math.cos(BOWSPRIT.angle) * (BOWSPRIT.length + BOWSPRIT.jibboom)
  return {
    cannons,
    masts,
    deckY: FRIGATE.deckY,
    deck: buildFrigateDeck(cannons, masts),
    hull: {
      length: Math.max(FRIGATE.length, bowspritTip - FRIGATE.xStern),
      beam: FRIGATE.beam,
      height: FRIGATE.deckY + Math.max(...MASTS.map((m) => m.height)) + 0.1,
      draft: FRIGATE.draft,
    },
    impactPoints,
  }
}

/** Anchors in the unscaled model frame (what the geometry code uses). */
export const FRIGATE_MODEL_ANCHORS: ShipAnchors = buildAnchors()
/** Anchors in the ship frame the game sees, after the root FIT scale/shift. */
export const FRIGATE_ANCHORS: ShipAnchors = fitAnchors(FRIGATE_MODEL_ANCHORS, FIT.scale, FIT.dx)
