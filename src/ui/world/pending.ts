import type { Coord, PlacedShip, Player, ShotResult } from '../../engine'
import type { GameEvent } from '../../store/gameStore'

/** The shot the director is still flying: its marker, hit damage and (if it sank a ship) the wreck wait for impact. */
export interface PendingShot {
  by: Player
  target: Coord
}

const same = (a: Coord, b: Coord) => a.x === b.x && a.y === b.y

/** Shots fired `by` one side, minus the one still in the air (BUG-214: markers used to pop before the ball landed). */
export function visibleShots(events: readonly GameEvent[], by: Player, pending: PendingShot | null): ShotResult[] {
  const out: ShotResult[] = []
  for (const e of events) {
    if (e.by !== by) continue
    if (pending && pending.by === by && same(e.result.coord, pending.target)) continue
    out.push(e.result)
  }
  return out
}

/**
 * The fleet as it should look before the pending shot lands: the hit cell is removed from its ship's `hits`, so damage,
 * fire and the sunk state appear at impact. Returns the same array when nothing is pending or the shot missed.
 */
export function maskPendingHit(ships: PlacedShip[], target: Coord | null): PlacedShip[] {
  if (!target) return ships
  const idx = ships.findIndex((s) => s.hits.some((h) => same(h, target)))
  if (idx < 0) return ships
  const ship = ships[idx]
  const masked: PlacedShip = { ...ship, hits: ship.hits.filter((h) => !same(h, target)) }
  return ships.map((s, i) => (i === idx ? masked : s))
}

/** Sunk ships whose sinking has finished playing (or was never animated), i.e. the ones that get flotsam. */
export function settledWrecks(ships: PlacedShip[], sinkProgress: Partial<Record<string, number>>): PlacedShip[] {
  return ships.filter((s) => s.hits.length >= s.spec.length && (sinkProgress[s.spec.id] ?? 1) >= 1)
}
