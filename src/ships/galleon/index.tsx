import { makePlaceholderShip } from '../placeholder'
import type { ShipDefinition } from '../types'

/**
 * Galleon (length 4). PLACEHOLDER — replaced by the "Galleon" ship session with a detailed procedural model.
 * The real module must export a `ShipDefinition` named `GALLEON` with the same id and a hand-authored
 * `anchors` object (cannon muzzles, mast bases, impact points) matching the final geometry.
 */
export const GALLEON: ShipDefinition = makePlaceholderShip({
  id: 'galleon',
  name: 'Galleon',
  length: 4,
  beam: 1.25,
  masts: 3,
  mastHeight: 2.3,
  freeboard: 0.6,
  draft: 0.5,
})
