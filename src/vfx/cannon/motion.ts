import { useGameStore } from '../../store/gameStore'
import type { Vec3 } from '../../scene/layout'

/** Reads the player's reduced-motion setting; effects use fewer, shorter particles when it is on. */
export const useReducedMotion = (): boolean => useGameStore((s) => s.settings.reducedMotion)

/** Prevailing wind the smoke drifts on (world units per second). Across the bay, slightly toward the camera. */
export const DEFAULT_WIND: Vec3 = [0.45, 0.12, 0.18]

/** Orthonormal basis `{u, v}` perpendicular to `d` (unit vector). Pure; used to spread particles in a cone. */
export function perpendicularBasis(d: Vec3): { u: Vec3; v: Vec3 } {
  const up: Vec3 = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
  const u = norm([d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]])
  const v: Vec3 = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]
  return { u, v }
}

const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Displacement after `t` seconds for a particle launched at speed 1 with linear drag `k`. */
export const dragDistance = (k: number, t: number): number => (k > 0 ? (1 - Math.exp(-k * t)) / k : t)
