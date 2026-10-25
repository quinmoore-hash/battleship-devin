import { makePlaceholderShip } from '../placeholder'
import type { ShipDefinition } from '../types'

/**
 * Frigate (length 3). PLACEHOLDER — replaced by the "Frigate" ship session with a detailed procedural model.
 * The real module must export a `ShipDefinition` named `FRIGATE` with the same id and a hand-authored
 * `anchors` object (cannon muzzles, mast bases, impact points) matching the final geometry.
 */
export const FRIGATE: ShipDefinition = makePlaceholderShip({
  id: 'frigate',
  name: 'Frigate',
  length: 3,
  beam: 0.95,
  masts: 3,
  mastHeight: 2.0,
  freeboard: 0.4,
  draft: 0.4,
})
