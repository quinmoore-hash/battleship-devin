/** Free orbit / fly camera maths for photo mode (pure, so the limits and controls are unit-tested). */
import type { Vec3 } from '../scene/layout'

export interface OrbitState {
  /** Point the camera looks at. */
  target: Vec3
  distance: number
  /** Horizontal angle around the target, radians. */
  azimuth: number
  /** Angle from straight-up, radians (small = top-down, ~π/2 = at the horizon). */
  polar: number
}

export const PHOTO_LIMITS = {
  minDistance: 2.5,
  maxDistance: 110,
  minPolar: 0.08,
  maxPolar: Math.PI / 2 - 0.05,
  /** Never put the lens under the swell. */
  minCameraY: 0.9,
  /** Keep the target over the bay. */
  targetRange: 80,
  minTargetY: -2,
  maxTargetY: 30,
} as const

export const DEFAULT_PHOTO_ORBIT: OrbitState = { target: [0, 0.5, -6], distance: 34, azimuth: Math.PI * 0.12, polar: 1.1 }

export function orbitPosition(s: OrbitState): Vec3 {
  const sp = Math.sin(s.polar)
  return [
    s.target[0] + s.distance * sp * Math.sin(s.azimuth),
    s.target[1] + s.distance * Math.cos(s.polar),
    s.target[2] + s.distance * sp * Math.cos(s.azimuth),
  ]
}

export function clampOrbit(s: OrbitState, L = PHOTO_LIMITS): OrbitState {
  const next: OrbitState = {
    target: [
      Math.max(-L.targetRange, Math.min(L.targetRange, s.target[0])),
      Math.max(L.minTargetY, Math.min(L.maxTargetY, s.target[1])),
      Math.max(-L.targetRange, Math.min(L.targetRange, s.target[2])),
    ],
    distance: Math.max(L.minDistance, Math.min(L.maxDistance, s.distance)),
    azimuth: s.azimuth,
    polar: Math.max(L.minPolar, Math.min(L.maxPolar, s.polar)),
  }
  // if the lens would dip under the water, pitch up until it clears
  const y = orbitPosition(next)[1]
  if (y < L.minCameraY) {
    const cos = Math.min(1, Math.max(-1, (L.minCameraY - next.target[1]) / next.distance))
    next.polar = Math.min(next.polar, Math.acos(cos))
  }
  return next
}

export const rotateOrbit = (s: OrbitState, dAzimuth: number, dPolar: number): OrbitState =>
  clampOrbit({ ...s, azimuth: s.azimuth + dAzimuth, polar: s.polar + dPolar })

/** `factor` > 1 moves away, < 1 moves closer (exponential so wheel ticks feel even at every range). */
export const dollyOrbit = (s: OrbitState, factor: number): OrbitState => clampOrbit({ ...s, distance: s.distance * factor })

/** Camera-relative basis on the ground plane: `right` and `forward` (both horizontal, unit length). */
export function groundBasis(s: OrbitState): { right: Vec3; forward: Vec3 } {
  const forward: Vec3 = [-Math.sin(s.azimuth), 0, -Math.cos(s.azimuth)]
  const right: Vec3 = [-forward[2], 0, forward[0]]
  return { right, forward }
}

/** Slide the target across the water (screen-space pan); amounts in world units. */
export function panOrbit(s: OrbitState, dRight: number, dForward: number, dUp = 0): OrbitState {
  const { right, forward } = groundBasis(s)
  return clampOrbit({
    ...s,
    target: [
      s.target[0] + right[0] * dRight + forward[0] * dForward,
      s.target[1] + dUp,
      s.target[2] + right[2] * dRight + forward[2] * dForward,
    ],
  })
}

export interface FlyInput {
  forward: number
  right: number
  up: number
  /** Hold to move faster. */
  boost?: boolean
}

/** WASD / QE flight: moves the whole rig (target follows) at a speed proportional to the distance from the target. */
export function flyOrbit(s: OrbitState, input: FlyInput, dt: number): OrbitState {
  if (!input.forward && !input.right && !input.up) return s
  const speed = Math.max(4, s.distance * 0.6) * (input.boost ? 2.5 : 1) * dt
  return panOrbit(s, input.right * speed, input.forward * speed, input.up * speed)
}

/** Orbit state looking at `position` from `from` (used to start from a cinematic shot). */
export function orbitFromLookAt(from: Vec3, target: Vec3): OrbitState {
  const dx = from[0] - target[0]
  const dy = from[1] - target[1]
  const dz = from[2] - target[2]
  const distance = Math.hypot(dx, dy, dz) || 1
  return clampOrbit({ target: [...target] as Vec3, distance, azimuth: Math.atan2(dx, dz), polar: Math.acos(Math.min(1, Math.max(-1, dy / distance))) })
}
