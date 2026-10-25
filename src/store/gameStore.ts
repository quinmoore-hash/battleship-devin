import { create } from 'zustand'
import { createOpponent, seededRng, type AiOpponent } from '../ai'
import {
  coordKey,
  createBoard,
  enemyView,
  fire,
  hasBeenShot,
  inBounds,
  isFleetPlaced,
  isFleetSunk,
  isSunk,
  placeShip,
  randomPlacement,
  removeShip,
  sameCoord,
  type Board,
  type Coord,
  type Difficulty,
  type EnemyBoardView,
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

export interface Settings {
  sfxVolume: number
  musicVolume: number
  reducedMotion: boolean
  cinematics: CinematicsLevel
}

/**
 * Optional rule variants, chosen at `startGame`. Both false = classic Battleship (one shot per turn,
 * every shot visible). See `src/extras/` for the UI that drives them.
 */
export interface GameModes {
  /** Salvo: each side fires one shot per surviving ship per turn. `fireAt` queues shots until the volley is full. */
  salvo: boolean
  /** Stormy seas: the scene weather is `stormy` and fog hides ~30% of the player's misses on the enemy grid. */
  storm: boolean
}

export const DEFAULT_MODES: GameModes = { salvo: false, storm: false }

/** Probability that a miss on the enemy board is swallowed by the fog in stormy seas. */
export const STORM_FOG_CHANCE = 0.3

export interface SalvoState {
  /** Shots the human has queued this turn, in firing order. Resolved once `pending.length === size`. */
  pending: Coord[]
  /** Shots in the human's current volley (= surviving player ships, at least 1). */
  size: number
}

export interface GameState {
  phase: Phase
  difficulty: Difficulty
  modes: GameModes
  /** The human's own board (the enemy fires at this one). */
  playerBoard: Board
  /** The enemy's board (the human fires at this one). */
  enemyBoard: Board
  turn: Player
  winner?: Player
  events: GameEvent[]
  /** The events resolved by the most recent `fireAt` / `enemyTurn` (one shot in classic mode, a volley in salvo). */
  lastVolley: GameEvent[]
  salvo: SalvoState
  /** Stormy seas: `coordKey`s of the human's misses on the enemy board hidden by fog (still recorded in `enemyBoard.shots`). */
  fogged: string[]
  settings: Settings
  /** Non-serialisable; recreated on every new game. */
  opponent?: AiOpponent
  /** Non-serialisable; decides which misses the storm fog hides. */
  fogRng?: () => number

  /** `modes` defaults to classic rules; `seed` makes the stormy-seas fog deterministic (tests, demos). */
  startGame: (difficulty: Difficulty, modes?: Partial<GameModes>, seed?: number) => void
  placePlayerShip: (spec: ShipSpec, origin: Coord, orientation: Orientation) => boolean
  removePlayerShip: (shipId: ShipSpec['id']) => void
  autoPlacePlayerFleet: () => void
  confirmPlacement: () => void
  /**
   * Human fires at the enemy board. Returns the result, or undefined if the move was illegal.
   * Salvo mode: returns `null` while the shot is only queued (see `salvo.pending`); when the volley is full every
   * queued shot resolves in order (all of them land in `events` / `lastVolley`) and the last result is returned.
   */
  fireAt: (coord: Coord) => ShotResult | null | undefined
  /** The enemy takes a turn (a whole volley in salvo mode). Returns the last result. Call after `fireAt` (UI controls the pacing). */
  enemyTurn: () => ShotResult | undefined
  updateSettings: (patch: Partial<Settings>) => void
  reset: () => void
}

let eventId = 0

const initialSettings: Settings = { sfxVolume: 0.8, musicVolume: 0.5, reducedMotion: false, cinematics: 'full' }

/** Shots per volley for the side that owns `board`: one per surviving ship, never less than one. */
export const salvoSize = (board: Board): number => Math.max(1, board.ships.filter((s) => !isSunk(s)).length)

/** The enemy board as the human sees it in stormy seas: fogged misses are removed from the shot list (they read as `unknown`). */
export function foggedEnemyView(board: Board, fogged: readonly string[]): EnemyBoardView {
  const view = enemyView(board)
  if (fogged.length === 0) return view
  const hidden = new Set(fogged)
  return { ...view, shots: view.shots.filter((s) => !hidden.has(coordKey(s.coord))) }
}

const emptySalvo = (): SalvoState => ({ pending: [], size: 1 })

export const useGameStore = create<GameState>((set, get) => ({
  phase: 'menu',
  difficulty: 'medium',
  modes: DEFAULT_MODES,
  playerBoard: createBoard(),
  enemyBoard: createBoard(),
  turn: 'human',
  events: [],
  lastVolley: [],
  salvo: emptySalvo(),
  fogged: [],
  settings: initialSettings,

  startGame: (difficulty, modes, seed) =>
    set({
      phase: 'placement',
      difficulty,
      modes: { ...DEFAULT_MODES, ...modes },
      playerBoard: createBoard(),
      enemyBoard: randomPlacement(),
      opponent: createOpponent(difficulty),
      fogRng: seededRng(seed ?? Math.floor(Math.random() * 0xffffffff)),
      turn: 'human',
      winner: undefined,
      events: [],
      lastVolley: [],
      salvo: emptySalvo(),
      fogged: [],
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
    set({ phase: 'battle', turn: 'human', salvo: { pending: [], size: salvoSize(playerBoard) } })
  },

  fireAt: (coord) => {
    const { phase, turn, enemyBoard, modes, salvo, playerBoard } = get()
    if (phase !== 'battle' || turn !== 'human') return undefined
    if (!inBounds(coord, enemyBoard.size) || hasBeenShot(enemyBoard, coord)) return undefined

    let volley: Coord[] = [coord]
    if (modes.salvo) {
      if (salvo.pending.some((p) => sameCoord(p, coord))) return undefined
      const pending = [...salvo.pending, coord]
      const size = Math.min(salvo.size, salvoSize(playerBoard))
      if (pending.length < size) {
        set({ salvo: { pending, size } })
        return null
      }
      volley = pending
    }

    const { events, fogged, fogRng } = get()
    let board = enemyBoard
    const resolved: GameEvent[] = []
    const newlyFogged: string[] = []
    let last: ShotResult | undefined
    for (const c of volley) {
      const next = fire(board, c)
      board = next.board
      last = next.result
      resolved.push({ id: ++eventId, by: 'human', result: next.result })
      if (modes.storm && next.result.outcome === 'miss' && (fogRng ?? Math.random)() < STORM_FOG_CHANCE) {
        newlyFogged.push(coordKey(c))
      }
      if (isFleetSunk(board)) break
    }
    const won = isFleetSunk(board)
    set({
      enemyBoard: board,
      events: [...events, ...resolved],
      lastVolley: resolved,
      fogged: newlyFogged.length ? [...fogged, ...newlyFogged] : fogged,
      salvo: { pending: [], size: salvoSize(playerBoard) },
      turn: won ? 'human' : 'enemy',
      phase: won ? 'gameover' : 'battle',
      winner: won ? 'human' : undefined,
    })
    return last
  },

  enemyTurn: () => {
    const { phase, turn, playerBoard, opponent, events, modes } = get()
    if (phase !== 'battle' || turn !== 'enemy' || !opponent) return undefined
    const shots = modes.salvo ? salvoSize(get().enemyBoard) : 1
    let board = playerBoard
    const resolved: GameEvent[] = []
    let last: ShotResult | undefined
    for (let i = 0; i < shots; i++) {
      const coord = opponent.nextShot(enemyView(board))
      const next = fire(board, coord)
      opponent.observe(next.result)
      board = next.board
      last = next.result
      resolved.push({ id: ++eventId, by: 'enemy', result: next.result })
      if (isFleetSunk(board)) break
    }
    const lost = isFleetSunk(board)
    set({
      playerBoard: board,
      events: [...events, ...resolved],
      lastVolley: resolved,
      salvo: { pending: [], size: salvoSize(board) },
      turn: 'human',
      phase: lost ? 'gameover' : 'battle',
      winner: lost ? 'enemy' : undefined,
    })
    return last
  },

  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

  reset: () =>
    set({
      phase: 'menu',
      modes: DEFAULT_MODES,
      playerBoard: createBoard(),
      enemyBoard: createBoard(),
      opponent: undefined,
      fogRng: undefined,
      turn: 'human',
      winner: undefined,
      events: [],
      lastVolley: [],
      salvo: emptySalvo(),
      fogged: [],
    }),
}))
