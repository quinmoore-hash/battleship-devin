import type { CinematicDirector, CinematicEvent } from '../cinematics'
import { CINEMATIC_TIMING } from '../cinematics'
import type { Coord, Difficulty, ShotResult } from '../engine'
import { is3dDisabled } from '../scene/flags'
import { useGameStore, type CinematicsLevel } from '../store/gameStore'

/**
 * Turn pacing for the battle screen. Every beat of a turn (the player's shot, a sinking, the enemy
 * taking aim, the enemy's shot) is a `CinematicEvent` handed to `playEvent`. When the cinematics
 * module registers a `CinematicDirector` (via `setDirector`) the director plays camera + VFX + audio
 * and we await it; otherwise `TimerDirector` simply waits the scaled `CINEMATIC_TIMING` so the HUD
 * still reads as a sequence of beats. `settings.cinematics === 'off'` (or reduced motion) collapses
 * every wait to a few milliseconds so e2e flows stay fast and deterministic.
 */

/** Delay before the enemy fires, in ms, per difficulty ("the enemy is aiming…"). */
export const AIM_DELAY: Record<Difficulty | 'reduced', [number, number]> = {
  easy: [1100, 1700],
  medium: [800, 1300],
  hard: [500, 900],
  reduced: [60, 120],
}

/** Multiplier applied to `CINEMATIC_TIMING` when no director is registered: the HUD only needs a beat, not the whole camera move. */
export const TIMER_SCALE = 0.15
export const OFF_DELAY_MS = 30

export type TurnPhase = 'idle' | 'player-shot' | 'player-sink' | 'enemy-aiming' | 'enemy-shot' | 'enemy-sink' | 'done'

export interface TurnBeat {
  phase: TurnPhase
  result?: ShotResult
}

let director: CinematicDirector | null = null
const directorListeners = new Set<() => void>()

/** Integration: the cinematics module calls this once with `createDirector()`. Pass `null` to go back to timers. */
export function setDirector(d: CinematicDirector | null) {
  director = d
  directorListeners.forEach((l) => l())
}
export const getDirector = () => director
export function onDirectorChange(listener: () => void) {
  directorListeners.add(listener)
  return () => void directorListeners.delete(listener)
}

/** Duration the timer fallback waits for `event` at `level`, in ms. Pure, unit-tested. */
export function fallbackDuration(event: CinematicEvent, level: CinematicsLevel, reducedMotion = false): number {
  if (level === 'off' || reducedMotion) return OFF_DELAY_MS
  const timing = CINEMATIC_TIMING[event.type]
  return Math.round(timing[level] * 1000 * TIMER_SCALE)
}

export function aimDelay(difficulty: Difficulty, quick: boolean, rng = Math.random): number {
  const [a, b] = quick ? AIM_DELAY.reduced : AIM_DELAY[difficulty]
  return Math.round(a + rng() * (b - a))
}

/** The cinematics level the turn flow actually uses: `full` needs the 3D world to be worth watching. */
export function effectiveLevel(level: CinematicsLevel, no3d: boolean = is3dDisabled()): CinematicsLevel {
  return level === 'full' && no3d ? 'fast' : level
}

/** A skippable wait. `skip()` resolves it immediately. */
export class Sleeper {
  private timer: ReturnType<typeof setTimeout> | null = null
  private resolve: (() => void) | null = null

  wait(ms: number): Promise<void> {
    this.skip()
    return new Promise<void>((resolve) => {
      this.resolve = resolve
      this.timer = setTimeout(() => this.finish(), ms)
    })
  }

  skip() {
    this.finish()
  }

  private finish() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const r = this.resolve
    this.resolve = null
    r?.()
  }
}

/** Timer-based stand-in for the real director: waits the scaled timing, skippable. */
export class TimerDirector implements CinematicDirector {
  busy = false
  private sleeper = new Sleeper()
  private readonly reducedMotion: () => boolean
  constructor(reducedMotion: () => boolean = () => false) {
    this.reducedMotion = reducedMotion
  }

  async play(event: CinematicEvent, level: CinematicsLevel): Promise<void> {
    this.busy = true
    try {
      await this.sleeper.wait(fallbackDuration(event, level, this.reducedMotion()))
    } finally {
      this.busy = false
    }
  }

  skip() {
    this.sleeper.skip()
  }
}

export interface TurnFlowOptions {
  /** Called at every beat so the HUD can update its status line. */
  onBeat?: (beat: TurnBeat) => void
  rng?: () => number
}

export interface TurnFlow {
  /** Fire at `coord` and play the whole turn (player shot → sink? → enemy aims → enemy shot → sink?). Resolves when input may resume. */
  fire: (coord: Coord) => Promise<ShotResult | undefined>
  /** Skip whatever is currently playing (click / Space). */
  skip: () => void
  readonly busy: boolean
  dispose: () => void
}

/**
 * Drives one complete turn through the store. The flow reads the store directly so it stays
 * correct if the phase changes under it (quit, game over).
 */
export function createTurnFlow({ onBeat, rng = Math.random }: TurnFlowOptions = {}): TurnFlow {
  const timers = new TimerDirector(() => useGameStore.getState().settings.reducedMotion)
  const aim = new Sleeper()
  let busy = false
  let disposed = false

  const play = async (event: CinematicEvent) => {
    // Without the 3D world (`?no3d` / no WebGL) there is nothing to watch, so 'full' pacing drops to 'fast'.
    const cinematics = effectiveLevel(useGameStore.getState().settings.cinematics)
    const d = director ?? timers
    try {
      await d.play(event, cinematics)
    } catch (err) {
      console.warn('cinematic failed, continuing', err)
    }
  }

  const beat = (phase: TurnPhase, result?: ShotResult) => {
    if (!disposed) onBeat?.({ phase, result })
  }

  const fire = async (coord: Coord) => {
    const store = useGameStore.getState()
    if (busy || store.phase !== 'battle' || store.turn !== 'human') return undefined
    const result = store.fireAt(coord)
    if (!result) return undefined
    busy = true
    try {
      beat('player-shot', result)
      await play({ type: 'shot', by: 'human', target: coord, result })
      if (result.outcome === 'sunk' && result.shipId) {
        beat('player-sink', result)
        await play({ type: 'sink', owner: 'enemy', shipId: result.shipId })
      }
      if (useGameStore.getState().phase !== 'battle') {
        beat('done', result)
        return result
      }

      beat('enemy-aiming')
      const { difficulty, settings } = useGameStore.getState()
      await aim.wait(aimDelay(difficulty, settings.reducedMotion || settings.cinematics === 'off', rng))
      if (useGameStore.getState().phase !== 'battle') return result

      const enemy = useGameStore.getState().enemyTurn()
      if (enemy) {
        beat('enemy-shot', enemy)
        await play({ type: 'shot', by: 'enemy', target: enemy.coord, result: enemy })
        if (enemy.outcome === 'sunk' && enemy.shipId) {
          beat('enemy-sink', enemy)
          await play({ type: 'sink', owner: 'human', shipId: enemy.shipId })
        }
      }
      beat('done', enemy)
      return result
    } finally {
      busy = false
    }
  }

  const skip = () => {
    ;(director ?? timers).skip()
    aim.skip()
  }

  return {
    fire,
    skip,
    get busy() {
      return busy
    },
    dispose: () => {
      disposed = true
      skip()
    },
  }
}
