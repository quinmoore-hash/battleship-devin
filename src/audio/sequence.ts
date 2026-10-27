/**
 * Timelines for multi-sound moments (a cannon shot, a ship going down). Pure data so the cue timing is
 * unit-tested and shared between `bindGameAudio` and the "fire a broadside" demo.
 */
import type { CanonicalSfx } from './manifest'
import type { Vec3 } from './spatial'

export type ShotOutcome = 'hit' | 'miss' | 'sunk' | 'lost'

export interface AudioCue {
  /** ms after the shot is fired */
  at: number
  sfx: CanonicalSfx
  /** World position for `playSfxAt`; omitted = non-spatial (crew, UI). */
  at3d?: Vec3
  /** Relative gain tweak for this cue (default 1). */
  gain?: number
}

export interface ShotTimingOptions {
  /** ms the cannonball is in the air; defaults to the cinematic's full/fast flight time. */
  flightMs?: number
  /** Reduced-motion / fast cinematics: tighter spacing, no lingering follow-ups. */
  fast?: boolean
  /** Where the gun is (shooter's fleet). */
  from?: Vec3
  /** Where the ball lands (target cell). */
  to?: Vec3
  /** Shot fired by the player: the crew cheers on a sink. */
  byPlayer?: boolean
}

/** Ball flight time matching src/cinematics `SHOT` timings (full 4.5 s / fast 1.6 s): impact lands at ~40%. */
export const SHOT_FLIGHT_MS = { full: 1800, fast: 650 } as const

/**
 * fire → whistle → (splash | wood + splinters [+ mast snap → groan → bubbles → cheer]).
 * `lost` (stormy seas): fire → whistle → a thunderclap swallows the shot, with only a faint far splash.
 * All offsets are relative to the muzzle flash so the caller can align `at: 0` with the visual.
 */
export function shotTimeline(outcome: ShotOutcome, options: ShotTimingOptions = {}): AudioCue[] {
  const fast = options.fast ?? false
  const flight = options.flightMs ?? (fast ? SHOT_FLIGHT_MS.fast : SHOT_FLIGHT_MS.full)
  const { from, to } = options
  const cues: AudioCue[] = [{ at: 0, sfx: 'cannon-fire', at3d: from }]
  if (flight > 400) cues.push({ at: Math.min(180, flight * 0.15), sfx: 'cannon-whistle', at3d: to })
  if (outcome === 'miss') {
    cues.push({ at: flight, sfx: 'splash-miss', at3d: to })
    return cues
  }
  if (outcome === 'lost') {
    cues.push({ at: Math.max(0, flight - 120), sfx: 'thunder', gain: 0.8 })
    cues.push({ at: flight, sfx: 'splash-miss', at3d: to, gain: 0.3 })
    return cues
  }
  cues.push({ at: flight, sfx: 'impact-wood', at3d: to })
  cues.push({ at: flight + (fast ? 120 : 260), sfx: 'crew-shout-hit', gain: 0.8 })
  if (outcome === 'sunk') {
    const k = fast ? 0.45 : 1
    cues.push({ at: flight + 350 * k, sfx: 'mast-snap', at3d: to })
    cues.push({ at: flight + 900 * k, sfx: 'sinking-groan', at3d: to })
    cues.push({ at: flight + 1500 * k, sfx: 'bubbles', at3d: to, gain: 0.7 })
    if (options.byPlayer) cues.push({ at: flight + 1900 * k, sfx: 'crew-cheer' })
  }
  return cues
}

/** Total length of a timeline in ms (last cue start) — handy for scheduling follow-ups. */
export function timelineLength(cues: readonly AudioCue[]): number {
  return cues.reduce((m, c) => Math.max(m, c.at), 0)
}

export interface BroadsideOptions extends ShotTimingOptions {
  /** Number of guns in the broadside. */
  guns?: number
  /** Gap between guns (ms); jittered deterministically. */
  spacingMs?: number
  /** Outcome per gun; cycles if shorter than `guns`. */
  outcomes?: readonly ShotOutcome[]
  /** Muzzle positions per gun (cycles). */
  gunPositions?: readonly Vec3[]
  /** Landing positions per gun (cycles). */
  targetPositions?: readonly Vec3[]
}

/** A rolling broadside: several `shotTimeline`s staggered along the gun deck. Deterministic. */
export function broadsideTimeline(options: BroadsideOptions = {}): AudioCue[] {
  const guns = options.guns ?? 5
  const spacing = options.spacingMs ?? 180
  const outcomes = options.outcomes ?? ['miss', 'hit', 'miss', 'hit', 'sunk']
  const cues: AudioCue[] = []
  for (let g = 0; g < guns; g++) {
    const jitter = ((g * 7919) % 97) / 97 - 0.5 // -0.5..0.5, deterministic
    const start = Math.round(g * spacing * (1 + jitter * 0.4))
    const shot = shotTimeline(outcomes[g % outcomes.length], {
      ...options,
      from: options.gunPositions?.[g % options.gunPositions.length] ?? options.from,
      to: options.targetPositions?.[g % options.targetPositions.length] ?? options.to,
    })
    for (const c of shot) cues.push({ ...c, at: c.at + start })
  }
  return cues.sort((a, b) => a.at - b.at)
}
