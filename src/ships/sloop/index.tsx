import { makePlaceholderShip } from '../placeholder'
import type { ShipDefinition } from '../types'

/**
 * Sloop (length 2). PLACEHOLDER — replaced by the "Sloop" ship session with a detailed procedural model.
 * The real module must export a `ShipDefinition` named `SLOOP` with the same id and a hand-authored
 * `anchors` object (cannon muzzles, mast bases, impact points) matching the final geometry.
 */
export const SLOOP: ShipDefinition = makePlaceholderShip({
  id: 'sloop',
  name: 'Sloop',
  length: 2,
  beam: 0.7,
  masts: 1,
  mastHeight: 1.5,
  freeboard: 0.3,
  draft: 0.3,
})
