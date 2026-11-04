import { createStore, useStore, type StoreApi } from 'zustand'
import { duckMusic, playCinematicAudio, playSfx, playSfxAt } from '../audio'
import type { PlacedShip, Player } from '../engine'
import { defaultQuality } from '../scene'
import { deckBus, deckCameraLease, type DeckState } from '../deck/contract'
import { useGameStore, type CinematicsLevel } from '../store/gameStore'
import type { CannonRef } from '../ships/types'
import { sinkProgressAt } from '../vfx/sinking/timeline'
import type { Vec3 } from '../scene/layout'
import { ownBoardOrigin, planShot, type ShotPlan } from './battery'
import { POV, abandonAtFor, nextAfloatUid, overboardFor, playerEye, povBeatEvents, povFor, readDeckState, shipWorldPosition, sinkHoldLook, sinkViewFor, stationBattery, stationMuzzle, type PovContext } from './pov'
import { allowShake, beatAt, buildSequence, createSequenceClock, maxBalls, timeScaleAt, type BeatName, type BeatState, type Budget, type Sequence, type SequenceClock } from './sequence'
import type { CinematicDirector, CinematicEvent } from './types'

export interface Fleets {
  human: readonly PlacedShip[]
  enemy: readonly PlacedShip[]
}

export interface ActiveCinematic {
  id: number
  event: CinematicEvent
  seq: Sequence
  clock: SequenceClock
  plan: ShotPlan | null
  /** Ship being sunk (sink) or the fleet to fly over (victory). */
  owner?: Player
  /** `PlacedShip.uid` of the sinking ship (sink events). */
  uid?: string
  fleets: Fleets
  beat: BeatName | null
  /** The shot's fire → whistle → impact audio timeline, cancelled if the shot is skipped before it lands. */
  audio?: { cancel(): void } | null
  /** Set while the player stands on deck: the camera is left alone and beats emit `deckBus` events instead. */
  pov: PovContext | null
}

export interface DirectorState {
  active: ActiveCinematic | null
  busy: boolean
  /** Guns recoiling right now — pass straight to `<Fleet firing>` of the firing fleet. */
  firing: Partial<Record<string, CannonRef[]>>
  /** Sink progress of the ship currently going down — pass to `<Fleet sinkProgress>` of its fleet. */
  /** Keyed by `PlacedShip.uid` (BUG-361 / Black Flag: a fleet may repeat a class). */
  sinkProgress: Partial<Record<string, number>>
  /** True once the current shot's ball has (or would have) landed; UI reveals markers/damage then. */
  impacted: boolean
  /** Playback rate for VFX (0.4 inside the sink's slow-mo). */
  timeScale: number
  /** Impulse in metres for the camera shake; CinematicCamera decays it. */
  shake: number
  /** Letterbox bars visible. */
  letterbox: boolean
  /** Monotonic counter of finished sequences (for UI and tests). */
  completed: number
  /**
   * Whose side the camera films from: the overview / return shots and the victory orbit use this board's side. Always
   * `human` in single player; a hot-seat game sets it to the active captain (`setPerspective`).
   */
  perspective: Player
}

export interface DirectorOptions {
  /** Where the fleets live; defaults to the game store's boards. */
  fleets?: () => Fleets
  /** Reduced-motion flag; defaults to the game store's setting. */
  reducedMotion?: () => boolean
  /** VFX budget tier; defaults to the scene's quality (`?quality=low` → `low`): one ball per shot, no shake / slow-mo. */
  budget?: () => Budget
  /** Drive the clock from requestAnimationFrame (default). Tests set false and call `tick()`. */
  autoTick?: boolean
  /** Fire SFX / duck music on beats (default true when a DOM exists). */
  audio?: boolean
  /** The "On deck" slice; defaults to `useGameStore().deck` (or `DEFAULT_DECK` until it exists). */
  deck?: () => DeckState
}

export interface Director extends CinematicDirector {
  store: StoreApi<DirectorState>
  /** Advance the clock by `dt` seconds (called by the ticker; tests call it directly). */
  tick(dt: number): void
  /** The sequence currently playing, if any. */
  readonly active: ActiveCinematic | null
  /** Point the director at other fleets than the game store's (demos, tests); `null` restores the default. */
  setFleets(source: (() => Fleets) | null): void
  /** Film from this side of the table (hot-seat: the active captain). */
  setPerspective(side: Player): void
}

const gameFleets = (): Fleets => {
  const s = useGameStore.getState()
  return { human: s.playerBoard.ships, enemy: s.enemyBoard.ships }
}

const SHAKE: Record<string, number> = { miss: 0.05, hit: 0.16, sunk: 0.22, lost: 0.03 }

export function createDirector(opts: DirectorOptions = {}): Director {
  const defaultFleets = opts.fleets ?? gameFleets
  let fleetsOf = defaultFleets
  const reducedMotionOf = opts.reducedMotion ?? (() => useGameStore.getState().settings.reducedMotion)
  const budgetOf = opts.budget ?? (() => (defaultQuality() === 'low' ? 'low' : 'high'))
  const beatScratch: BeatState = { beat: null, k: 1, index: -1 }
  const autoTick = opts.autoTick ?? true
  const audio = opts.audio ?? typeof document !== 'undefined'
  const deckOf = opts.deck ?? readDeckState
  const store = createStore<DirectorState>(() => ({
    active: null,
    busy: false,
    firing: {},
    sinkProgress: {},
    impacted: false,
    timeScale: 1,
    shake: 0,
    letterbox: false,
    completed: 0,
    perspective: 'human',
  }))
  let nextId = 1
  let pending: { resolve: () => void } | null = null
  let raf = 0
  let last = 0

  const stopTicker = () => {
    if (raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf)
    raf = 0
  }
  const startTicker = () => {
    if (!autoTick || raf || typeof requestAnimationFrame === 'undefined') return
    last = performance.now()
    const loop = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      director.tick(dt)
      raf = store.getState().active ? requestAnimationFrame(loop) : 0
    }
    raf = requestAnimationFrame(loop)
  }

  /** Where the player on deck should look for this beat (impact point, sinking ship, fireworks). */
  const povTarget = (a: ActiveCinematic): Vec3 | null => {
    if (a.event.type === 'shot') return a.plan?.impact ?? null
    if (a.event.type === 'sink') {
      const ship = a.fleets[a.event.owner].find((s) => s.uid === a.uid)
      return ship ? shipWorldPosition(ship, a.event.owner) : null
    }
    if (a.event.type === 'victory') {
      const o = ownBoardOrigin(store.getState().perspective)
      return [o[0] + 5, o[1] + 6, o[2] + 5]
    }
    return null
  }

  /** Where the on-deck listener hears this sequence from (own gun, impact point, sinking ship). */
  const povAudio = (a: ActiveCinematic) => {
    if (!a.pov) return undefined
    const at = povTarget(a) ?? a.plan?.cellCenter ?? ownBoardOrigin(a.pov.perspective)
    return { outgoing: a.pov.outgoing, standingHit: a.pov.standingHit, nearby: a.pov.ownSide, from: a.plan?.muzzles[0]?.position, at }
  }

  const abandonShip = (a: ActiveCinematic) => {
    if (!a.pov || a.pov.abandoned || a.event.type !== 'sink' || !a.pov.standingHit || !a.uid) return
    a.pov.abandoned = true
    deckBus.emit({ type: 'abandon-ship', nextUid: nextAfloatUid(a.fleets[a.pov.perspective], a.uid) })
  }

  /** Hand the camera back to the deck controller (no-op when the director never borrowed it). */
  const releaseCamera = () => {
    if (deckCameraLease.owner !== 'director') return
    deckCameraLease.owner = 'deck'
    deckBus.emit({ type: 'camera', owner: 'deck' })
  }

  const finish = () => {
    const { active } = store.getState()
    if (!active) return
    abandonShip(active)
    releaseCamera()
    if (active.event.type === 'sink' && active.clock.skipped) active.audio?.cancel()
    const settled: Partial<DirectorState> = { active: null, busy: false, firing: {}, impacted: false, timeScale: 1, letterbox: false, completed: store.getState().completed + 1 }
    if (active.event.type === 'sink') settled.sinkProgress = { ...store.getState().sinkProgress, [active.event.uid ?? active.event.shipId]: 1 }
    store.setState(settled)
    stopTicker()
    const p = pending
    pending = null
    p?.resolve()
  }

  /** Milliseconds from the fire beat to the impact beat of a shot sequence (the audio whistle length). */
  const shotFlightMs = (seq: Sequence): number | undefined => {
    const fire = seq.beats.find((b) => b.name === 'fire')
    const impact = seq.beats.find((b) => b.name === 'impact')
    return fire && impact ? Math.max(150, Math.round((impact.start - fire.start) * 1000)) : undefined
  }

  const enterBeat = (a: ActiveCinematic, beat: BeatName | null) => {
    a.beat = beat
    const patch: Partial<DirectorState> = {}
    if (a.event.type === 'shot' && a.plan) {
      const { plan } = a
      if (beat === 'fire') {
        if (plan.battery) patch.firing = { [plan.battery.uid]: plan.battery.cells.map((cell) => ({ cell, side: plan.battery!.side })) }
        // one audio timeline per shot, its impact cue timed to land with the ball (fire beat → impact beat)
        if (audio) a.audio = playCinematicAudio(a.event, { flightMs: shotFlightMs(a.seq), fast: a.seq.level !== 'full', pov: povAudio(a) })
      }
      if (beat === 'impact' || beat === 'return') {
        if (!store.getState().impacted) {
          patch.impacted = true
          // a killing blow reveals the ship afloat; its `sink` sequence then takes the progress 0 → 1
          if (plan.result.outcome === 'sunk' && plan.result.shipId) patch.sinkProgress = { ...store.getState().sinkProgress, [plan.result.shipUid ?? plan.result.shipId]: 0 }
          if (allowShake(a.seq) && !a.pov) patch.shake = SHAKE[plan.result.outcome] ?? 0.1
          if (audio && (beat === 'return' || a.clock.skipped)) {
            // skipped before the ball landed: drop the scheduled cues and land the impact now
            a.audio?.cancel()
            a.audio = null
            playSfx(plan.result.outcome === 'lost' ? 'thunder' : plan.result.outcome === 'miss' ? 'miss' : plan.result.outcome === 'sunk' ? 'sunk' : 'hit')
          }
        }
        if (beat === 'return') patch.firing = {}
      }
    }
    if (a.event.type === 'sink' && beat === 'sink' && audio) {
      // the killing shot's timeline already played mast snap → groan → bubbles; just keep the music down
      if (a.pov) a.audio = playCinematicAudio(a.event, { fast: a.seq.level !== 'full', pov: povAudio(a) })
      else duckMusic(a.seq.duration * 1000)
    }
    if (a.event.type === 'victory' && beat === 'flyover' && audio) playSfx(a.event.winner === 'human' ? 'victory' : 'defeat')
    if (a.pov) {
      const ob = a.pov.overboard
      if (beat === 'overboard' && ob) {
        deckBus.emit({ type: 'thrown-overboard', nextUid: ob.nextUid, cell: ob.cell, point: ob.point, seconds: a.seq.beats.find((b) => b.name === 'overboard')?.duration })
        if (audio) {
          playSfxAt('splash-miss', ob.splashAt, { gain: 1.5, noDuck: true })
          setTimeout(() => playSfxAt('bubbles', ob.splashAt, { gain: 0.9, noDuck: true }), 350)
          setTimeout(() => playSfxAt('water-rush', ob.splashAt, { gain: 1, noDuck: true }), 550)
        }
      }
      for (const e of povBeatEvents(a.event, a.pov, beat, povTarget(a), a.seq.reducedMotion)) deckBus.emit(e)
      if (a.event.type === 'battle-start' && beat === 'flyover' && audio) playSfx('horn')
    }
    if (Object.keys(patch).length) store.setState(patch)
  }

  const director: Director = {
    store,
    get busy() {
      return store.getState().busy
    },
    get active() {
      return store.getState().active
    },
    setPerspective(side) {
      if (store.getState().perspective !== side) store.setState({ perspective: side })
    },
    setFleets(source) {
      fleetsOf = source ?? defaultFleets
    },
    play(event, level) {
      // one sequence at a time: a new play() skips whatever is still running
      if (store.getState().active) {
        director.skip()
        finish()
      }
      const fleets = fleetsOf()
      const pov = povFor(event, deckOf(), fleets, store.getState().perspective)
      // the ball took the section the player stands on → the thrown-overboard beat extends the shot
      const overboard = pov ? overboardFor(pov, event, fleets[pov.perspective], playerEye(pov)) : null
      if (pov && overboard) pov.overboard = overboard
      const seq = buildSequence(event, level, reducedMotionOf(), budgetOf(), pov !== null, overboard !== null)
      if (pov && event.type === 'sink') {
        if (pov.standingHit) pov.abandonAt = abandonAtFor(pov, seq)
        else if (pov.ownSide) {
          // another own ship goes down: hold the look on it, or borrow the camera when the standing ship's own rigging hides it
          const ship = fleets[event.owner].find((s) => s.uid === (event.uid ?? event.shipId))
          pov.sinkTarget = ship ? shipWorldPosition(ship, event.owner) : null
          pov.sinkView = pov.sinkTarget ? sinkViewFor(pov, pov.sinkTarget, playerEye(pov)) : 'look'
        }
      }
      // on deck a manned gun fires the shot; otherwise (and for Broadside's explicit battery) the usual pick
      const battery = event.type === 'shot' ? event.battery ?? stationBattery(pov) ?? undefined : undefined
      const plan =
        event.type === 'shot'
          ? planShot(event.by, event.result, event.by === 'human' ? fleets.human : fleets.enemy, event.by === 'human' ? fleets.enemy : fleets.human, battery, maxBalls(seq))
          : null
      if (plan && event.type === 'shot' && battery && !event.battery) {
        const m = stationMuzzle(pov, plan.shooter)
        if (m) plan.muzzles = [m]
      }
      const active: ActiveCinematic = {
        id: nextId++,
        event,
        seq,
        clock: createSequenceClock(seq),
        plan,
        fleets,
        beat: null,
        owner: event.type === 'sink' ? event.owner : event.type === 'victory' ? event.winner : undefined,
        uid: event.type === 'sink' ? event.uid ?? event.shipId : undefined,
        pov,
      }
      if (seq.duration === 0) {
        // `off`: apply the end state synchronously and resolve
        store.setState({ active, busy: true })
        if (event.type === 'shot') enterBeat(active, 'return')
        abandonShip(active)
        if (overboard) {
          deckBus.emit({ type: 'thrown-overboard', nextUid: overboard.nextUid, cell: overboard.cell, point: overboard.point, seconds: 0 })
        }
        store.setState({ active: null, busy: false, firing: {}, impacted: false, shake: 0, letterbox: false, completed: store.getState().completed + 1, ...(event.type === 'sink' ? { sinkProgress: { ...store.getState().sinkProgress, [event.uid ?? event.shipId]: 1 } } : {}) })
        return Promise.resolve()
      }
      // on deck the director borrows the camera for shots (follow-cam / overboard) and for an own ship sinking out of sight
      // behind the standing ship's rigging; other sinks, horns and victories leave it with the deck
      const borrow = !!active.pov && (event.type === 'shot' || active.pov.sinkView === 'borrow')
      if (borrow) {
        active.pov!.cameraBorrowed = true
        deckCameraLease.owner = 'director'
        deckBus.emit({ type: 'camera', owner: 'director' })
      }
      store.setState({ active, busy: true, impacted: false, firing: {}, letterbox: !active.pov || borrow, timeScale: 1, sinkProgress: event.type === 'sink' ? { ...store.getState().sinkProgress, [event.uid ?? event.shipId]: 0 } : store.getState().sinkProgress })
      enterBeat(active, beatAt(seq, 0, beatScratch).beat?.name ?? null)
      startTicker()
      return new Promise<void>((resolve) => {
        pending = { resolve }
      })
    },
    skip() {
      const { active } = store.getState()
      if (!active) return
      active.clock.skip()
      if (!autoTick || typeof requestAnimationFrame === 'undefined') director.tick(0)
    },
    tick(dt) {
      const { active } = store.getState()
      if (!active) return
      const { clock, seq } = active
      const finished = clock.advance(dt)
      const { beat } = beatAt(seq, clock.t, beatScratch)
      const name = beat?.name ?? null
      if (name !== active.beat) enterBeat(active, name)
      if (active.pov) {
        if (active.pov.standingHit && clock.t >= (active.pov.abandonAt ?? POV.abandonAt)) abandonShip(active)
        // another own ship sinking in view: keep the look on it for the whole sink beat
        const hold = sinkHoldLook(active.event, active.pov, name, active.pov.sinkTarget ?? null, seq.reducedMotion)
        if (hold) deckBus.emit(hold)
      }
      if (seq.sink && active.uid) {
        const p = sinkProgressAt(clock.t, seq.sink)
        const ts = timeScaleAt(seq, clock.t)
        const s = store.getState()
        // ≤ 100 updates per sink so <Fleet> is not re-rendered every frame
        if (Math.abs((s.sinkProgress[active.uid] ?? -1) - p) > 0.01 || p === 1 || s.timeScale !== ts) store.setState({ sinkProgress: { ...s.sinkProgress, [active.uid]: p }, timeScale: ts })
      }
      if (finished) finish()
    },
  }
  return director
}

/** The app-wide director. `CinematicLayer`, `CinematicCamera` and `useBattleCinematics` all use it by default. */
export const director: Director = createDirector()

/** React hook over the shared director's state: `useDirector((s) => s.busy)`. */
export function useDirector<T>(selector: (s: DirectorState) => T): T {
  return useStore(director.store, selector)
}

export type { CinematicsLevel }
