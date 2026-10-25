import type { Coord, Player, ShipId, ShotResult } from '../engine'
import type { CinematicsLevel } from '../store/gameStore'
import type { Side } from '../ships/types'

/**
 * Contract between the game loop and the cinematic director (Wave 2). The UI/game loop *asks* the
 * director to play an event and awaits it before continuing (e.g. before calling `enemyTurn()`), so
 * pacing lives in the director, not in timers scattered through the UI.
 */

/** Which ship fires and from which battery. Chosen by the director (nearest ship with that side facing the target). */
export interface Battery {
  shipId: ShipId
  side: Side
  /** Cell indices along the ship whose cannons fire (a broadside may use several). */
  cells: number[]
}

export type CinematicEvent =
  /** `by` fires at `target`; `result` is already known so the director can pre-stage the impact. */
  | { type: 'shot'; by: Player; target: Coord; result: ShotResult; battery?: Battery }
  /** Played right after the `shot` that sank it. Zoom-in + slow-mo sinking of `shipId` on `owner`'s board. */
  | { type: 'sink'; owner: Player; shipId: ShipId }
  | { type: 'battle-start' }
  | { type: 'victory'; winner: Player }

export interface CinematicDirector {
  /** Resolves when the sequence (camera + VFX + audio) is finished or skipped. `off` resolves immediately. */
  play(event: CinematicEvent, level: CinematicsLevel): Promise<void>
  /** Skip the currently playing sequence (click / space). */
  skip(): void
  readonly busy: boolean
}

/** Rough target durations in seconds, so VFX/audio sessions can pace their effects. */
export const CINEMATIC_TIMING = {
  shot: { full: 4.5, fast: 1.6 },
  sink: { full: 6, fast: 2 },
  'battle-start': { full: 4, fast: 1 },
  victory: { full: 8, fast: 2.5 },
} as const satisfies Record<CinematicEvent['type'], { full: number; fast: number }>
