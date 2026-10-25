import { makePlaceholderShip } from '../placeholder'
import type { ShipDefinition } from '../types'

/**
 * Man-o’-War (length 5). PLACEHOLDER — replaced by the "Man-o’-War" ship session with a detailed procedural model.
 * The real module must export a `ShipDefinition` named `MAN_O_WAR` with the same id and a hand-authored
 * `anchors` object (cannon muzzles, mast bases, impact points) matching the final geometry.
 */
export const MAN_O_WAR: ShipDefinition = makePlaceholderShip({
  id: 'man-o-war',
  name: 'Man-o’-War',
  length: 5,
  beam: 1.3,
  masts: 3,
  mastHeight: 2.6,
  freeboard: 0.55,
  draft: 0.5,
})
