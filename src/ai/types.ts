import type { Coord, Difficulty, EnemyBoardView, Orientation, ShotResult } from '../engine'

/**
 * An AI opponent decides where the enemy fleet fires next.
 * Implementations must be deterministic given the same `rng` sequence so they can be unit-tested.
 */
export interface AiOpponent {
  readonly difficulty: Difficulty
  /** Choose the next cell to fire at. Must never return a cell already present in `view.shots`. */
  nextShot(view: EnemyBoardView): Coord
  /**
   * Called with the result of the shot returned by `nextShot`. A `lost` result (stormy seas) means the shot never
   * reached the water: the cell is still unknown and may come back from `nextShot` again.
   */
  observe(result: ShotResult): void
  /**
   * Black Flag — Spyglass. Asked once per enemy turn while the look is unused: return the cell to look at, or
   * null to keep it. Only Hard implements it (a single heatmap favourite with ≥ 2× the next cell's weight).
   */
  spyTarget?(view: EnemyBoardView): Coord | null
  /** Black Flag — what the Spyglass saw at `coord` (knowledge, not a shot). */
  observeSpy?(coord: Coord, ship: boolean): void
  /**
   * Black Flag — Broadside. Asked once per enemy turn while unused: the 3-cell line to fire, or null to wait.
   * Medium / Hard answer on the turn after their first confirmed hit, with the line through that hit.
   */
  broadsideTarget?(view: EnemyBoardView): { center: Coord; orientation: Orientation } | null
}

export type AiFactory = (rng?: () => number) => AiOpponent
