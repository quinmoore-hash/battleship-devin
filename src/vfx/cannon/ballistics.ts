import type { Vec3 } from '../../scene/layout'
import { arcApex, arcPoint, clamp01 } from '../math'

/** Default cannonball muzzle speed in world units (grid cells) per second. */
export const CANNONBALL_SPEED = 15

export interface ArcOptions {
  /** Apex height above the chord between `from` and `to`. Defaults to a distance-scaled lob. */
  apex?: number
  /** Average horizontal speed along the chord, units per second. */
  speed?: number
  /** Never fly shorter than this (seconds), so point-blank shots are still visible. */
  minDuration?: number
}

export interface Arc {
  from: Vec3
  to: Vec3
  apex: number
  /** Flight time in seconds. */
  duration: number
  /** Horizontal chord length. */
  distance: number
  /** World position at normalised time `k` (0 = muzzle, 1 = impact). */
  pointAt(k: number): Vec3
  /** World velocity (units per second) at normalised time `k`. */
  velocityAt(k: number): Vec3
}

export const horizontalDistance = (a: Vec3, b: Vec3): number => Math.hypot(b[0] - a[0], b[2] - a[2])

/** Ballistic arc that hits `to` exactly at `duration`. Parabolic (constant gravity) so the apex is analytic. */
export function solveArc(from: Vec3, to: Vec3, opts: ArcOptions = {}): Arc {
  const distance = horizontalDistance(from, to)
  const apex = opts.apex ?? arcApex(from, to) * 0.75
  const speed = opts.speed ?? CANNONBALL_SPEED
  const duration = Math.max(opts.minDuration ?? 0.35, distance / speed)
  return {
    from,
    to,
    apex,
    duration,
    distance,
    pointAt: (k) => arcPoint(from, to, k, apex),
    velocityAt: (k) => {
      const t = clamp01(k)
      return [(to[0] - from[0]) / duration, ((to[1] - from[1]) + apex * 4 * (1 - 2 * t)) / duration, (to[2] - from[2]) / duration]
    },
  }
}

/** Normalised direction, or `fallback` when the vector is degenerate. */
export function normalize(v: Vec3, fallback: Vec3 = [0, 0, 1]): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2])
  return len < 1e-9 ? fallback : [v[0] / len, v[1] / len, v[2] / len]
}

/** Direction from `from` toward `to`, flattened to the horizon with a small upward tilt (what a muzzle points at). */
export function aimDirection(from: Vec3, to: Vec3, tilt = 0.08): Vec3 {
  return normalize([to[0] - from[0], 0, to[2] - from[2]], [0, 0, 1]).map((c, i) => (i === 1 ? tilt : c)) as Vec3
}

/** Latch that lets a callback fire exactly once, however many frames cross the trigger. */
export function createImpactLatch<T>(onImpact?: (arg: T) => void) {
  let fired = false
  return {
    get fired() {
      return fired
    },
    fire(arg: T) {
      if (fired) return false
      fired = true
      onImpact?.(arg)
      return true
    },
  }
}

export interface BroadsideShot {
  from: Vec3
  to: Vec3
}

export interface ScheduledShot extends BroadsideShot {
  index: number
  /** Seconds after the broadside starts that this gun fires. */
  delay: number
  arc: Arc
}

/** Spreads a volley over `stagger` seconds, bow to stern, and solves every arc. */
export function scheduleBroadside(shots: readonly BroadsideShot[], stagger: number, arcOpts?: ArcOptions): ScheduledShot[] {
  const n = shots.length
  return shots.map((s, index) => ({
    ...s,
    index,
    delay: n <= 1 ? 0 : (index / (n - 1)) * stagger,
    arc: solveArc(s.from, s.to, arcOpts),
  }))
}

/** Total time until the last ball of a broadside lands. */
export const broadsideDuration = (shots: readonly ScheduledShot[]): number =>
  shots.reduce((m, s) => Math.max(m, s.delay + s.arc.duration), 0)
