import { allCoords, coordKey, type Coord, type EnemyBoardView } from '../engine'

/**
 * Everything an opponent can legitimately deduce from the enemy board view.
 *
 * Only the identity of a *sunk* ship is used (the game announces "you sank the Clam Cruiser"),
 * so hits on ships that are still afloat are treated as anonymous: the AI does not know which
 * of them belong to the same ship. This matters when two ships sit side by side.
 */
export interface Knowledge {
  size: number
  /** Every cell that has been fired at. */
  taken: Set<string>
  misses: Set<string>
  /** Cells of ships that have been sunk. */
  sunk: Set<string>
  /** Hits on ships that are still afloat. */
  openHits: Coord[]
  /** Cells that have not been fired at yet. */
  unshot: Coord[]
}

export function readView(view: EnemyBoardView): Knowledge {
  const taken = new Set<string>()
  const misses = new Set<string>()
  const sunk = new Set<string>()
  const openHits: Coord[] = []
  const sunkIds = new Set(view.shots.filter((s) => s.outcome === 'sunk').map((s) => s.shipId))

  for (const shot of view.shots) {
    const key = coordKey(shot.coord)
    taken.add(key)
    if (shot.outcome === 'miss') misses.add(key)
    else if (shot.shipId && sunkIds.has(shot.shipId)) sunk.add(key)
    else openHits.push(shot.coord)
  }

  const unshot = allCoords(view.size).filter((c) => !taken.has(coordKey(c)))
  return { size: view.size, taken, misses, sunk, openHits, unshot }
}
