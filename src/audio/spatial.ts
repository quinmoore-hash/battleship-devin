/**
 * Camera-relative stereo panning + distance attenuation (pure maths, unit-tested).
 * World coordinates follow src/scene/layout.ts: +x right, +z toward the camera / player fleet.
 */
export type Vec3 = readonly [number, number, number]

export interface AudioListener {
  position: Vec3
  /** Unit-ish vector the camera looks along; only its xz projection matters for panning. */
  forward: Vec3
}

export interface SpatialOptions {
  /** Distance (world units) within which a sound plays at full gain. */
  refDistance?: number
  /** Beyond this the gain is clamped to `minGain`. */
  maxDistance?: number
  /** How fast gain falls past `refDistance` (1 = inverse distance). */
  rolloff?: number
  minGain?: number
  /** Pan spread: how far off-axis (in world units at the listener's distance) maps to hard left/right. */
  panWidth?: number
}

export interface SpatialResult {
  /** -1 (hard left) .. 1 (hard right) */
  pan: number
  /** 0..1 */
  gain: number
  distance: number
}

/** Default listener matches the game camera: above and behind the player fleet looking over both boards. */
export const DEFAULT_LISTENER: AudioListener = { position: [-0.5, 11, 15], forward: [0, -0.55, -0.83] }

const DEFAULTS: Required<SpatialOptions> = { refDistance: 10, maxDistance: 60, rolloff: 1.1, minGain: 0.08, panWidth: 12 }

export function spatialize(world: Vec3, listener: AudioListener = DEFAULT_LISTENER, options: SpatialOptions = {}): SpatialResult {
  const o = { ...DEFAULTS, ...options }
  const dx = world[0] - listener.position[0]
  const dy = world[1] - listener.position[1]
  const dz = world[2] - listener.position[2]
  const distance = Math.hypot(dx, dy, dz)

  // right vector = forward(xz) x up, i.e. (−fz, 0, fx) normalised; fall back to +x when looking straight down.
  let fx = listener.forward[0]
  let fz = listener.forward[2]
  const fl = Math.hypot(fx, fz)
  if (fl < 1e-6) {
    fx = 0
    fz = -1
  } else {
    fx /= fl
    fz /= fl
  }
  const rx = -fz
  const rz = fx
  const lateral = dx * rx + dz * rz
  const pan = clamp(lateral / o.panWidth, -1, 1)

  let gain = 1
  if (distance > o.refDistance) gain = o.refDistance / (o.refDistance + o.rolloff * (distance - o.refDistance))
  if (distance >= o.maxDistance) gain = Math.min(gain, o.minGain)
  gain = clamp(gain, o.minGain, 1)
  return { pan: round3(pan), gain: round3(gain), distance }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}
