/**
 * "On deck" sound cues. Pure timelines (`deckShotTimeline`, `deckSinkTimeline`) the director plays through
 * `playCinematicAudio(event, { pov })`, plus the loops that live while the player stands on deck
 * (`createDeckLoops`: fire crackle on a burning standing ship; the deck's creak / rope ambience lives in src/deck/audio). Everything goes
 * through `playSfx` / `playSfxAt`, so the SFX bus volume and mute apply.
 */
import type { AudioCue, ShotOutcome } from './sequence'
import type { Vec3 } from './spatial'

export interface DeckShotAudio {
  /** Fired from the deck the player stands on (your own gun, loud and close). */
  outgoing: boolean
  /** The ball hits the ship the player stands on. */
  standingHit: boolean
  /** Your own ball landing / a ball splashing on your waters (vs. the far board). */
  nearby: boolean
  from?: Vec3
  to: Vec3
  flightMs: number
  fast: boolean
}

/** "Boom … whistle" lead before an incoming ball lands, so the player has time to look (0.5–0.8 s). */
export const INCOMING_LEAD_MS = { full: 700, fast: 500 } as const
/** Gain of your own gun next to your ear vs. the overview's cannon. */
export const OWN_GUN_GAIN = 1.6
/** Gain of the enemy's guns heard across the water. */
export const DISTANT_GUN_GAIN = 0.55

export function deckShotTimeline(outcome: ShotOutcome, o: DeckShotAudio): AudioCue[] {
  const flight = Math.max(150, o.flightMs)
  const cues: AudioCue[] = []
  if (o.outgoing) {
    cues.push({ at: 0, sfx: 'cannon-fire', at3d: o.from, gain: OWN_GUN_GAIN })
    if (flight > 400) cues.push({ at: Math.min(180, flight * 0.15), sfx: 'cannon-whistle', at3d: o.to, gain: 0.7 })
  } else {
    cues.push({ at: 0, sfx: 'cannon-fire', at3d: o.from, gain: DISTANT_GUN_GAIN })
    // the whistle grows toward the player: it starts a lead before the impact and runs until the ball lands
    const lead = Math.min(o.fast ? INCOMING_LEAD_MS.fast : INCOMING_LEAD_MS.full, flight * 0.6)
    cues.push({ at: Math.max(0, flight - lead), sfx: 'cannon-whistle', at3d: o.to, gain: o.standingHit ? 1.2 : 0.9 })
  }
  const near = o.standingHit ? 1.5 : o.nearby ? 1.15 : 1
  if (outcome === 'miss') {
    cues.push({ at: flight, sfx: 'splash-miss', at3d: o.to, gain: near })
    return cues
  }
  if (outcome === 'lost') {
    cues.push({ at: Math.max(0, flight - 120), sfx: 'thunder', gain: 0.8 })
    cues.push({ at: flight, sfx: 'splash-miss', at3d: o.to, gain: 0.3 })
    return cues
  }
  cues.push({ at: flight, sfx: 'impact-wood', at3d: o.to, gain: near })
  if (o.standingHit) cues.push({ at: flight + 140, sfx: 'hull-creak', at3d: o.to, gain: 0.9 })
  cues.push({ at: flight + (o.fast ? 120 : 260), sfx: 'crew-shout-hit', gain: o.standingHit ? 1 : 0.8 })
  if (outcome === 'sunk') {
    const k = o.fast ? 0.45 : 1
    cues.push({ at: flight + 350 * k, sfx: 'mast-snap', at3d: o.to })
    cues.push({ at: flight + 900 * k, sfx: 'sinking-groan', at3d: o.to })
    cues.push({ at: flight + 1500 * k, sfx: 'bubbles', at3d: o.to, gain: 0.7 })
    if (o.outgoing) cues.push({ at: flight + 1900 * k, sfx: 'crew-cheer' })
  }
  return cues
}

/**
 * The sink heard from the deck. On the ship going down: timbers, water over the rail, the groan, bubbles and the
 * ship's bell as the crew abandons her; another ship: the overview's cues placed at that ship.
 */
export function deckSinkTimeline(standing: boolean, at: Vec3, byPlayer: boolean): AudioCue[] {
  if (standing)
    return [
      { at: 0, sfx: 'hull-creak', at3d: at, gain: 1.1 },
      { at: 200, sfx: 'water-rush', at3d: at, gain: 1.2 },
      { at: 500, sfx: 'sinking-groan', at3d: at, gain: 1.1 },
      { at: 900, sfx: 'bubbles', at3d: at, gain: 0.8 },
      { at: 1300, sfx: 'bell-victory', gain: 0.45 },
    ]
  return [
    { at: 0, sfx: 'mast-snap', at3d: at },
    { at: 500, sfx: 'sinking-groan', at3d: at },
    { at: 1200, sfx: 'bubbles', at3d: at, gain: 0.7 },
    ...(byPlayer ? [{ at: 1600, sfx: 'crew-cheer' as const }] : [{ at: 900, sfx: 'hull-creak' as const, at3d: at }]),
  ]
}

// ------------------------------------------------------------------ loops while on deck

export interface DeckLoopsState {
  on: boolean
  /** The standing ship has burning cells → fire crackle loop at `fireAt`. */
  burning: boolean
  fireAt: Vec3 | null
  /** Where creaks / rope sounds come from (the standing ship). */
  creakAt: Vec3 | null
}

export interface DeckLoops {
  update(state: DeckLoopsState): void
  stop(): void
}

interface LoopHandle {
  stop(fadeMs?: number): void
  setPosition(world: Vec3): void
}

export interface DeckLoopsDeps {
  playAt(name: 'fire-loop' | 'hull-creak' | 'sail-flap', at: Vec3, gain: number): LoopHandle
  setTimeout?: (fn: () => void, ms: number) => unknown
  clearTimeout?: (t: unknown) => void
  random?: () => number
}

/** Creak every 5–9 s, a sail flap every 9–15 s while on deck. */
/** Kept for API compatibility: ambience scheduling moved to the deck audio layer (#55). */
export const AMBIENCE_MS = { creak: [5000, 9000], flap: [9000, 15000] } as const

export function createDeckLoops(deps: DeckLoopsDeps): DeckLoops {
  const clearT = deps.clearTimeout ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>))
  let fire: LoopHandle | null = null
  let timers: unknown[] = []
  let current: DeckLoopsState = { on: false, burning: false, fireAt: null, creakAt: null }

  const stopAmbience = () => {
    for (const t of timers) clearT(t)
    timers = []
  }

  return {
    update(state) {
      const was = current
      current = state
      const wantFire = state.on && state.burning && state.fireAt !== null
      if (wantFire && !fire) fire = deps.playAt('fire-loop', state.fireAt!, 1.1)
      else if (wantFire && fire && state.fireAt !== was.fireAt) fire.setPosition(state.fireAt!)
      else if (!wantFire && fire) {
        fire.stop(400)
        fire = null
      }
      // creak / sail ambience is owned by the deck audio layer (src/deck/audio, #55); only the fire crackle is a cinematic loop
      if (!state.on && was.on) stopAmbience()
    },
    stop() {
      stopAmbience()
      fire?.stop(300)
      fire = null
      current = { on: false, burning: false, fireAt: null, creakAt: null }
    },
  }
}
