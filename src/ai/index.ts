import { allCoords, coordKey, type Coord, type Difficulty, type EnemyBoardView, type ShotResult } from '../engine'
import type { AiOpponent } from './types'

export type { AiOpponent, AiFactory } from './types'

/**
 * Placeholder opponent used by every difficulty until the real AIs land.
 * Fires at a uniformly random unshot cell.
 */
class RandomOpponent implements AiOpponent {
  readonly difficulty: Difficulty
  private readonly rng: () => number

  constructor(difficulty: Difficulty, rng: () => number = Math.random) {
    this.difficulty = difficulty
    this.rng = rng
  }

  nextShot(view: EnemyBoardView): Coord {
    const taken = new Set(view.shots.map((s) => coordKey(s.coord)))
    const open = allCoords(view.size).filter((c) => !taken.has(coordKey(c)))
    if (open.length === 0) throw new Error('No cells left to fire at')
    return open[Math.floor(this.rng() * open.length)]
  }

  observe(_result: ShotResult): void {}
}

export function createOpponent(difficulty: Difficulty, rng: () => number = Math.random): AiOpponent {
  return new RandomOpponent(difficulty, rng)
}
