/**
 * Crew animation: a tiny keyframe table sampled on the CPU every frame (no skeleton library, no allocations).
 * A `Pose` is a handful of joint angles (radians) plus a crouch / lift offset; `samplePose` lerps between the
 * keyframes of a clip into a caller-owned `Pose`, so the per-frame cost is a few dozen multiplies per figure.
 */

export interface Pose {
  /** Torso lean forward (+) about the figure's side axis. */
  lean: number
  /** Torso lean sideways (+ = toward the figure's right). */
  roll: number
  /** Torso twist about the vertical axis. */
  twist: number
  /** Head pitch (+ looks down). */
  head: number
  /** Shoulder pitch, + = arm forward/up. */
  armL: number
  armR: number
  /** Shoulder abduction, + = arm out to the side. */
  armLOut: number
  armROut: number
  /** Hip pitch, + = leg forward. */
  legL: number
  legR: number
  /** 0 standing … 1 fully crouched (drops the body and bends the knees). */
  crouch: number
  /** Vertical offset of the whole figure (jumps). */
  lift: number
}

export const POSE_KEYS = ['lean', 'roll', 'twist', 'head', 'armL', 'armR', 'armLOut', 'armROut', 'legL', 'legR', 'crouch', 'lift'] as const satisfies readonly (keyof Pose)[]

export const REST: Readonly<Pose> = { lean: 0, roll: 0, twist: 0, head: 0, armL: 0, armR: 0, armLOut: 0.08, armROut: 0.08, legL: 0, legR: 0, crouch: 0, lift: 0 }

export const makePose = (): Pose => ({ ...REST })

export type AnimName = 'idle' | 'haul' | 'lookout' | 'swab' | 'gunner' | 'stumble' | 'shuffle' | 'fall' | 'swim' | 'jump'

export interface Keyframe {
  /** Seconds into the clip (ascending, first at 0). */
  t: number
  pose: Partial<Pose>
}

export interface Clip {
  duration: number
  loop: boolean
  frames: Keyframe[]
}

const k = (t: number, pose: Partial<Pose>): Keyframe => ({ t, pose })

/** The keyframe table. Looping clips end where they start so the wrap is seamless. */
export const CLIPS: Record<AnimName, Clip> = {
  idle: {
    duration: 3.2,
    loop: true,
    frames: [k(0, { lean: 0.02, roll: 0.02, armLOut: 0.08, armROut: 0.08 }), k(1.6, { lean: 0.05, roll: -0.03, head: 0.04, armLOut: 0.1, armROut: 0.06 }), k(3.2, { lean: 0.02, roll: 0.02, armLOut: 0.08, armROut: 0.08 })],
  },
  haul: {
    duration: 1.4,
    loop: true,
    frames: [
      k(0, { lean: 0.35, armL: 1.3, armR: 1.1, legL: 0.25, legR: -0.25, head: 0.2 }),
      k(0.7, { lean: -0.15, armL: 0.5, armR: 0.3, legL: 0.1, legR: -0.1, head: -0.1 }),
      k(1.4, { lean: 0.35, armL: 1.3, armR: 1.1, legL: 0.25, legR: -0.25, head: 0.2 }),
    ],
  },
  lookout: {
    duration: 4,
    loop: true,
    frames: [k(0, { armR: 1.9, armROut: 0.2, head: -0.25, twist: -0.3 }), k(2, { armR: 1.9, armROut: 0.25, head: -0.3, twist: 0.3 }), k(4, { armR: 1.9, armROut: 0.2, head: -0.25, twist: -0.3 })],
  },
  swab: {
    duration: 1.2,
    loop: true,
    frames: [
      k(0, { lean: 0.5, armL: 0.9, armR: 0.9, twist: -0.35, head: 0.5, crouch: 0.15 }),
      k(0.6, { lean: 0.55, armL: 1.1, armR: 1.1, twist: 0.35, head: 0.5, crouch: 0.2 }),
      k(1.2, { lean: 0.5, armL: 0.9, armR: 0.9, twist: -0.35, head: 0.5, crouch: 0.15 }),
    ],
  },
  gunner: {
    duration: 2.6,
    loop: true,
    frames: [
      k(0, { crouch: 0.45, lean: 0.3, armL: 0.9, armR: 0.9, legL: 0.5, legR: -0.2, head: 0.15 }),
      k(1.3, { crouch: 0.25, lean: 0.5, armL: 1.3, armR: 1.3, legL: 0.6, legR: -0.3, head: 0.3 }),
      k(2.6, { crouch: 0.45, lean: 0.3, armL: 0.9, armR: 0.9, legL: 0.5, legR: -0.2, head: 0.15 }),
    ],
  },
  stumble: {
    duration: 1.5,
    loop: false,
    frames: [
      k(0, { lean: -0.3, roll: 0.3, armL: 1.2, armR: 1.4, armLOut: 0.8, armROut: 0.9, legL: -0.3, legR: 0.4 }),
      k(0.35, { lean: 0.4, roll: -0.2, armL: 0.4, armR: 0.6, armLOut: 0.5, armROut: 0.4, legL: 0.3, legR: -0.1, crouch: 0.5 }),
      k(0.8, { lean: 0.5, roll: 0, armL: 0.2, armR: 0.2, armLOut: 0.2, armROut: 0.2, crouch: 0.75, head: 0.4 }),
      k(1.5, { lean: 0.05, crouch: 0, armLOut: 0.08, armROut: 0.08 }),
    ],
  },
  shuffle: {
    duration: 0.6,
    loop: true,
    frames: [k(0, { legL: 0.3, legR: -0.3, armL: -0.2, armR: 0.2, lean: 0.08 }), k(0.3, { legL: -0.3, legR: 0.3, armL: 0.2, armR: -0.2, lean: 0.08 }), k(0.6, { legL: 0.3, legR: -0.3, armL: -0.2, armR: 0.2, lean: 0.08 })],
  },
  jump: {
    duration: 0.5,
    loop: false,
    frames: [k(0, { crouch: 0.6, lean: 0.3, armL: -0.6, armR: -0.6 }), k(0.25, { crouch: 0, lean: -0.1, armL: 2.2, armR: 2.2, armLOut: 0.4, armROut: 0.4, legL: 0.4, legR: 0.4 }), k(0.5, { lean: 0.2, armL: 2.4, armR: 2.4, armLOut: 0.6, armROut: 0.6, legL: 0.5, legR: -0.2 })],
  },
  fall: {
    duration: 0.8,
    loop: true,
    frames: [
      k(0, { armL: 2.4, armR: 2.6, armLOut: 0.7, armROut: 0.9, legL: 0.6, legR: -0.4, lean: 0.3 }),
      k(0.4, { armL: 1.8, armR: 2.9, armLOut: 1.0, armROut: 0.5, legL: -0.3, legR: 0.7, lean: -0.2 }),
      k(0.8, { armL: 2.4, armR: 2.6, armLOut: 0.7, armROut: 0.9, legL: 0.6, legR: -0.4, lean: 0.3 }),
    ],
  },
  swim: {
    duration: 1.6,
    loop: true,
    frames: [
      k(0, { lean: 1.35, head: -1.0, armL: 2.6, armR: 0.4, armLOut: 0.4, armROut: 0.4, legL: 0.3, legR: -0.3, crouch: 0.9 }),
      k(0.8, { lean: 1.35, head: -1.0, armL: 0.4, armR: 2.6, armLOut: 0.4, armROut: 0.4, legL: -0.3, legR: 0.3, crouch: 0.9 }),
      k(1.6, { lean: 1.35, head: -1.0, armL: 2.6, armR: 0.4, armLOut: 0.4, armROut: 0.4, legL: 0.3, legR: -0.3, crouch: 0.9 }),
    ],
  },
}

const smooth = (t: number): number => t * t * (3 - 2 * t)

/**
 * Sample `clip` at `time` seconds into `out` (no allocation). Looping clips wrap; one-shots hold their last frame.
 * Keys a frame leaves out take the rest pose, so clips only list what they move.
 */
export function samplePose(clip: Clip, time: number, out: Pose): Pose {
  const { frames, duration, loop } = clip
  let t = time
  if (loop) {
    t = duration > 0 ? time % duration : 0
    if (t < 0) t += duration
  } else t = Math.min(Math.max(time, 0), duration)
  let i = 0
  while (i < frames.length - 1 && frames[i + 1].t <= t) i++
  const a = frames[i]
  const b = frames[Math.min(i + 1, frames.length - 1)]
  const span = b.t - a.t
  const f = span > 0 ? smooth((t - a.t) / span) : 0
  for (const key of POSE_KEYS) {
    const va = a.pose[key] ?? REST[key]
    const vb = b.pose[key] ?? REST[key]
    out[key] = va + (vb - va) * f
  }
  return out
}

/** Blend `from` toward `to` in place by `w` (0 = from, 1 = to): used for the short cross-fade when a clip changes. */
export function blendPose(from: Pose, to: Pose, w: number, out: Pose): Pose {
  for (const key of POSE_KEYS) out[key] = from[key] + (to[key] - from[key]) * w
  return out
}

/** Has a one-shot clip finished at `time`? */
export const clipDone = (clip: Clip, time: number): boolean => !clip.loop && time >= clip.duration
