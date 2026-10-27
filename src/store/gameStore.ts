import { create } from 'zustand'
import { isTimePreset, type TimePreset, type Weather } from '../scene/sun'
import { createOpponent, seededRng, type AiOpponent } from '../ai'
import {
  broadsideCells,
  createBoard,
  enemyView,
  fire,
  FLEET,
  FLEET_PRESETS,
  hasBeenShot,
  hasTreasureAt,
  inBounds,
  isFleetPlaced,
  isFleetSunk,
  isSunk,
  lostShot,
  placeShip,
  presetFleet,
  randomPlacement,
  removeShip,
  sameCoord,
  shipAt,
  treasureCells,
  type Board,
  type Coord,
  type Difficulty,
  type FleetPresetId,
  type Orientation,
  type Player,
  type ShipSpec,
  type ShotResult,
} from '../engine'

export type Phase = 'menu' | 'placement' | 'battle' | 'gameover'

/**
 * `shot` = a normal shot · `broadside` = one ball of a Black Flag Broadside (3 balls share a `group`) ·
 * `spyglass` = a Spyglass look (no shot: `result.outcome` is `'miss'`, `spied` says what was seen) ·
 * `treasure` = a shot (or Broadside ball) that landed on a treasure chest (open water: the shooter fires again).
 */
export type GameEventKind = 'shot' | 'broadside' | 'spyglass' | 'treasure'

export interface GameEvent {
  id: number
  by: Player
  result: ShotResult
  kind: GameEventKind
  /** Balls of one Broadside share a group id (shot log renders them as one line). */
  group?: number
  /** Spyglass finding. */
  spied?: 'ship' | 'water'
}

/** Black Flag power shots left for a side (`true` = still available). */
export interface PowerShots {
  broadside: boolean
  spyglass: boolean
}

export interface SpyMark {
  coord: Coord
  ship: boolean
}

export const TREASURE_PER_BOARD = 2

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
  /** "Sky & sea" looks (visual only): named time of day and weather for `<OceanScene>`. */
  timeOfDay: TimePreset
  weather: SkyWeather
}

/** Weather the player can pick; `stormy` is reserved for the Stormy-seas rule, which overrides this. */
export type SkyWeather = Exclude<Weather, 'stormy'>
export const SKY_WEATHERS: readonly SkyWeather[] = ['calm', 'overcast', 'squall']
export const isSkyWeather = (v: unknown): v is SkyWeather => typeof v === 'string' && (SKY_WEATHERS as readonly string[]).includes(v)
/** Weather the scene actually shows: the Stormy-seas rule forces `stormy`, otherwise the player's pick. */
export const selectSkyWeather = (s: { modes: { storm: boolean }; settings: { weather: SkyWeather } }): Weather => (s.modes.storm ? 'stormy' : s.settings.weather)

/**
 * Optional rule variants, chosen at `startGame`. Both false = classic Battleship (one shot per turn,
 * every shot visible). See `src/extras/` for the UI that drives them.
 */
export interface GameModes {
  /** Salvo: each side fires one shot per surviving ship per turn. `fireAt` queues shots until the volley is full. */
  salvo: boolean
  /**
   * Stormy seas: the scene weather is `stormy` and every shot, by either side, has a `STORM_LOST_CHANCE` chance to be
   * lost in the storm — no damage, no hit/miss shown, the square stays unshot and can be fired at again.
   */
  storm: boolean
  /** Black Flag: pick your fleet (4 presets), one Broadside + one Spyglass per side, two hidden treasure chests per board. */
  blackFlag: boolean
}

export const DEFAULT_MODES: GameModes = { salvo: false, storm: false, blackFlag: false }

/** Probability that a shot (human or AI) is lost in the storm in stormy seas. */
export const STORM_LOST_CHANCE = 0.3

/** Events whose shot was lost in the storm, optionally for one side. */
export const lostShots = (events: readonly GameEvent[], by?: Player): GameEvent[] =>
  events.filter((e) => e.result.outcome === 'lost' && (by === undefined || e.by === by))

/** Who sits behind a side of the table: the player at the keyboard or the AI opponent. */
export type PlayerKind = 'local' | 'ai'

export interface Captain {
  name: string
  kind: PlayerKind
}

/**
 * Both sides of the table. `human` is always the local player at the keyboard (pirate livery, the near board);
 * `enemy` is the AI in single player or, in a "Two captains" hot-seat game, the second local captain (navy
 * livery, the far board). The engine keeps `Player = 'human' | 'enemy'` either way.
 */
export interface Players {
  human: Captain
  enemy: Captain
}

export const DEFAULT_PLAYERS: Players = { human: { name: 'Captain 1', kind: 'local' }, enemy: { name: 'Captain 2', kind: 'ai' } }

/** True when both sides are local captains sharing one keyboard (hot-seat). */
export const isHotSeat = (players: Players): boolean => players.enemy.kind === 'local'

/** The board a side fires at. */
export const targetBoardKey = (by: Player): 'playerBoard' | 'enemyBoard' => (by === 'human' ? 'enemyBoard' : 'playerBoard')
/** The board a side owns. */
export const ownBoardKey = (by: Player): 'playerBoard' | 'enemyBoard' => (by === 'human' ? 'playerBoard' : 'enemyBoard')

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
  /** Who sits on each side (see `Players`). Chosen in the menu; survives `reset()` like `modes`. */
  players: Players
  /** Hot-seat: the captain currently mustering their fleet (`human` in single player). */
  placing: Player
  /** Hot-seat: who places (and fires) first this game; `rematch()` swaps it. */
  firstPlacer: Player
  /**
   * Hot-seat handoff curtain: the captain who must take the deck next, or null when nobody has to look away. The HUD
   * and the 3D world hide both boards while it is set; only `endHandoff()` (the curtain's button) clears it.
   */
  handoff: Player | null
  /** Hot-seat: the captain whose side the HUD / camera show. Always `human` in single player. */
  perspective: Player
  events: GameEvent[]
  /** The events resolved by the most recent `fireAt` / `enemyTurn` (one shot in classic mode, a volley in salvo). */
  lastVolley: GameEvent[]
  salvo: SalvoState
  /** The fleet each side places this game (`FLEET` unless Black Flag picked a preset). */
  fleets: Record<Player, ShipSpec[]>
  fleetPresets: Record<Player, FleetPresetId>
  /** Black Flag: power shots still available per side (both `false` when Black Flag is off). */
  powerShots: Record<Player, PowerShots>
  /** Black Flag: treasure chests hidden on each side's own board (the other side finds them). Empty when off. */
  treasure: Record<Player, Coord[]>
  /** Black Flag: what each side has seen through the Spyglass on the other side's board. */
  spied: Record<Player, SpyMark[]>
  /** Black Flag: extra shots the side on turn still has from treasure (classic: fired one by one; salvo: the size of the bonus volley). */
  bonusShots: number
  settings: Settings
  /** Non-serialisable; recreated on every new game. */
  opponent?: AiOpponent
  /** Non-serialisable; decides which shots the storm swallows. */
  stormRng?: () => number
  /** Non-serialisable; the seeded stream behind the AI fleet pick and the treasure chests (same stream as `stormRng`). */
  rng?: () => number

  /**
   * `modes` omitted = keep the modes chosen so far (`setModes` in the menu, or the previous game's rules on a rematch);
   * `reset()` returns to classic. `seed` makes the stormy-seas rolls deterministic (tests, demos).
   */
  startGame: (difficulty: Difficulty, modes?: Partial<GameModes>, seed?: number) => void
  /** New game with the same rules; in a hot-seat game the other captain places (and fires) first. */
  rematch: () => void
  /** Choose who sits on each side (menu only). Partial: `{ enemy: { kind: 'local' } }` keeps the names. */
  setPlayers: (players: { human?: Partial<Captain>; enemy?: Partial<Captain> }) => void
  /** Raise the handoff curtain for `to` (hot-seat). No-op in single player. */
  beginHandoff: (to: Player) => void
  /** The captain tapped "ready": drop the curtain and show their side. */
  endHandoff: () => void
  /** Black Flag: choose the placing captain's fleet preset (placement only; clears any ships already placed). */
  setFleetPreset: (preset: FleetPresetId) => void
  /** `uid` identifies the instance in a fleet that repeats a class (`fleetUnits`); defaults to the class id. */
  placePlayerShip: (spec: ShipSpec, origin: Coord, orientation: Orientation, uid?: string) => boolean
  removePlayerShip: (uid: string) => void
  autoPlacePlayerFleet: () => void
  confirmPlacement: () => void
  /**
   * Human fires at the enemy board. Returns the result, or undefined if the move was illegal.
   * Salvo mode: returns `null` while the shot is only queued (see `salvo.pending`); when the volley is full every
   * queued shot resolves in order (all of them land in `events` / `lastVolley`) and the last result is returned.
   */
  fireAt: (coord: Coord, by?: Player) => ShotResult | null | undefined
  /**
   * Black Flag — Broadside: fires the up-to-3 cells of `broadsideCells(center, orientation)` that are still unshot,
   * each through the pure `fire()`, as the whole turn (in salvo it replaces the volley). Once per game per side.
   * Returns the results (empty array when illegal: not your turn, already used, no unshot cell in the line).
   */
  fireBroadside: (center: Coord, orientation: Orientation, by?: Player) => ShotResult[]
  /**
   * Black Flag — Spyglass: look at one unshot enemy cell. No shot, no turn spent. Once per game per side.
   * Returns what was seen, or undefined when illegal.
   */
  spyAt: (coord: Coord, by?: Player) => 'ship' | 'water' | undefined
  /** @internal shared tail of `fireAt` / `fireBroadside`; `by` (default `human`) is the shooter — the second hot-seat captain passes `enemy`. */
  resolveHuman: (volley: Coord[], kind: GameEventKind, group?: number, by?: Player) => ShotResult | undefined
  /**
   * The AI enemy takes a turn (a whole volley in salvo mode). Returns the last result. Call after `fireAt` (UI controls
   * the pacing). A no-op (undefined) in a hot-seat game: the second captain fires with `fireAt(coord, 'enemy')`.
   */
  enemyTurn: () => ShotResult | undefined
  /** Change the rules of the game being set up. Allowed in `menu` / `placement` only (ignored once the battle starts). */
  setModes: (modes: Partial<GameModes>) => void
  updateSettings: (patch: Partial<Settings>) => void
  reset: () => void
}

let eventId = 0

const DEFAULT_SETTINGS: Settings = { sfxVolume: 0.8, musicVolume: 0.5, reducedMotion: false, cinematics: 'full', quality: 'auto', colorblind: false, timeOfDay: 'golden', weather: 'calm' }

/** Settings the player chose that survive a reload (one key, `battleship-devin.settings`). `reducedMotion` defaults to the OS preference. */
export const SETTINGS_STORAGE_KEY = 'battleship-devin.settings'
const PERSISTED: (keyof Settings)[] = ['cinematics', 'sfxVolume', 'musicVolume', 'colorblind', 'reducedMotion', 'quality', 'timeOfDay', 'weather']

/** OS preference — only the default; the player's explicit toggle (persisted) wins afterwards (BUG-314). */
export const prefersReducedMotion = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * Loads persisted settings; unknown or malformed values fall back to defaults. `?tod=<preset>` and
 * `?weather=<calm|overcast|squall>` in `search` override the stored Sky & sea choice for this visit
 * (`?weather=stormy` is the legacy spelling of the squall look; lightning belongs to the Stormy-seas rule).
 */
export function loadSettings(
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
  search: string = typeof window === 'undefined' ? '' : (window.location?.search ?? ''),
): Settings {
  const out = { ...DEFAULT_SETTINGS, reducedMotion: prefersReducedMotion() }
  try {
    const raw = storage?.getItem(SETTINGS_STORAGE_KEY)
    const p = raw ? (JSON.parse(raw) as Partial<Record<keyof Settings, unknown>>) : {}
    if (p.cinematics === 'full' || p.cinematics === 'fast' || p.cinematics === 'off') out.cinematics = p.cinematics
    if (typeof p.sfxVolume === 'number' && p.sfxVolume >= 0 && p.sfxVolume <= 1) out.sfxVolume = p.sfxVolume
    if (typeof p.musicVolume === 'number' && p.musicVolume >= 0 && p.musicVolume <= 1) out.musicVolume = p.musicVolume
    if (typeof p.colorblind === 'boolean') out.colorblind = p.colorblind
    if (typeof p.reducedMotion === 'boolean') out.reducedMotion = p.reducedMotion
    if (p.quality === 'auto' || p.quality === 'low' || p.quality === 'medium' || p.quality === 'high') out.quality = p.quality
    if (isTimePreset(p.timeOfDay)) out.timeOfDay = p.timeOfDay
    if (isSkyWeather(p.weather)) out.weather = p.weather
  } catch {
    /* corrupt or unavailable storage: defaults */
  }
  try {
    const q = new URLSearchParams(search)
    const tod = q.get('tod')
    const weather = q.get('weather')
    if (isTimePreset(tod)) out.timeOfDay = tod
    if (isSkyWeather(weather)) out.weather = weather
    else if (weather === 'stormy') out.weather = 'squall'
  } catch {
    /* malformed query: keep stored values */
  }
  return out
}

export function saveSettings(settings: Settings, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(Object.fromEntries(PERSISTED.map((k) => [k, settings[k]]))))
  } catch {
    /* private mode / quota: not persisted */
  }
}

const initialSettings: Settings = loadSettings()

/** Shots per volley for the side that owns `board`: one per surviving ship, never less than one. */
export const salvoSize = (board: Board): number => Math.max(1, board.ships.filter((s) => !isSunk(s)).length)

/** Per-shot "lost in the storm?" roll: every shot rolls independently in stormy seas, never outside it. */
const stormRoll = ({ modes, stormRng }: Pick<GameState, 'modes' | 'stormRng'>): (() => boolean) => {
  if (!modes.storm) return () => false
  const rng = stormRng ?? Math.random
  return () => rng() < STORM_LOST_CHANCE
}

const emptySalvo = (): SalvoState => ({ pending: [], size: 1 })

const noPowerShots = (): Record<Player, PowerShots> => ({ human: { broadside: false, spyglass: false }, enemy: { broadside: false, spyglass: false } })
const fullPowerShots = (): Record<Player, PowerShots> => ({ human: { broadside: true, spyglass: true }, enemy: { broadside: true, spyglass: true } })
const classicFleets = (): Record<Player, ShipSpec[]> => ({ human: [...FLEET], enemy: [...FLEET] })
const emptyPerPlayer = <T,>(): Record<Player, T[]> => ({ human: [], enemy: [] })

export const other = (p: Player): Player => (p === 'human' ? 'enemy' : 'human')

/** The board the captain `placing` is mustering on. */
export const placementBoard = (s: Pick<GameState, 'placing' | 'playerBoard' | 'enemyBoard'>): Board => (s.placing === 'enemy' ? s.enemyBoard : s.playerBoard)

/** The number of treasure chests `by` has uncovered so far. */
export const treasureFound = (events: readonly GameEvent[], by: Player): number => events.filter((e) => e.by === by && e.kind === 'treasure').length

/** Human-readable preset name of a fleet (the Black Flag line of the report). */
export const fleetPresetName = (id: FleetPresetId): string => FLEET_PRESETS.find((p) => p.id === id)?.name ?? id

let groupId = 0

interface Resolved {
  board: Board
  events: GameEvent[]
  /** Treasure chests uncovered in this volley. */
  treasure: number
  last?: ShotResult
}

/**
 * Resolves `coords` against `board` in order, via the pure `fire()`: one event per shot, `kind: 'treasure'` for
 * a chest. Stops when the fleet is sunk. `onShot` lets the caller feed the AI per result. `lost` is the stormy-seas roll:
 * when it returns true the shot is recorded as `lost` (an event only — `fire()` is not called, the cell stays unknown).
 */
function resolveVolley(board: Board, coords: readonly Coord[], by: Player, kind: GameEventKind, chests: readonly Coord[], group?: number, onShot?: (r: ShotResult) => void, lost: () => boolean = () => false): Resolved {
  const events: GameEvent[] = []
  let treasure = 0
  let last: ShotResult | undefined
  for (const c of coords) {
    if (hasBeenShot(board, c)) continue
    if (lost()) {
      last = lostShot(c)
      events.push({ id: ++eventId, by, result: last, kind, group })
      onShot?.(last)
      continue
    }
    const next = fire(board, c)
    board = next.board
    last = next.result
    const chest = next.result.outcome === 'miss' && hasTreasureAt(chests, c)
    if (chest) treasure++
    events.push({ id: ++eventId, by, result: next.result, kind: chest ? 'treasure' : kind, group })
    onShot?.(next.result)
    if (isFleetSunk(board)) break
  }
  return { board, events, treasure, last }
}

export const useGameStore = create<GameState>((set, get) => ({
  phase: 'menu',
  difficulty: 'medium',
  modes: DEFAULT_MODES,
  playerBoard: createBoard(),
  enemyBoard: createBoard(),
  turn: 'human',
  players: DEFAULT_PLAYERS,
  placing: 'human',
  firstPlacer: 'human',
  handoff: null,
  perspective: 'human',
  events: [],
  lastVolley: [],
  salvo: emptySalvo(),
  fleets: classicFleets(),
  fleetPresets: { human: 'classic', enemy: 'classic' },
  powerShots: noPowerShots(),
  treasure: emptyPerPlayer<Coord>(),
  spied: emptyPerPlayer<SpyMark>(),
  bonusShots: 0,
  settings: initialSettings,

  startGame: (difficulty, modes, seed) =>
    set((s) => {
      const rules = modes ? { ...DEFAULT_MODES, ...modes } : s.modes
      const rng = seededRng(seed ?? Math.floor(Math.random() * 0xffffffff))
      const hotSeat = isHotSeat(s.players)
      const first = hotSeat ? s.firstPlacer : 'human'
      // Black Flag: the AI enemy picks a random preset; local captains pick in placement (classic until then)
      const enemyPreset: FleetPresetId = rules.blackFlag && !hotSeat ? FLEET_PRESETS[Math.floor(rng() * FLEET_PRESETS.length)].id : 'classic'
      const enemyFleet = presetFleet(enemyPreset)
      return {
        phase: 'placement',
        difficulty,
        modes: rules,
        playerBoard: createBoard(),
        // the second captain musters their own fleet; the AI's is drawn for it
        enemyBoard: hotSeat ? createBoard() : randomPlacement(rng, enemyFleet),
        fleets: { human: [...FLEET], enemy: enemyFleet },
        fleetPresets: { human: 'classic', enemy: enemyPreset },
        powerShots: rules.blackFlag ? fullPowerShots() : noPowerShots(),
        treasure: emptyPerPlayer<Coord>(),
        spied: emptyPerPlayer<SpyMark>(),
        bonusShots: 0,
        opponent: hotSeat ? undefined : createOpponent(difficulty, rng),
        stormRng: rng,
        rng,
        turn: first,
        placing: first,
        firstPlacer: first,
        handoff: null,
        perspective: first,
        winner: undefined,
        events: [],
        lastVolley: [],
        salvo: emptySalvo(),
      }
    }),

  rematch: () => {
    const s = get()
    if (isHotSeat(s.players)) set({ firstPlacer: other(s.firstPlacer) })
    get().startGame(s.difficulty)
  },

  setPlayers: (patch) =>
    set((s) =>
      s.phase === 'menu'
        ? {
            players: {
              human: { ...s.players.human, ...patch.human, kind: 'local' },
              enemy: { ...s.players.enemy, ...patch.enemy },
            },
            firstPlacer: 'human',
          }
        : {},
    ),

  beginHandoff: (to) => set((s) => (isHotSeat(s.players) && (s.phase === 'placement' || s.phase === 'battle') ? { handoff: to } : {})),

  endHandoff: () => set((s) => (s.handoff ? { handoff: null, perspective: s.phase === 'placement' ? s.placing : s.turn } : {})),

  setFleetPreset: (preset) =>
    set((s) => {
      if (s.phase !== 'placement' || !s.modes.blackFlag) return {}
      const key = ownBoardKey(s.placing)
      return { fleetPresets: { ...s.fleetPresets, [s.placing]: preset }, fleets: { ...s.fleets, [s.placing]: presetFleet(preset) }, [key]: createBoard(s[key].size) }
    }),

  placePlayerShip: (spec, origin, orientation, uid = spec.id) => {
    const s = get()
    if (s.phase !== 'placement') return false
    const key = ownBoardKey(s.placing)
    try {
      set({ [key]: placeShip(s[key], spec, origin, orientation, uid) })
      return true
    } catch {
      return false
    }
  },

  removePlayerShip: (uid) =>
    set((s) => {
      if (s.phase !== 'placement') return {}
      const key = ownBoardKey(s.placing)
      return { [key]: removeShip(s[key], uid) }
    }),

  autoPlacePlayerFleet: () => set((s) => (s.phase === 'placement' ? { [ownBoardKey(s.placing)]: randomPlacement(s.rng ?? Math.random, s.fleets[s.placing]) } : {})),

  confirmPlacement: () => {
    const s = get()
    const { phase, fleets, modes, rng } = s
    if (phase !== 'placement' || !isFleetPlaced(placementBoard(s), fleets[s.placing])) return
    const hotSeat = isHotSeat(s.players)
    if (hotSeat && !isFleetPlaced(s[ownBoardKey(other(s.placing))], fleets[other(s.placing)])) {
      // first captain is done: curtain, then the other captain musters on the same screen
      const next = other(s.placing)
      set({ placing: next, handoff: next })
      return
    }
    const first = s.firstPlacer
    const draw = rng ?? Math.random
    const treasure = modes.blackFlag
      ? { human: treasureCells(s.playerBoard, draw, TREASURE_PER_BOARD), enemy: treasureCells(s.enemyBoard, draw, TREASURE_PER_BOARD) }
      : emptyPerPlayer<Coord>()
    set({
      phase: 'battle',
      turn: first,
      perspective: first,
      // the battle opens behind the curtain so the first captain's opponent cannot see the boards being revealed
      handoff: hotSeat ? first : null,
      salvo: { pending: [], size: salvoSize(s[ownBoardKey(first)]) },
      treasure,
      bonusShots: 0,
    })
  },

  fireAt: (coord, by = 'human') => {
    const state = get()
    const { phase, turn, modes, salvo, bonusShots } = state
    if (phase !== 'battle' || turn !== by || state.handoff) return undefined
    const targetBoard = state[targetBoardKey(by)]
    const ownBoard = state[ownBoardKey(by)]
    if (!inBounds(coord, targetBoard.size) || hasBeenShot(targetBoard, coord)) return undefined

    let volley: Coord[] = [coord]
    if (modes.salvo) {
      if (salvo.pending.some((p) => sameCoord(p, coord))) return undefined
      const pending = [...salvo.pending, coord]
      // a treasure bonus volley is exactly the chests found; otherwise one shot per surviving ship —
      // never more than the unshot cells left, or the last volley could never fill (BUG-548)
      const unshot = targetBoard.size * targetBoard.size - targetBoard.shots.length
      const size = Math.max(1, Math.min(bonusShots > 0 ? bonusShots : Math.min(salvo.size, salvoSize(ownBoard)), unshot))
      if (pending.length < size) {
        set({ salvo: { pending, size } })
        return null
      }
      volley = pending
    }
    return get().resolveHuman(volley, 'shot', undefined, by)
  },

  fireBroadside: (center, orientation, by = 'human') => {
    const state = get()
    const { phase, turn, powerShots, modes } = state
    const targetBoard = state[targetBoardKey(by)]
    if (phase !== 'battle' || turn !== by || state.handoff || !modes.blackFlag || !powerShots[by].broadside) return []
    if (!inBounds(center, targetBoard.size)) return []
    const cells = broadsideCells(center, orientation, targetBoard.size).filter((c) => !hasBeenShot(targetBoard, c))
    if (cells.length === 0) return []
    set((s) => ({ powerShots: { ...s.powerShots, [by]: { ...s.powerShots[by], broadside: false } } }))
    get().resolveHuman(cells, 'broadside', ++groupId, by)
    return get().lastVolley.map((e) => e.result)
  },

  spyAt: (coord, by = 'human') => {
    const state = get()
    const { phase, turn, powerShots, modes, events, spied } = state
    const targetBoard = state[targetBoardKey(by)]
    if (phase !== 'battle' || turn !== by || state.handoff || !modes.blackFlag || !powerShots[by].spyglass) return undefined
    if (!inBounds(coord, targetBoard.size) || hasBeenShot(targetBoard, coord)) return undefined
    const ship = !!shipAt(targetBoard, coord)
    set({
      powerShots: { ...powerShots, [by]: { ...powerShots[by], spyglass: false } },
      spied: { ...spied, [by]: [...spied[by], { coord, ship }] },
      events: [...events, { id: ++eventId, by, kind: 'spyglass', spied: ship ? 'ship' : 'water', result: { coord, outcome: 'miss' } }],
    })
    return ship ? 'ship' : 'water'
  },

  /** @internal Resolves `by`'s volley / Broadside line against the other side's board and advances the turn. */
  resolveHuman: (volley, kind, group, by = 'human') => {
    const state = get()
    const { modes, bonusShots, treasure, events } = state
    const targetKey = targetBoardKey(by)
    const targetBoard = state[targetKey]
    const ownBoard = state[ownBoardKey(by)]
    const next = other(by)
    // stormy seas: the same lost-shot roll for both captains (and the single player)
    const r = resolveVolley(targetBoard, volley, by, kind, treasure[next], group, undefined, stormRoll(state))
    const won = isFleetSunk(r.board)
    // treasure: the shooter fires again — the chests found become extra shots (salvo: a bonus volley of that size)
    const spent = bonusShots > 0 ? (modes.salvo ? bonusShots : 1) : 0
    const bonus = won ? 0 : Math.max(0, bonusShots - spent) + r.treasure
    const keepsTurn = won || bonus > 0
    // hot-seat: the next volley belongs to the other captain, whose own board is the one just fired at
    const nextOwn = !keepsTurn && isHotSeat(state.players) ? r.board : ownBoard
    set({
      [targetKey]: r.board,
      events: [...events, ...r.events],
      lastVolley: r.events,
      salvo: { pending: [], size: bonus > 0 ? bonus : salvoSize(nextOwn) },
      bonusShots: bonus,
      turn: keepsTurn ? by : next,
      phase: won ? 'gameover' : 'battle',
      winner: won ? by : undefined,
    })
    return r.last
  },

  enemyTurn: () => {
    const { phase, turn, playerBoard, opponent, events, modes, powerShots, treasure, spied, difficulty, players } = get()
    if (phase !== 'battle' || turn !== 'enemy' || !opponent || isHotSeat(players)) return undefined
    let shots = modes.salvo ? salvoSize(get().enemyBoard) : 1
    let board = playerBoard
    const resolved: GameEvent[] = []
    let last: ShotResult | undefined
    let power = powerShots.enemy
    let seen = spied.enemy
    const observe = (res: ShotResult) => opponent.observe(res)
    // the AI only ever sees the board, never the lost shots, so a lost cell is simply still unknown to it
    const swallowed = stormRoll(get())

    // Black Flag — Spyglass (Hard): one look when the heatmap has a clear favourite; no shot, no turn spent
    if (modes.blackFlag && power.spyglass && opponent.spyTarget) {
      const look = opponent.spyTarget(enemyView(board))
      if (look) {
        const ship = !!shipAt(board, look)
        opponent.observeSpy?.(look, ship)
        power = { ...power, spyglass: false }
        seen = [...seen, { coord: look, ship }]
        resolved.push({ id: ++eventId, by: 'enemy', kind: 'spyglass', spied: ship ? 'ship' : 'water', result: { coord: look, outcome: 'miss' } })
      }
    }

    // Black Flag — Broadside (Medium / Hard): the turn after the first confirmed hit, aligned with it
    if (modes.blackFlag && power.broadside && difficulty !== 'easy' && opponent.broadsideTarget) {
      const line = opponent.broadsideTarget(enemyView(board))
      if (line) {
        const cells = broadsideCells(line.center, line.orientation, board.size).filter((c) => !hasBeenShot(board, c))
        if (cells.length > 0) {
          power = { ...power, broadside: false }
          const r = resolveVolley(board, cells, 'enemy', 'broadside', treasure.human, ++groupId, observe, swallowed)
          board = r.board
          resolved.push(...r.events)
          last = r.last
          shots = r.treasure // the Broadside is the whole turn; chests found are extra shots
        }
      }
    }

    for (let i = 0; i < shots && !isFleetSunk(board); i++) {
      const coord = opponent.nextShot(enemyView(board))
      const r = resolveVolley(board, [coord], 'enemy', 'shot', treasure.human, undefined, observe, swallowed)
      board = r.board
      resolved.push(...r.events)
      last = r.last ?? last
      shots += r.treasure // treasure: fire again (salvo: +1 shot in the volley)
    }
    const lost = isFleetSunk(board)
    set({
      playerBoard: board,
      events: [...events, ...resolved],
      lastVolley: resolved,
      powerShots: { ...get().powerShots, enemy: power },
      spied: { ...get().spied, enemy: seen },
      salvo: { pending: [], size: salvoSize(board) },
      bonusShots: 0,
      turn: 'human',
      phase: lost ? 'gameover' : 'battle',
      winner: lost ? 'enemy' : undefined,
    })
    return last
  },

  setModes: (modes) => set((s) => (s.phase === 'menu' || s.phase === 'placement' ? { modes: { ...s.modes, ...modes } } : {})),
  updateSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch }
      if (PERSISTED.some((k) => k in patch)) saveSettings(settings)
      return { settings }
    }),

  reset: () =>
    set((s) => ({
      phase: 'menu',
      // the chosen rules survive "Menu" / "Play again" like the difficulty does (BUG-320); so do the captains' names
      modes: s.modes,
      players: s.players,
      playerBoard: createBoard(),
      enemyBoard: createBoard(),
      opponent: undefined,
      stormRng: undefined,
      rng: undefined,
      turn: 'human',
      placing: 'human',
      firstPlacer: 'human',
      handoff: null,
      perspective: 'human',
      winner: undefined,
      events: [],
      lastVolley: [],
      salvo: emptySalvo(),
      fleets: classicFleets(),
      fleetPresets: { human: 'classic', enemy: 'classic' },
      powerShots: noPowerShots(),
      treasure: emptyPerPlayer<Coord>(),
      spied: emptyPerPlayer<SpyMark>(),
      bonusShots: 0,
    })),
}))
