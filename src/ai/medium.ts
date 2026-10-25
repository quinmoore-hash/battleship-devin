import {
  coordKey,
  inBounds,
  neighbors,
  type Coord,
  type Difficulty,
  type EnemyBoardView,
  type ShotResult,
} from '../engine'
import { readView, type Knowledge } from './knowledge'
import { pick } from './rng'
import type { AiOpponent } from './types'

/**
 * Medium: hunt / target.
 *
 * Hunts with random shots until something is hit, then pushes the hit's orthogonal neighbours
 * onto a target stack. Once two hits line up, the cells extending that line (in both directions)
 * take priority. When a ship sinks, its hits are retired; hits that belong to a different,
 * still-afloat ship stay on the books so the AI keeps working on them.
 */
export class MediumOpponent implements AiOpponent {
  readonly difficulty: Difficulty = 'medium'
  private readonly rng: () => number
  /** Hits on ships that are still afloat, in the order they were scored. */
  private hits: ShotResult[] = []
  private targets: Coord[] = []

  constructor(rng: () => number = Math.random) {
    this.rng = rng
  }

  nextShot(view: EnemyBoardView): Coord {
    const knowledge = readView(view)
    if (knowledge.unshot.length === 0) throw new Error('No cells left to fire at')

    this.targets = this.targets.filter((t) => !knowledge.taken.has(coordKey(t)))
    if (this.targets.length === 0) this.targets = this.buildTargets(knowledge)

    const lined = this.lineExtensions(knowledge)
    if (lined.length > 0) return pick(lined, this.rng)
    if (this.targets.length > 0) return this.targets.pop()!

    return pick(knowledge.unshot, this.rng)
  }

  observe(result: ShotResult): void {
    if (result.outcome === 'miss') return
    if (result.outcome === 'hit') {
      this.hits.push(result)
      for (const n of this.shuffled(neighbors(result.coord))) {
        if (!this.targets.some((t) => coordKey(t) === coordKey(n))) this.targets.push(n)
      }
      return
    }
    // Sunk: drop every hit on that ship, keep the strays, rebuild targets around them.
    this.hits = this.hits.filter((h) => h.shipId !== result.shipId)
    this.targets = []
    for (const h of this.hits) {
      for (const n of this.shuffled(neighbors(h.coord))) this.targets.push(n)
    }
  }

  /** Unshot cells at either end of every straight run of two or more open hits. */
  private lineExtensions(k: Knowledge): Coord[] {
    const open = new Set(k.openHits.map(coordKey))
    const out: Coord[] = []
    const seen = new Set<string>()
    const axes: Coord[] = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]
    for (const hit of k.openHits) {
      for (const d of axes) {
        const prev = { x: hit.x - d.x, y: hit.y - d.y }
        if (open.has(coordKey(prev))) continue // not the start of a run
        let end = hit
        let length = 1
        for (;;) {
          const next = { x: end.x + d.x, y: end.y + d.y }
          if (!open.has(coordKey(next))) break
          end = next
          length++
        }
        if (length < 2) continue
        for (const c of [prev, { x: end.x + d.x, y: end.y + d.y }]) {
          const key = coordKey(c)
          if (inBounds(c, k.size) && !k.taken.has(key) && !seen.has(key)) {
            seen.add(key)
            out.push(c)
          }
        }
      }
    }
    return out
  }

  private buildTargets(k: Knowledge): Coord[] {
    const out: Coord[] = []
    const seen = new Set<string>()
    for (const h of k.openHits) {
      for (const n of this.shuffled(neighbors(h, k.size))) {
        const key = coordKey(n)
        if (!k.taken.has(key) && !seen.has(key)) {
          seen.add(key)
          out.push(n)
        }
      }
    }
    return out
  }

  private shuffled<T>(items: T[]): T[] {
    const copy = [...items]
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
  }
}
