import {
  coordKey,
  type Coord,
  type Difficulty,
  type EnemyBoardView,
  type ShipSpec,
  type ShotResult,
} from '../engine'
import { readView, type Knowledge } from './knowledge'
import { pick } from './rng'
import type { AiOpponent } from './types'

/** How much more a placement counts for every open hit it would explain. */
const HIT_WEIGHT = 25

/**
 * Hard: probability-density targeting.
 *
 * Every turn, for each ship still afloat, enumerate every placement that avoids misses and sunk
 * cells. Each placement adds weight to the unshot cells it covers; placements that explain open
 * (unsunk) hits are weighted exponentially higher, so once something is hit Devin converges on
 * it. While hunting (no open hits) shots are restricted to a parity class chosen from the
 * smallest remaining ship, since any ship of length L must cover a cell with (x + y) % L == k.
 * Ships that touch are handled naturally: a hit never "belongs" to anything until its ship sinks.
 */
export class HardOpponent implements AiOpponent {
  readonly difficulty: Difficulty = 'hard'
  private readonly rng: () => number
  private parity?: { modulus: number; offset: number }

  constructor(rng: () => number = Math.random) {
    this.rng = rng
  }

  nextShot(view: EnemyBoardView): Coord {
    const k = readView(view)
    if (k.unshot.length === 0) throw new Error('No cells left to fire at')

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
