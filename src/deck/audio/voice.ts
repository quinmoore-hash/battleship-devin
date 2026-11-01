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
  | 'land-ho'

/** Urgent lines may interrupt the gap once it is mostly elapsed; the random chatter never does. */
const PRIORITY: Record<VoiceCue, number> = {
  'crew-call': 0,
  'gun-call-run-out': 1,
  'gun-call-fire': 2,
  'crew-cheer': 1,
  'crew-groan': 1,
  'crew-brace': 2,
  'crew-panic': 3,
  'land-ho': 2,
}

export interface VoiceLimiter {
  /** Returns true (and records the line) if `cue` may play at time `nowMs`. */
  request(cue: VoiceCue, nowMs: number): boolean
  reset(): void
}

export function createVoiceLimiter(gapMs = VOICE_GAP_MS): VoiceLimiter {
  let last = -Infinity
  return {
    request(cue, nowMs) {
      const since = nowMs - last
      // panic/brace may cut in after half the gap; everything else waits the full gap
      const need = PRIORITY[cue] >= 2 ? gapMs * 0.5 : gapMs
      if (since < need) return false
      last = nowMs
      return true
    },
    reset() {
      last = -Infinity
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
  'land-ho': 'land-ho',
}

/** The one crew throat: DeckAudio's lines and the Spyglass "Land ho!" share this limiter. */
export const crewVoice: VoiceLimiter = createVoiceLimiter()
