import type { Vec3 } from '../../scene/layout'
import type { ShipAnchors } from '../types'

/**
 * Re-expresses a class's anchors after its model root is scaled about the origin and shifted along x
 * (`<group scale={s} position-x={dx}>`), so cinematics/VFX keep landing on the rendered hull.
 */
export function fitAnchors(a: ShipAnchors, scale: number, dx: number): ShipAnchors {
  const p = (v: Vec3): Vec3 => [v[0] * scale + dx, v[1] * scale, v[2] * scale]
  return {
    cannons: a.cannons.map((c) => ({ ...c, muzzle: p(c.muzzle) })),
    masts: a.masts.map((m) => ({ base: p(m.base), height: m.height * scale })),
    deckY: a.deckY * scale,
    hull: { length: a.hull.length * scale, beam: a.hull.beam * scale, height: a.hull.height * scale, draft: a.hull.draft * scale },
    impactPoints: a.impactPoints.map(p),
  }
}
