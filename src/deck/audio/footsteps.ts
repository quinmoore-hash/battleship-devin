/** Footsteps on the planks, driven by actual walk distance (pure; `DeckAudio` feeds it camera deltas). */

/** World units walked between two boot falls. */
export const STEP_DISTANCE = 0.22
/** A frame delta larger than this is a teleport (ship switch, respawn), not a walk. */
export const TELEPORT_DISTANCE = 1.5

export interface Step {
  /** 0..1 — louder when running (per-frame speed above the walk pace). */
  gain: number
  /** Running steps are a touch brighter. */
  rate: number
}

export interface Footsteps {
  /** Feed a horizontal movement delta (world units) and the frame time; returns the steps that fell this frame. */
  advance(distance: number, dt: number, running?: boolean): Step[]
  /** Reset the stride (teleport, deck off). */
  reset(): void
}

export function footstepGain(running: boolean): number {
  return running ? 1 : 0.65
}

export function createFootsteps(stepDistance = STEP_DISTANCE): Footsteps {
  let acc = 0
  return {
    advance(distance, _dt, running = false) {
      if (!(distance > 0) || distance >= TELEPORT_DISTANCE) {
        if (distance >= TELEPORT_DISTANCE) acc = 0
        return []
      }
      acc += distance
      const steps: Step[] = []
      while (acc >= stepDistance && steps.length < 4) {
        acc -= stepDistance
        steps.push({ gain: footstepGain(running), rate: running ? 1.08 : 1 })
      }
      return steps
    },
    reset() {
      acc = 0
    },
  }
}
