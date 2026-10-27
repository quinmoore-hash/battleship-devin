import {
  coordKey,
  inBounds,
  type Coord,
  type Difficulty,
  type EnemyBoardView,
  type Orientation,
  type ShipSpec,
  type ShotResult,
} from '../engine'
import { applySpied, broadsideThroughHit, readView, type Knowledge, type Spied } from './knowledge'
import { pick } from './rng'
import type { AiOpponent } from './types'

/** How much more a placement counts for every open hit it would explain. */
const HIT_WEIGHT = 25

/** Spyglass: look only when the hottest cell carries at least this many times the weight of the runner-up. */
export const SPYGLASS_RATIO = 2

/**
 * Hard: probability-density targeting.
 *
 * Every turn, for each ship still afloat, enumerate every placement that avoids misses and sunk
 * cells. Each placement adds weight to the unshot cells it covers; placements that explain open
 * (unsunk) hits are weighted exponentially higher, so once something is hit the AI converges on
 * it. While hunting (no open hits) shots are restricted to a parity class chosen from the
 * smallest remaining ship, since any ship of length L must cover a cell with (x + y) % L == k.
 * Ships that touch are handled naturally: a hit never "belongs" to anything until its ship sinks.
 */
export class HardOpponent implements AiOpponent {
  readonly difficulty: Difficulty = 'hard'
  private readonly rng: () => number
  private parity?: { modulus: number; offset: number }
  private spied: Spied[] = []

  constructor(rng: () => number = Math.random) {
    this.rng = rng
  }

  /** The view plus what the Spyglass saw: open water is a miss, a seen ship weighs like an open hit. */
  private knowledge(view: EnemyBoardView): { k: Knowledge; seenShips: Coord[] } {
    const k = readView(view)
    const seenShips = applySpied(k, this.spied)
    return { k: seenShips.length ? { ...k, openHits: [...k.openHits, ...seenShips] } : k, seenShips }
  }

  nextShot(view: EnemyBoardView): Coord {
    const { k, seenShips } = this.knowledge(view)
    if (k.unshot.length === 0) throw new Error('No cells left to fire at')
    // a ship seen through the Spyglass is a certain hit
    if (seenShips.length > 0) return seenShips[0]

    const heat = heatmap(k, view.remainingShips)
    const hunting = k.openHits.length === 0
    const candidates = hunting ? this.parityCells(k, view.remainingShips, heat) : k.unshot

    let best: Coord[] = []
    let bestHeat = 0
    for (const c of candidates) {
      const h = heat.get(coordKey(c)) ?? 0
      if (h > bestHeat) {
        bestHeat = h
        best = [c]
      } else if (h === bestHeat && h > 0) {
        best.push(c)
      }
    }
    // Only reachable if the view is inconsistent (no ship fits anywhere); fall back to any cell.
    if (best.length === 0) return pick(k.unshot, this.rng)
    return pick(best, this.rng)
  }

  observe(_result: ShotResult): void {}

  observeSpy(coord: Coord, ship: boolean): void {
    this.spied.push({ coord, ship })
  }

  /** Look when one cell clearly dominates the heatmap (≥ `SPYGLASS_RATIO` × the runner-up). */
  spyTarget(view: EnemyBoardView): Coord | null {
    const { k } = this.knowledge(view)
    const heat = heatmap(k, view.remainingShips)
    let top: { c: Coord; h: number } | null = null
    let second = 0
    for (const c of k.unshot) {
      const h = heat.get(coordKey(c)) ?? 0
      if (!top || h > top.h) {
        if (top) second = top.h
        top = { c, h }
      } else if (h > second) second = h
    }
    if (!top || top.h === 0 || second === 0) return null
    return top.h >= SPYGLASS_RATIO * second ? top.c : null
  }

  /** The turn after the first confirmed hit: the line through it along the hotter axis. */
  broadsideTarget(view: EnemyBoardView): { center: Coord; orientation: Orientation } | null {
    const { k } = this.knowledge(view)
    const line = broadsideThroughHit(k)
    if (!line) return null
    const heat = heatmap(k, view.remainingShips)
    const weigh = (cells: Coord[]) => cells.reduce((n, c) => n + (inBounds(c, k.size) && !k.taken.has(coordKey(c)) ? (heat.get(coordKey(c)) ?? 0) : 0), 0)
    const { center } = line
    const h = weigh([{ x: center.x - 1, y: center.y }, { x: center.x + 1, y: center.y }])
    const v = weigh([{ x: center.x, y: center.y - 1 }, { x: center.x, y: center.y + 1 }])
    if (h === 0 && v === 0) return line
    return { center, orientation: v > h ? 'vertical' : 'horizontal' }
  }

  private parityCells(k: Knowledge, remaining: readonly ShipSpec[], heat: Map<string, number>): Coord[] {
    const modulus = Math.max(2, Math.min(...remaining.map((s) => s.length)))
    if (!this.parity || this.parity.modulus !== modulus) {
      // Pick the parity class that currently holds the most probability mass.
      let bestOffset = 0
      let bestMass = -1
      for (let offset = 0; offset < modulus; offset++) {
        let mass = 0
        for (const c of k.unshot) if ((c.x + c.y) % modulus === offset) mass += heat.get(coordKey(c)) ?? 0
        if (mass > bestMass) {
          bestMass = mass
          bestOffset = offset
        }
      }
      this.parity = { modulus, offset: bestOffset }
    }
    const { offset } = this.parity
    const cells = k.unshot.filter((c) => (c.x + c.y) % modulus === offset && (heat.get(coordKey(c)) ?? 0) > 0)
    return cells.length > 0 ? cells : k.unshot
  }
}

/**
 * Accumulated weight of every legal placement of the remaining ships, per unshot cell.
 * Exported for tests: a cell with no heat is one where no remaining ship could fit.
 */
export function heatmap(k: Knowledge, remaining: readonly ShipSpec[]): Map<string, number> {
  const heat = new Map<string, number>()
  const openHits = new Set(k.openHits.map(coordKey))
  const blocked = (key: string) => k.misses.has(key) || k.sunk.has(key)

  for (const ship of remaining) {
    for (const orientation of ['horizontal', 'vertical'] as const) {
      const maxX = orientation === 'horizontal' ? k.size - ship.length : k.size - 1
      const maxY = orientation === 'vertical' ? k.size - ship.length : k.size - 1
      for (let y = 0; y <= maxY; y++) {
        for (let x = 0; x <= maxX; x++) {
          let legal = true
          let hitsCovered = 0
          const keys: string[] = []
          for (let i = 0; i < ship.length; i++) {
            const key = orientation === 'horizontal' ? `${x + i},${y}` : `${x},${y + i}`
            if (blocked(key)) {
              legal = false
              break
            }
            if (openHits.has(key)) hitsCovered++
            else keys.push(key)
          }
          if (!legal) continue
          const weight = HIT_WEIGHT ** hitsCovered
          for (const key of keys) heat.set(key, (heat.get(key) ?? 0) + weight)
        }
      }
    }
  }
  return heat
}
