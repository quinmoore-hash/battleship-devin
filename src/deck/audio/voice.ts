/** Crew voice lines: which cue plays for which beat, rate-limited so the crew never talks over itself (pure). */
import type { CanonicalSfx } from '../../audio/manifest'

/** Minimum gap between two voice lines. */
export const VOICE_GAP_MS = 4000

export type VoiceCue =
  | 'crew-call'
  | 'gun-call-run-out'
  | 'gun-call-fire'
  | 'crew-cheer'
  | 'crew-groan'
  | 'crew-brace'
  | 'crew-panic'

/**
 * Spoken lines share one throat: at most one per `gapMs` (4 s). The gun captain's "Fire!" and the urgent "Brace!" /
 * panic may cut in after a fraction of the gap (a "Run out the gun!" → "Fire!" sequence is the point of the gun crew),
 * the random chatter never does. Cheer / groan are crowd reactions, not lines: their own, shorter guard.
 */
const LINE_GAP_FRACTION: Record<VoiceCue, number> = {
  'crew-call': 1,
  'gun-call-run-out': 0.5,
  'gun-call-fire': 0.25,
  'crew-brace': 0.5,
  'crew-panic': 0.25,
  'crew-cheer': 0,
  'crew-groan': 0,
}
const CROWD: ReadonlySet<VoiceCue> = new Set(['crew-cheer', 'crew-groan'])
/** Minimum gap between two crowd reactions. */
export const CROWD_GAP_MS = 2000

export interface VoiceLimiter {
  /** Returns true (and records the line) if `cue` may play at time `nowMs`. */
  request(cue: VoiceCue, nowMs: number): boolean
  reset(): void
}

export function createVoiceLimiter(gapMs = VOICE_GAP_MS, crowdGapMs = CROWD_GAP_MS): VoiceLimiter {
  let lastLine = -Infinity
  let lastCrowd = -Infinity
  return {
    request(cue, nowMs) {
      if (CROWD.has(cue)) {
        if (nowMs - lastCrowd < crowdGapMs) return false
        lastCrowd = nowMs
        return true
      }
      if (nowMs - lastLine < gapMs * LINE_GAP_FRACTION[cue]) return false
      lastLine = nowMs
      return true
    },
    reset() {
      lastLine = -Infinity
      lastCrowd = -Infinity
    },
  }
}

export const VOICE_SFX: Record<VoiceCue, CanonicalSfx> = {
  'crew-call': 'crew-call',
  'gun-call-run-out': 'gun-call-run-out',
  'gun-call-fire': 'gun-call-fire',
  'crew-cheer': 'crew-cheer',
  'crew-groan': 'crew-groan',
  'crew-brace': 'crew-brace',
  'crew-panic': 'crew-panic',
}

/** The one crew throat: all of DeckAudio's lines share this limiter. */
export const crewVoice: VoiceLimiter = createVoiceLimiter()
