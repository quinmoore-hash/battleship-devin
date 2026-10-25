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

export interface Settings {
  sfxVolume: number
  musicVolume: number
  reducedMotion: boolean
}

export interface GameState {
  phase: Phase
  difficulty: Difficulty
  /** The human's own board (Devin fires at this one). */
  playerBoard: Board
  /** Devin the Otter's board (the human fires at this one). */
  otterBoard: Board
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
  /** Human fires at Devin's board. Returns the result, or undefined if the move was illegal. */
  fireAt: (coord: Coord) => ShotResult | undefined
  /** Devin takes a turn. Returns the result. Call after `fireAt` (UI controls the pacing). */
  otterTurn: () => ShotResult | undefined
  updateSettings: (patch: Partial<Settings>) => void
  reset: () => void
}

let eventId = 0

const initialSettings: Settings = { sfxVolume: 0.8, musicVolume: 0.5, reducedMotion: false }

export const useGameStore = create<GameState>((set, get) => ({
  phase: 'menu',
  difficulty: 'medium',
  playerBoard: createBoard(),
  otterBoard: createBoard(),
  turn: 'human',
  events: [],
  settings: initialSettings,

  startGame: (difficulty) =>
    set({
      phase: 'placement',
      difficulty,
      playerBoard: createBoard(),
      otterBoard: randomPlacement(),
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

  removePlayerShip: (shipId) => set((s) => ({ playerBoard: removeShip(s.playerBoard, shipId) })),

  autoPlacePlayerFleet: () => set({ playerBoard: randomPlacement() }),

  confirmPlacement: () => {
    const { playerBoard, phase } = get()
    if (phase !== 'placement' || !isFleetPlaced(playerBoard)) return
    set({ phase: 'battle', turn: 'human' })
  },

  fireAt: (coord) => {
    const { phase, turn, otterBoard, events } = get()
    if (phase !== 'battle' || turn !== 'human') return undefined
    let next: ReturnType<typeof fire>
    try {
      next = fire(otterBoard, coord)
    } catch {
      return undefined
    }
    const won = isFleetSunk(next.board)
    set({
      otterBoard: next.board,
      events: [...events, { id: ++eventId, by: 'human', result: next.result }],
      turn: won ? 'human' : 'otter',
      phase: won ? 'gameover' : 'battle',
      winner: won ? 'human' : undefined,
    })
    return next.result
  },

  otterTurn: () => {
    const { phase, turn, playerBoard, opponent, events } = get()
    if (phase !== 'battle' || turn !== 'otter' || !opponent) return undefined
    const coord = opponent.nextShot(enemyView(playerBoard))
    const next = fire(playerBoard, coord)
    opponent.observe(next.result)
    const lost = isFleetSunk(next.board)
    set({
      playerBoard: next.board,
      events: [...events, { id: ++eventId, by: 'otter', result: next.result }],
      turn: 'human',
      phase: lost ? 'gameover' : 'battle',
      winner: lost ? 'otter' : undefined,
    })
    return next.result
  },

  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

  reset: () =>
    set({
      phase: 'menu',
      playerBoard: createBoard(),
      otterBoard: createBoard(),
      opponent: undefined,
      turn: 'human',
      winner: undefined,
      events: [],
    }),
}))
