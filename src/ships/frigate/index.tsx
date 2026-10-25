/**
 * Frigate (length 3): fast three-masted frigate with a long low hull, copper-sheathed bottom, single
 * gun deck with lidded ports (6 guns a side), full square rig with royals, three jibs on a bowsprit +
 * jibboom, spanker on the mizzen, quarterdeck with wheel and binnacle, boats on skid beams, hammock
 * nettings, channels and chain plates.
 *
 *   form.ts        hull maths (half-widths, keel, decks, gun/mast layout) — everything samples this
 *   hull.ts        static hull geometry merged per material · furniture.ts  deck furniture
 *   rigging.ts     masts, yards, sails, standing rigging, bowsprit (pure) · rig.tsx  their components
 *   materials.ts   PBR materials + cloth shader · textures.ts  procedural canvas textures
 *   anchors.ts     cannon muzzles / masts / impact points for the VFX & cinematics modules
 */
import type { ShipDefinition } from '../types'
import { FRIGATE_ANCHORS } from './anchors'
import { FrigateModel } from './FrigateModel'

export const FRIGATE: ShipDefinition = {
  id: 'frigate',
  name: 'Frigate',
  length: 3,
  Model: FrigateModel,
  anchors: FRIGATE_ANCHORS,
}
