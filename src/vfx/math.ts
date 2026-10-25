import type { Vec3 } from '../scene/layout'

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

/** Point on a parabolic arc from `from` to `to` at normalised time `t`, peaking `apex` above the chord. */
export function arcPoint(from: Vec3, to: Vec3, t: number, apex: number): Vec3 {
  const k = clamp01(t)
  return [lerp(from[0], to[0], k), lerp(from[1], to[1], k) + apex * 4 * k * (1 - k), lerp(from[2], to[2], k)]
}

/** Default apex grows with distance so short lobs still look like lobs. */
export const arcApex = (from: Vec3, to: Vec3): number => {
  const dx = to[0] - from[0]
  const dz = to[2] - from[2]
  return 1.5 + Math.sqrt(dx * dx + dz * dz) * 0.18
}
