import type { Coord, Difficulty, EnemyBoardView, ShotResult } from '../engine'

/**
 * An AI opponent decides where the enemy fleet fires next.
 * Implementations must be deterministic given the same `rng` sequence so they can be unit-tested.
 */
export interface AiOpponent {
  readonly difficulty: Difficulty
  /** Choose the next cell to fire at. Must never return a cell already present in `view.shots`. */
  nextShot(view: EnemyBoardView): Coord
  /** Called with the result of the shot returned by `nextShot`. */
  observe(result: ShotResult): void
}

export type AiFactory = (rng?: () => number) => AiOpponent
