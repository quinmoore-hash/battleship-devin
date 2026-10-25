import type { ShipSpec } from './types'

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
