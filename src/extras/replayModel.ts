/**
 * Battle replay model (pure). A finished game is fully described by the store's `events` plus both boards' final
 * placement: `boardsAt(snapshot, step)` rebuilds the state after the first `step` shots by re-firing them in order.
 */
import { coordLabel, fire, FLEET, type Board, type Difficulty, type Player } from '../engine'
import type { GameEvent, GameModes, GameState } from '../store/gameStore'

export interface ReplaySnapshot {
  difficulty: Difficulty
  winner?: Player
  modes?: GameModes
  /** Final boards (placement + every shot). */
  playerBoard: Board
  enemyBoard: Board
  events: GameEvent[]
}

export type ReplayBoards = Pick<ReplaySnapshot, 'playerBoard' | 'enemyBoard'>

/** Captures what the replay needs from the store (safe to keep after the store resets). */
export function snapshotFromState(state: Pick<GameState, 'difficulty' | 'winner' | 'modes' | 'playerBoard' | 'enemyBoard' | 'events'>): ReplaySnapshot {
  return {
    difficulty: state.difficulty,
    winner: state.winner,
    modes: { ...state.modes },
    playerBoard: state.playerBoard,
    enemyBoard: state.enemyBoard,
    events: [...state.events],
  }
}

/** The board with its placement kept but every shot (and hit) forgotten. */
export function pristine(board: Board): Board {
  return { ...board, shots: [], ships: board.ships.map((s) => ({ ...s, hits: [] })) }
}

/**
 * Boards after each step: index 0 = before the first shot, index N = after all N events (== the final boards'
 * shot history). Prefixes share structure, so this is cheap to keep for a whole game.
 */
export function buildFrames(snapshot: ReplaySnapshot): ReplayBoards[] {
  const frames: ReplayBoards[] = [{ playerBoard: pristine(snapshot.playerBoard), enemyBoard: pristine(snapshot.enemyBoard) }]
  for (const event of snapshot.events) {
    const prev = frames[frames.length - 1]
    if (event.by === 'human') {
      frames.push({ playerBoard: prev.playerBoard, enemyBoard: fire(prev.enemyBoard, event.result.coord).board })
    } else {
      frames.push({ playerBoard: fire(prev.playerBoard, event.result.coord).board, enemyBoard: prev.enemyBoard })
    }
  }
  return frames
}

export function boardsAt(snapshot: ReplaySnapshot, step: number): ReplayBoards {
  const frames = buildFrames(snapshot)
  return frames[Math.max(0, Math.min(frames.length - 1, step))]
}

export const clampStep = (step: number, total: number): number => Math.max(0, Math.min(total, Math.round(step)))

export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number]
/** Base cadence: one shot per 900 ms at 1×. */
export const REPLAY_BASE_MS = 900
export const stepIntervalMs = (speed: number): number => Math.max(40, Math.round(REPLAY_BASE_MS / speed))

const shipName = (id: string | undefined): string => FLEET.find((s) => s.id === id)?.name ?? id ?? 'ship'

/** One-line caption for a shot, e.g. "Devin fires at B4 — hit the Sloop". */
export function describeEvent(event: GameEvent): string {
  const who = event.by === 'human' ? 'You fire' : 'Devin fires'
  const at = coordLabel(event.result.coord)
  const r = event.result
  if (r.outcome === 'miss') return `${who} at ${at} — splash`
  if (r.outcome === 'sunk') return `${who} at ${at} — sunk the ${shipName(r.shipId)}!`
  return `${who} at ${at} — hit the ${shipName(r.shipId)}`
}

/** Turn numbers for a step (1-based), counting each side's shots. */
export function shotCounts(events: readonly GameEvent[], step: number): { human: number; enemy: number } {
  let human = 0
  let enemy = 0
  for (let i = 0; i < step && i < events.length; i++) if (events[i].by === 'human') human++
  else enemy++
  return { human, enemy }
}
