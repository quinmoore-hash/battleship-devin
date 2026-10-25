import type { ShotOutcome } from '../engine'
import type { Vec3 } from './layout'

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3)
export const easeInCubic = (t: number): number => Math.pow(clamp01(t), 3)
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2
export function easeOutBack(t: number): number {
  const x = clamp01(t)
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}
/** Exponential smoothing factor for frame-rate independent damping. */
export const damp = (current: number, target: number, speed: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-speed * dt))

// ---------------------------------------------------------------------------
// Ships
// ---------------------------------------------------------------------------

export interface BobPose {
  y: number
  roll: number
  pitch: number
}

/** Gentle floating motion. `phase` offsets ships so they don't move in lockstep. */
export function bobPose(t: number, phase: number, amplitude = 1): BobPose {
  return {
    y: Math.sin(t * 1.3 + phase) * 0.035 * amplitude,
    roll: Math.sin(t * 0.9 + phase * 1.7) * 0.045 * amplitude,
    pitch: Math.sin(t * 1.1 + phase * 0.6) * 0.025 * amplitude,
  }
}

export const SINK_DURATION = 3.4
export const SINK_DEPTH = -0.55
export const SINK_TILT = 0.5

export interface SinkPose {
  /** 0 = afloat, 1 = fully sunk (resting as a wreck). */
  progress: number
  depth: number
  tilt: number
  roll: number
  /** Whether bubbles should still be emitted. */
  bubbling: boolean
}

/** Pose of a sinking ship `elapsed` seconds after its last hit. */
export function sinkPose(elapsed: number): SinkPose {
  const progress = clamp01(elapsed / SINK_DURATION)
  const tiltT = easeInOutSine(clamp01(progress * 1.6))
  const depthT = easeInCubic(progress)
  return {
    progress,
    depth: SINK_DEPTH * depthT,
    tilt: SINK_TILT * tiltT,
    roll: 0.22 * easeInOutSine(progress),
    bubbling: elapsed >= 0 && progress < 1,
  }
}

// ---------------------------------------------------------------------------
// Shot markers
// ---------------------------------------------------------------------------

export interface MarkerTiming {
  /** Seconds the burst (splash / explosion) particles run. */
  burst: number
  /** Seconds after which the settled marker starts popping in. */
  settleStart: number
  /** Seconds the settle pop-in takes. */
  settle: number
  /** Radius multiplier for the shockwave ring. */
  ringScale: number
}

export const MARKER_TIMINGS: Record<ShotOutcome, MarkerTiming> = {
  miss: { burst: 1.1, settleStart: 0.45, settle: 0.6, ringScale: 1 },
  hit: { burst: 1.4, settleStart: 0.5, settle: 0.6, ringScale: 1.3 },
  sunk: { burst: 2.2, settleStart: 0.9, settle: 0.8, ringScale: 2.2 },
}

export interface MarkerPhase {
  /** 0..1 progress of the shockwave ring. */
  ring: number
  ringScale: number
  ringOpacity: number
  /** 0..1 flash intensity (hits only). */
  flash: number
  /** 0..1 scale of the settled marker. */
  settled: number
  /** True once every one-shot animation has finished. */
  done: boolean
}

export function markerPhase(outcome: ShotOutcome, elapsed: number): MarkerPhase {
  const tm = MARKER_TIMINGS[outcome]
  const ringDuration = 0.8 * tm.ringScale
  const ring = clamp01(elapsed / ringDuration)
  const flash = outcome === 'miss' ? 0 : 1 - clamp01(elapsed / 0.35)
  const settled = easeOutBack(clamp01((elapsed - tm.settleStart) / tm.settle))
  return {
    ring,
    ringScale: 0.2 + easeOutCubic(ring) * 1.1 * tm.ringScale,
    ringOpacity: (1 - ring) * 0.85,
    flash,
    settled,
    done: elapsed >= Math.max(tm.burst, ringDuration, tm.settleStart + tm.settle),
  }
}

/** Phase for a marker that was already on the board when the component mounted. */
export const settledMarkerPhase = (outcome: ShotOutcome): MarkerPhase => markerPhase(outcome, 1000)

// ---------------------------------------------------------------------------
// Projectile
// ---------------------------------------------------------------------------

export const PROJECTILE_DURATION = 0.95

/** Point on a parabolic arc from `from` to `to` at normalised time `t`, peaking `apex` above the chord. */
export function projectilePoint(from: Vec3, to: Vec3, t: number, apex = 3): Vec3 {
  const k = clamp01(t)
  return [
    lerp(from[0], to[0], k),
    lerp(from[1], to[1], k) + apex * 4 * k * (1 - k),
    lerp(from[2], to[2], k),
  ]
}

/** Default apex grows with distance so short lobs still look like lobs. */
export const projectileApex = (from: Vec3, to: Vec3): number => {
  const dx = to[0] - from[0]
  const dz = to[2] - from[2]
  return 1.5 + Math.sqrt(dx * dx + dz * dz) * 0.18
}

// ---------------------------------------------------------------------------
// Otter mascot
// ---------------------------------------------------------------------------

export type OtterMood = 'idle' | 'cheer' | 'grumble' | 'taunt' | 'victory' | 'defeat'

export const OTTER_MOODS: readonly OtterMood[] = ['idle', 'cheer', 'grumble', 'taunt', 'victory', 'defeat']

export interface OtterPose {
  /** Vertical bounce of the whole body. */
  bodyY: number
  /** Chest expansion 0..1. */
  breath: number
  /** Torso lean (radians, negative = back). */
  lean: number
  /** Head yaw / pitch / roll in radians. */
  headYaw: number
  headPitch: number
  headRoll: number
  /** 0 = perky ears, 1 = flat. */
  earFlat: number
  /** 0 = paws on keyboard, 1 = arm straight up. */
  armL: number
  armR: number
  /** Wrist wave offset (radians) applied to the right paw. */
  wave: number
  /** 0 = laptop closed, 1 = open. */
  lidOpen: number
  /** 0 = eyes open, 1 = closed. */
  blink: number
  /** 0..1 amount of keyboard typing motion. */
  typing: number
  /** Radians per second of whole-body spin. */
  spinSpeed: number
  /** Whether confetti should be emitted. */
  confetti: boolean
  /** Mouth openness 0..1 (smile vs frown handled by sign of `smile`). */
  smile: number
}

const BLINK_PERIOD = 3.7
const BLINK_LENGTH = 0.14

/** Deterministic blink: closed for `BLINK_LENGTH` seconds every `BLINK_PERIOD` seconds. */
export const blinkAt = (t: number): number => {
  const m = ((t % BLINK_PERIOD) + BLINK_PERIOD) % BLINK_PERIOD
  return m < BLINK_LENGTH ? 1 : 0
}

/** Pure pose for a mood at time `t` (seconds since the mood started). */
export function otterPose(mood: OtterMood, t: number): OtterPose {
  const base: OtterPose = {
    bodyY: 0,
    breath: Math.sin(t * 2.1) * 0.5 + 0.5,
    lean: 0,
    headYaw: Math.sin(t * 0.7) * 0.06,
    headPitch: 0.08,
    headRoll: 0,
    earFlat: 0,
    armL: 0,
    armR: 0,
    wave: 0,
    lidOpen: 1,
    blink: blinkAt(t),
    typing: 1,
    spinSpeed: 0,
    confetti: false,
    smile: 0.6,
  }
  switch (mood) {
    case 'idle':
      return base
    case 'cheer':
      return {
        ...base,
        bodyY: Math.abs(Math.sin(t * 6)) * 0.22,
        headPitch: -0.25,
        headYaw: 0,
        armR: 0.75 + Math.sin(t * 9) * 0.2,
        armL: 0.15,
        typing: 0,
        smile: 1,
      }
    case 'grumble':
      return {
        ...base,
        earFlat: 1,
        headPitch: 0.3,
        headYaw: Math.sin(t * 7.5) * 0.28,
        headRoll: 0,
        typing: 0,
        armL: 0.1,
        armR: 0.1,
        smile: -0.6,
        breath: Math.sin(t * 5) * 0.5 + 0.5,
      }
    case 'taunt':
      return {
        ...base,
        lean: -0.32,
        headPitch: -0.18,
        headRoll: 0.18,
        headYaw: 0.1,
        armR: 0.85,
        wave: Math.sin(t * 5.5) * 0.45,
        typing: 0,
        smile: 0.9,
        blink: t % 4 > 2 && t % 4 < 2.9 ? 0.55 : blinkAt(t),
      }
    case 'victory':
      return {
        ...base,
        bodyY: Math.abs(Math.sin(t * 5)) * 0.3,
        armL: 1,
        armR: 1,
        headPitch: -0.3,
        headYaw: 0,
        typing: 0,
        spinSpeed: 4.2,
        confetti: true,
        smile: 1,
      }
    case 'defeat':
      return {
        ...base,
        lean: 0.32,
        headPitch: 0.55,
        headYaw: 0,
        earFlat: 0.75,
        armL: -0.25,
        armR: -0.25,
        lidOpen: 0,
        typing: 0,
        breath: Math.sin(t * 1.1) * 0.5 + 0.5,
        smile: -0.8,
        blink: t % 5 < 1.2 ? 1 : blinkAt(t),
      }
  }
}

/** Numeric fields of the pose that are smoothed between moods. */
export const OTTER_POSE_SMOOTHED = [
  'bodyY',
  'breath',
  'lean',
  'headYaw',
  'headPitch',
  'headRoll',
  'earFlat',
  'armL',
  'armR',
  'wave',
  'lidOpen',
  'blink',
  'typing',
  'smile',
] as const satisfies readonly (keyof OtterPose)[]

/** Smooth `current` toward `target` on every numeric channel, in place. */
export function smoothPose(current: OtterPose, target: OtterPose, dt: number, speed = 9): OtterPose {
  for (const key of OTTER_POSE_SMOOTHED) {
    const s = key === 'blink' ? 40 : speed
    current[key] = damp(current[key], target[key], s, dt)
  }
  current.spinSpeed = target.spinSpeed
  current.confetti = target.confetti
  return current
}
