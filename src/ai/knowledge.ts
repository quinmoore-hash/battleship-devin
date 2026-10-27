import { allCoords, coordKey, inBounds, shotShipKey, type Coord, type EnemyBoardView, type Orientation } from '../engine'

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
  const sunkIds = new Set(view.shots.filter((s) => s.outcome === 'sunk').map(shotShipKey))

  for (const shot of view.shots) {
    if (shot.outcome === 'lost') continue // stormy seas: never on the board, but be safe with foreign views
    const key = coordKey(shot.coord)
    taken.add(key)
    if (shot.outcome === 'miss') misses.add(key)
    else if (shot.shipId && sunkIds.has(shotShipKey(shot))) sunk.add(key)
    else openHits.push(shot.coord)
  }

  const unshot = allCoords(view.size).filter((c) => !taken.has(coordKey(c)))
  return { size: view.size, taken, misses, sunk, openHits, unshot }
}

/** A Black Flag Spyglass finding the opponent remembers. */
export interface Spied {
  coord: Coord
  ship: boolean
}

/**
 * Folds Spyglass findings into the knowledge: open water counts as a miss (never fire there), a seen ship
 * stays `unshot` (the caller fires at it first) but is returned so the heatmap can weigh it like a hit.
 */
export function applySpied(k: Knowledge, spied: readonly Spied[]): Coord[] {
  const ships: Coord[] = []
  for (const s of spied) {
    const key = coordKey(s.coord)
    if (k.taken.has(key)) continue
    if (s.ship) ships.push(s.coord)
    else {
      k.taken.add(key)
      k.misses.add(key)
      k.unshot = k.unshot.filter((c) => coordKey(c) !== key)
    }
  }
  return ships
}

/**
 * The Broadside line through the first open hit: both neighbours along the chosen axis unshot and on the board
 * if any axis allows it (ties → the axis with more open cells, then horizontal). Null without an open hit.
 */
export function broadsideThroughHit(k: Knowledge): { center: Coord; orientation: Orientation } | null {
  const hit = k.openHits[0]
  if (!hit) return null
  const open = (c: Coord) => inBounds(c, k.size) && !k.taken.has(coordKey(c))
  const h = [open({ x: hit.x - 1, y: hit.y }), open({ x: hit.x + 1, y: hit.y })].filter(Boolean).length
  const v = [open({ x: hit.x, y: hit.y - 1 }), open({ x: hit.x, y: hit.y + 1 })].filter(Boolean).length
  if (h === 0 && v === 0) return null
  return { center: hit, orientation: v > h ? 'vertical' : 'horizontal' }
}
