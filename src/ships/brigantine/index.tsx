import { makePlaceholderShip } from '../placeholder'
import type { ShipDefinition } from '../types'

/**
 * Brigantine (length 3). PLACEHOLDER — replaced by the "Brigantine" ship session with a detailed procedural model.
 * The real module must export a `ShipDefinition` named `BRIGANTINE` with the same id and a hand-authored
 * `anchors` object (cannon muzzles, mast bases, impact points) matching the final geometry.
 */
export const BRIGANTINE: ShipDefinition = makePlaceholderShip({
  id: 'brigantine',
  name: 'Brigantine',
  length: 3,
  beam: 0.85,
  masts: 2,
  mastHeight: 1.8,
  freeboard: 0.35,
  draft: 0.35,
})
