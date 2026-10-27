import type { ShipId, ShipSpec } from './types'

/** The pirate fleet. Lengths follow classic Battleship (5,4,3,3,2). */
export const FLEET: readonly ShipSpec[] = [
  {
    id: 'man-o-war',
    name: 'Man-o’-War',
    length: 5,
    description: 'Three masts, two gun decks and a gilded stern. The flagship.',
  },
  {
    id: 'galleon',
    name: 'Galleon',
    length: 4,
    description: 'Tall castles fore and aft, holds full of plunder.',
  },
  {
    id: 'frigate',
    name: 'Frigate',
    length: 3,
    description: 'Sleek, fast and copper-bottomed. A single deadly gun deck.',
  },
  {
    id: 'brigantine',
    name: 'Brigantine',
    length: 3,
    description: 'Two masts and a shallow draft; the raider’s favourite.',
  },
  {
    id: 'sloop',
    name: 'Sloop',
    length: 2,
    description: 'One mast, two guns, and a crew that fears nothing.',
  },
]

export const FLEET_BY_ID: Record<string, ShipSpec> = Object.fromEntries(
  FLEET.map((s) => [s.id, s]),
)

/** One ship to place: its class plus the board-unique `uid` it will carry. */
export interface FleetUnit {
  spec: ShipSpec
  uid: string
}

/** Board-unique ids for a fleet: the first ship of a class is just its id, repeats get `#2`, `#3`… */
export function fleetUnits(fleet: readonly ShipSpec[]): FleetUnit[] {
  const seen = new Map<string, number>()
  return fleet.map((spec) => {
    const n = (seen.get(spec.id) ?? 0) + 1
    seen.set(spec.id, n)
    return { spec, uid: n === 1 ? spec.id : `${spec.id}#${n}` }
  })
}

/** The class id of a `uid` (`'sloop#3'` → `'sloop'`). */
export const uidClass = (uid: string): ShipId => uid.split('#')[0] as ShipId

export type FleetPresetId = 'classic' | 'armada' | 'wolf-pack' | 'raiders'

export interface FleetPreset {
  id: FleetPresetId
  name: string
  description: string
  /** Ship classes in placement order. Every preset covers 17 cells. */
  ships: readonly ShipId[]
}

/** Black Flag fleet picks. All four sum to the classic 17 cells so the boards stay balanced. */
export const FLEET_PRESETS: readonly FleetPreset[] = [
  { id: 'classic', name: 'Classic', description: 'One of each: Man-o’-War, Galleon, Frigate, Brigantine, Sloop.', ships: ['man-o-war', 'galleon', 'frigate', 'brigantine', 'sloop'] },
  { id: 'armada', name: 'Armada', description: 'Two Men-o’-War, a Galleon and a Frigate. Few ships, hard to sink.', ships: ['man-o-war', 'man-o-war', 'galleon', 'frigate'] },
  { id: 'wolf-pack', name: 'Wolf pack', description: 'A Frigate, two Brigantines and four Sloops. Many small targets.', ships: ['frigate', 'brigantine', 'brigantine', 'sloop', 'sloop', 'sloop', 'sloop'] },
  { id: 'raiders', name: 'Raiders', description: 'A Galleon, two Frigates, a Brigantine and two Sloops.', ships: ['galleon', 'frigate', 'frigate', 'brigantine', 'sloop', 'sloop'] },
]

export const FLEET_PRESET_BY_ID: Record<FleetPresetId, FleetPreset> = Object.fromEntries(FLEET_PRESETS.map((p) => [p.id, p])) as Record<FleetPresetId, FleetPreset>

/** The ship specs of a preset, in order (repeats allowed). */
export const presetFleet = (preset: FleetPresetId): ShipSpec[] => FLEET_PRESET_BY_ID[preset].ships.map((id) => FLEET_BY_ID[id])

/** Total cells a fleet covers (17 for every preset). */
export const fleetCells = (fleet: readonly ShipSpec[]): number => fleet.reduce((n, s) => n + s.length, 0)
