import { create } from 'zustand'
import { createOpponent, type AiOpponent } from '../ai'
import {
  createBoard,
  enemyView,
  fire,
  isFleetPlaced,
  isFleetSunk,
  placeShip,
  randomPlacement,
  removeShip,
  type Board,
  type Coord,
  type Difficulty,
  type Orientation,
  type Player,
  type ShipSpec,
  type ShotResult,
} from '../engine'

export type Phase = 'menu' | 'placement' | 'battle' | 'gameover'

export interface GameEvent {
  id: number
  by: Player
  result: ShotResult
}

/** How much of each shot is played out as a cinematic. `off` = instant results (used by e2e). */
export type CinematicsLevel = 'full' | 'fast' | 'off'

/** Render quality override; `auto` = the tier detected by `src/perf`. */
export type QualitySetting = 'auto' | 'low' | 'medium' | 'high'

export interface Settings {
  sfxVolume: number
  musicVolume: number
  reducedMotion: boolean
  cinematics: CinematicsLevel
  /** Render quality (see `src/perf`). Persisted by the perf store. */
  quality: QualitySetting
  /** Colour-blind safe markers: distinct shapes/patterns for hit / miss / sunk, not just colour. */
  colorblind: boolean
}

export interface GameState {
  phase: Phase
  difficulty: Difficulty
  /** The human's own board (the enemy fires at this one). */
  playerBoard: Board
  /** The enemy's board (the human fires at this one). */
  enemyBoard: Board
  turn: Player
  winner?: Player
  events: GameEvent[]
  settings: Settings
  /** Non-serialisable; recreated on every new game. */
  opponent?: AiOpponent

  startGame: (difficulty: Difficulty) => void
  placePlayerShip: (spec: ShipSpec, origin: Coord, orientation: Orientation) => boolean
  removePlayerShip: (shipId: ShipSpec['id']) => void
  autoPlacePlayerFleet: () => void
  confirmPlacement: () => void
  /** Human fires at the enemy board. Returns the result, or undefined if the move was illegal. */
  fireAt: (coord: Coord) => ShotResult | undefined
  /** The enemy takes a turn. Returns the result. Call after `fireAt` (UI controls the pacing). */
  enemyTurn: () => ShotResult | undefined
  updateSettings: (patch: Partial<Settings>) => void
  reset: () => void
}

let eventId = 0

const initialSettings: Settings = { sfxVolume: 0.8, musicVolume: 0.5, reducedMotion: false, cinematics: 'full', quality: 'auto', colorblind: false }

export const useGameStore = create<GameState>((set, get) => ({
  phase: 'menu',
  difficulty: 'medium',
  playerBoard: createBoard(),
  enemyBoard: createBoard(),
  turn: 'human',
  events: [],
  settings: initialSettings,

  startGame: (difficulty) =>
    set({
      phase: 'placement',
      difficulty,
      playerBoard: createBoard(),
      enemyBoard: randomPlacement(),
      opponent: createOpponent(difficulty),
      turn: 'human',
      winner: undefined,
      events: [],
    }),

  placePlayerShip: (spec, origin, orientation) => {
    const { playerBoard, phase } = get()
    if (phase !== 'placement') return false
    try {
      set({ playerBoard: placeShip(playerBoard, spec, origin, orientation) })
      return true
    } catch {
      return false
    }
  },

  removePlayerShip: (shipId) =>
    set((s) => (s.phase === 'placement' ? { playerBoard: removeShip(s.playerBoard, shipId) } : {})),

  autoPlacePlayerFleet: () => set((s) => (s.phase === 'placement' ? { playerBoard: randomPlacement() } : {})),

  confirmPlacement: () => {
    const { playerBoard, phase } = get()
    if (phase !== 'placement' || !isFleetPlaced(playerBoard)) return
    set({ phase: 'battle', turn: 'human' })
  },

  fireAt: (coord) => {
    const { phase, turn, enemyBoard, events } = get()
    if (phase !== 'battle' || turn !== 'human') return undefined
    let next: ReturnType<typeof fire>
    try {
      next = fire(enemyBoard, coord)
    } catch {
      return undefined
    }
    const won = isFleetSunk(next.board)
    set({
      enemyBoard: next.board,
      events: [...events, { id: ++eventId, by: 'human', result: next.result }],
      turn: won ? 'human' : 'enemy',
      phase: won ? 'gameover' : 'battle',
      winner: won ? 'human' : undefined,
    })
    return next.result
  },

  enemyTurn: () => {
    const { phase, turn, playerBoard, opponent, events } = get()
    if (phase !== 'battle' || turn !== 'enemy' || !opponent) return undefined
    const coord = opponent.nextShot(enemyView(playerBoard))
    const next = fire(playerBoard, coord)
    opponent.observe(next.result)
    const lost = isFleetSunk(next.board)
    set({
      playerBoard: next.board,
      events: [...events, { id: ++eventId, by: 'enemy', result: next.result }],
      turn: 'human',
      phase: lost ? 'gameover' : 'battle',
      winner: lost ? 'enemy' : undefined,
    })
    return next.result
  },

  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

  reset: () =>
    set({
      phase: 'menu',
      playerBoard: createBoard(),
      enemyBoard: createBoard(),
      opponent: undefined,
      turn: 'human',
      winner: undefined,
      events: [],
    }),
}))
