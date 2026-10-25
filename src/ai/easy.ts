import type { Coord, Difficulty, EnemyBoardView, ShotResult } from '../engine'
import { readView } from './knowledge'
import { pick } from './rng'
import type { AiOpponent } from './types'

/**
 * Easy: a green crew. Every shot is a uniformly random unshot cell and a hit is never followed up.
 */
export class EasyOpponent implements AiOpponent {
  readonly difficulty: Difficulty = 'easy'
  private readonly rng: () => number

  constructor(rng: () => number = Math.random) {
    this.rng = rng
  }

  nextShot(view: EnemyBoardView): Coord {
    const { unshot } = readView(view)
    if (unshot.length === 0) throw new Error('No cells left to fire at')
    return pick(unshot, this.rng)
  }

  observe(_result: ShotResult): void {}
}
