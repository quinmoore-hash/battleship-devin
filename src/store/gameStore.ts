import { create } from 'zustand'
import { isTimePreset, type TimePreset, type Weather } from '../scene/sun'
import { createOpponent, seededRng, type AiOpponent } from '../ai'
import {
  broadsideCells,
  coordKey,
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
  type EnemyBoardView,
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
  /** Stormy seas: the scene weather is `stormy` and fog hides ~30% of the player's misses on the enemy grid. */
  storm: boolean
  /** Black Flag: pick your fleet (4 presets), one Broadside + one Spyglass per side, two hidden treasure chests per board. */
  blackFlag: boolean
}

export const DEFAULT_MODES: GameModes = { salvo: false, storm: false, blackFlag: false }

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
  /** Non-serialisable; decides which misses the storm fog hides. */
  fogRng?: () => number
  /** Non-serialisable; the seeded stream behind the AI fleet pick and the treasure chests (same stream as `fogRng`). */
  rng?: () => number

  /**
   * `modes` omitted = keep the modes chosen so far (`setModes` in the menu, or the previous game's rules on a rematch);
   * `reset()` returns to classic. `seed` makes the stormy-seas fog deterministic (tests, demos).
   */
  startGame: (difficulty: Difficulty, modes?: Partial<GameModes>, seed?: number) => void
  /** Black Flag: choose the human fleet preset (placement only; clears any ships already placed). */
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
  fireAt: (coord: Coord) => ShotResult | null | undefined
  /**
   * Black Flag — Broadside: fires the up-to-3 cells of `broadsideCells(center, orientation)` that are still unshot,
   * each through the pure `fire()`, as the whole turn (in salvo it replaces the volley). Once per game per side.
   * Returns the results (empty array when illegal: not your turn, already used, no unshot cell in the line).
   */
  fireBroadside: (center: Coord, orientation: Orientation) => ShotResult[]
  /**
   * Black Flag — Spyglass: look at one unshot enemy cell. No shot, no turn spent. Once per game per side.
   * Returns what was seen, or undefined when illegal.
   */
  spyAt: (coord: Coord) => 'ship' | 'water' | undefined
  /** @internal shared tail of `fireAt` / `fireBroadside`. */
  resolveHuman: (volley: Coord[], kind: GameEventKind, group?: number) => ShotResult | undefined
  /** The enemy takes a turn (a whole volley in salvo mode). Returns the last result. Call after `fireAt` (UI controls the pacing). */
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

/** The enemy board as the human sees it in stormy seas: fogged misses are removed from the shot list (they read as `unknown`). */
export function foggedEnemyView(board: Board, fogged: readonly string[]): EnemyBoardView {
  const view = enemyView(board)
  if (fogged.length === 0) return view
  const hidden = new Set(fogged)
  return { ...view, shots: view.shots.filter((s) => !hidden.has(coordKey(s.coord))) }
}

const emptySalvo = (): SalvoState => ({ pending: [], size: 1 })

const noPowerShots = (): Record<Player, PowerShots> => ({ human: { broadside: false, spyglass: false }, enemy: { broadside: false, spyglass: false } })
const fullPowerShots = (): Record<Player, PowerShots> => ({ human: { broadside: true, spyglass: true }, enemy: { broadside: true, spyglass: true } })
const classicFleets = (): Record<Player, ShipSpec[]> => ({ human: [...FLEET], enemy: [...FLEET] })
const emptyPerPlayer = <T,>(): Record<Player, T[]> => ({ human: [], enemy: [] })

export const other = (p: Player): Player => (p === 'human' ? 'enemy' : 'human')

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
 * a chest. Stops when the fleet is sunk. `onShot` lets the caller roll the storm fog / feed the AI per result.
 */
function resolveVolley(board: Board, coords: readonly Coord[], by: Player, kind: GameEventKind, chests: readonly Coord[], group?: number, onShot?: (r: ShotResult) => void): Resolved {
  const events: GameEvent[] = []
  let treasure = 0
  let last: ShotResult | undefined
  for (const c of coords) {
    if (hasBeenShot(board, c)) continue
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
  events: [],
  lastVolley: [],
  salvo: emptySalvo(),
  fogged: [],
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
      // Black Flag: the enemy picks a random preset; the human picks in placement (classic until then)
      const enemyPreset: FleetPresetId = rules.blackFlag ? FLEET_PRESETS[Math.floor(rng() * FLEET_PRESETS.length)].id : 'classic'
      const enemyFleet = presetFleet(enemyPreset)
      return {
        phase: 'placement',
        difficulty,
        modes: rules,
        playerBoard: createBoard(),
        enemyBoard: randomPlacement(rng, enemyFleet),
        fleets: { human: [...FLEET], enemy: enemyFleet },
        fleetPresets: { human: 'classic', enemy: enemyPreset },
        powerShots: rules.blackFlag ? fullPowerShots() : noPowerShots(),
        treasure: emptyPerPlayer<Coord>(),
        spied: emptyPerPlayer<SpyMark>(),
        bonusShots: 0,
        opponent: createOpponent(difficulty, rng),
        fogRng: rng,
        rng,
        turn: 'human',
        winner: undefined,
        events: [],
        lastVolley: [],
        salvo: emptySalvo(),
        fogged: [],
      }
    }),

  setFleetPreset: (preset) =>
    set((s) =>
      s.phase === 'placement' && s.modes.blackFlag
        ? { fleetPresets: { ...s.fleetPresets, human: preset }, fleets: { ...s.fleets, human: presetFleet(preset) }, playerBoard: createBoard(s.playerBoard.size) }
        : {},
    ),

  placePlayerShip: (spec, origin, orientation, uid = spec.id) => {
    const { playerBoard, phase } = get()
    if (phase !== 'placement') return false
    try {
      set({ playerBoard: placeShip(playerBoard, spec, origin, orientation, uid) })
      return true
    } catch {
      return false
    }
  },

  removePlayerShip: (uid) =>
    set((s) => (s.phase === 'placement' ? { playerBoard: removeShip(s.playerBoard, uid) } : {})),

  autoPlacePlayerFleet: () => set((s) => (s.phase === 'placement' ? { playerBoard: randomPlacement(s.rng ?? Math.random, s.fleets.human) } : {})),

  confirmPlacement: () => {
    const { playerBoard, enemyBoard, phase, fleets, modes, rng } = get()
    if (phase !== 'placement' || !isFleetPlaced(playerBoard, fleets.human)) return
    const draw = rng ?? Math.random
    const treasure = modes.blackFlag
      ? { human: treasureCells(playerBoard, draw, TREASURE_PER_BOARD), enemy: treasureCells(enemyBoard, draw, TREASURE_PER_BOARD) }
      : emptyPerPlayer<Coord>()
    set({ phase: 'battle', turn: 'human', salvo: { pending: [], size: salvoSize(playerBoard) }, treasure, bonusShots: 0 })
  },

  fireAt: (coord) => {
    const { phase, turn, enemyBoard, modes, salvo, playerBoard, bonusShots } = get()
    if (phase !== 'battle' || turn !== 'human') return undefined
    if (!inBounds(coord, enemyBoard.size) || hasBeenShot(enemyBoard, coord)) return undefined

    let volley: Coord[] = [coord]
    if (modes.salvo) {
      if (salvo.pending.some((p) => sameCoord(p, coord))) return undefined
      const pending = [...salvo.pending, coord]
      // a treasure bonus volley is exactly the chests found; otherwise one shot per surviving ship
      const size = bonusShots > 0 ? bonusShots : Math.min(salvo.size, salvoSize(playerBoard))
      if (pending.length < size) {
        set({ salvo: { pending, size } })
        return null
      }
      volley = pending
    }
    return get().resolveHuman(volley, 'shot')
  },

  fireBroadside: (center, orientation) => {
    const { phase, turn, enemyBoard, powerShots, modes } = get()
    if (phase !== 'battle' || turn !== 'human' || !modes.blackFlag || !powerShots.human.broadside) return []
    if (!inBounds(center, enemyBoard.size)) return []
    const cells = broadsideCells(center, orientation, enemyBoard.size).filter((c) => !hasBeenShot(enemyBoard, c))
    if (cells.length === 0) return []
    set((s) => ({ powerShots: { ...s.powerShots, human: { ...s.powerShots.human, broadside: false } } }))
    get().resolveHuman(cells, 'broadside', ++groupId)
    return get().lastVolley.map((e) => e.result)
  },

  spyAt: (coord) => {
    const { phase, turn, enemyBoard, powerShots, modes, events, spied } = get()
    if (phase !== 'battle' || turn !== 'human' || !modes.blackFlag || !powerShots.human.spyglass) return undefined
    if (!inBounds(coord, enemyBoard.size) || hasBeenShot(enemyBoard, coord)) return undefined
    const ship = !!shipAt(enemyBoard, coord)
    set({
      powerShots: { ...powerShots, human: { ...powerShots.human, spyglass: false } },
      spied: { ...spied, human: [...spied.human, { coord, ship }] },
      events: [...events, { id: ++eventId, by: 'human', kind: 'spyglass', spied: ship ? 'ship' : 'water', result: { coord, outcome: 'miss' } }],
    })
    return ship ? 'ship' : 'water'
  },

  /** @internal Resolves the human's volley / Broadside line against the enemy board and advances the turn. */
  resolveHuman: (volley, kind, group) => {
    const { enemyBoard, modes, playerBoard, bonusShots, treasure } = get()
    const { events, fogged, fogRng } = get()
    const newlyFogged: string[] = []
    const r = resolveVolley(enemyBoard, volley, 'human', kind, treasure.enemy, group, (res) => {
      if (modes.storm && res.outcome === 'miss' && (fogRng ?? Math.random)() < STORM_FOG_CHANCE) newlyFogged.push(coordKey(res.coord))
    })
    const won = isFleetSunk(r.board)
    // treasure: the shooter fires again — the chests found become extra shots (salvo: a bonus volley of that size)
    const spent = bonusShots > 0 ? (modes.salvo ? bonusShots : 1) : 0
    const bonus = won ? 0 : Math.max(0, bonusShots - spent) + r.treasure
    set({
      enemyBoard: r.board,
      events: [...events, ...r.events],
      lastVolley: r.events,
      fogged: newlyFogged.length ? [...fogged, ...newlyFogged] : fogged,
      salvo: { pending: [], size: bonus > 0 ? bonus : salvoSize(playerBoard) },
      bonusShots: bonus,
      turn: won || bonus > 0 ? 'human' : 'enemy',
      phase: won ? 'gameover' : 'battle',
      winner: won ? 'human' : undefined,
    })
    return r.last
  },

  enemyTurn: () => {
    const { phase, turn, playerBoard, opponent, events, modes, powerShots, treasure, spied, difficulty } = get()
    if (phase !== 'battle' || turn !== 'enemy' || !opponent) return undefined
    let shots = modes.salvo ? salvoSize(get().enemyBoard) : 1
    let board = playerBoard
    const resolved: GameEvent[] = []
    let last: ShotResult | undefined
    let power = powerShots.enemy
    let seen = spied.enemy
    const observe = (res: ShotResult) => opponent.observe(res)

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
          const r = resolveVolley(board, cells, 'enemy', 'broadside', treasure.human, ++groupId, observe)
          board = r.board
          resolved.push(...r.events)
          last = r.last
          shots = r.treasure // the Broadside is the whole turn; chests found are extra shots
        }
      }
    }

    for (let i = 0; i < shots && !isFleetSunk(board); i++) {
      const coord = opponent.nextShot(enemyView(board))
      const r = resolveVolley(board, [coord], 'enemy', 'shot', treasure.human, undefined, observe)
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
      // the chosen rules survive "Menu" / "Play again" like the difficulty does (BUG-320)
      modes: s.modes,
      playerBoard: createBoard(),
      enemyBoard: createBoard(),
      opponent: undefined,
      fogRng: undefined,
      rng: undefined,
      turn: 'human',
      winner: undefined,
      events: [],
      lastVolley: [],
      salvo: emptySalvo(),
      fogged: [],
      fleets: classicFleets(),
      fleetPresets: { human: 'classic', enemy: 'classic' },
      powerShots: noPowerShots(),
      treasure: emptyPerPlayer<Coord>(),
      spied: emptyPerPlayer<SpyMark>(),
      bonusShots: 0,
    })),
}))
