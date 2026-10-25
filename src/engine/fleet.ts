import type { ShipSpec } from './types'

/** Devin the Otter's river fleet. Lengths follow classic Battleship (5,4,3,3,2). */
export const FLEET: readonly ShipSpec[] = [
  {
    id: 'kelp-carrier',
    name: 'Kelp Carrier',
    length: 5,
    description: 'A floating kelp raft big enough to carry the whole otter squad.',
  },
  {
    id: 'clam-cruiser',
    name: 'Clam Cruiser',
    length: 4,
    description: 'Armoured with the finest shells from the riverbed.',
  },
  {
    id: 'driftwood-destroyer',
    name: 'Driftwood Destroyer',
    length: 3,
    description: 'Fast, splintery, and surprisingly hard to spot.',
  },
  {
    id: 'stream-sub',
    name: 'Stream Sub',
    length: 3,
    description: 'Dives deep where only an otter can follow.',
  },
  {
    id: 'pebble-patrol',
    name: 'Pebble Patrol',
    length: 2,
    description: 'Two otters, one favourite rock, zero fear.',
  },
]

export const FLEET_BY_ID: Record<string, ShipSpec> = Object.fromEntries(
  FLEET.map((s) => [s.id, s]),
)
