import { seededRandom } from '../random'
import type { Vec3 } from '../../scene/layout'

/** One wooden shard thrown by a cannonball impact. Immutable; its state at time `t` comes from `splinterAt`. */
export interface Splinter {
  px: number
  py: number
  pz: number
  vx: number
  vy: number
  vz: number
  /** Box half-extents: long, thin planks and chunky knots. */
  sx: number
  sy: number
  sz: number
  /** Angular velocity (rad/s) around each axis. */
  wx: number
  wy: number
  wz: number
  /** 0..1 picks a wood tone; > 0.8 is charred. */
  tint: number
  /** Seconds before the shard is spawned (the burst is not a single frame). */
  delay: number
  /** Seconds the shard stays visible after landing on the water. */
  float: number
}

export interface SplinterOptions {
  seed: number
  count: number
  /** Outward direction of the hull face that was hit (model/world space). */
  normal: Vec3
  /** Spread half-angle in radians around the normal. */
  spread?: number
  speed?: [number, number]
  size?: number
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/** Deterministic shard set: mostly along the hit normal, biased upward, with a few big planks. */
export function makeSplinters({ seed, count, normal, spread = 0.9, speed = [2.5, 6.5], size = 1 }: SplinterOptions): Splinter[] {
  const rnd = seededRandom(seed)
  const n = norm(normal)
  // orthonormal basis around the normal
  const up: Vec3 = Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
  const t1 = norm([n[1] * up[2] - n[2] * up[1], n[2] * up[0] - n[0] * up[2], n[0] * up[1] - n[1] * up[0]])
  const t2: Vec3 = [n[1] * t1[2] - n[2] * t1[1], n[2] * t1[0] - n[0] * t1[2], n[0] * t1[1] - n[1] * t1[0]]
  return Array.from({ length: count }, (_, i) => {
    const big = i < Math.max(2, count * 0.15)
    const a = rnd() * Math.PI * 2
    const r = Math.pow(rnd(), 0.6) * spread
    const cs = Math.cos(r)
    const sn = Math.sin(r)
    const dx = n[0] * cs + (t1[0] * Math.cos(a) + t2[0] * Math.sin(a)) * sn
    const dy = n[1] * cs + (t1[1] * Math.cos(a) + t2[1] * Math.sin(a)) * sn
    const dz = n[2] * cs + (t1[2] * Math.cos(a) + t2[2] * Math.sin(a)) * sn
    const v = (speed[0] + (speed[1] - speed[0]) * rnd()) * (big ? 0.7 : 1)
    const len = (big ? 0.18 + rnd() * 0.16 : 0.04 + rnd() * 0.1) * size
    const thin = (big ? 0.025 + rnd() * 0.02 : 0.006 + rnd() * 0.012) * size
    return {
      px: n[0] * 0.05 + (rnd() - 0.5) * 0.12,
      py: n[1] * 0.05 + (rnd() - 0.5) * 0.12,
      pz: n[2] * 0.05 + (rnd() - 0.5) * 0.12,
      vx: dx * v,
      vy: dy * v + 1.2 + rnd() * 2.2,
      vz: dz * v,
      sx: len,
      sy: thin,
      sz: thin * (1 + rnd() * 2.5),
      wx: (rnd() - 0.5) * 18,
      wy: (rnd() - 0.5) * 18,
      wz: (rnd() - 0.5) * 24,
      tint: rnd(),
      delay: rnd() * 0.08,
      float: big ? 2.2 + rnd() * 1.5 : 0.6 + rnd() * 1.2,
    }
  })
}

export interface SplinterState {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
  /** 1 while flying, fades to 0 as the shard sinks; 0 = hidden. */
  alpha: number
  /** true once it has hit the water. */
  landed: boolean
}

export const SPLINTER_GRAVITY = -9.8

/**
 * Shard state `t` seconds after the burst. Shards fly ballistically, splash into the water at
 * `waterY` (relative to the burst origin), bounce once with heavy damping, then bob and sink.
 * Analytic (no integration) so it is deterministic and frame-rate independent.
 */
export function splinterAt(s: Splinter, t: number, waterY: number, drag = 0.6): SplinterState | null {
  const age = t - s.delay
  if (age < 0) return null
  const g = SPLINTER_GRAVITY
  // time to reach the water: solve py + vy*a + 0.5 g a^2 = waterY for the positive root
  const c = s.py - waterY
  const disc = s.vy * s.vy - 2 * g * c
  const tLand = disc >= 0 ? (-s.vy - Math.sqrt(disc)) / g : Infinity
  const dragPos = (a: number) => (drag > 0 ? (1 - Math.exp(-drag * a)) / drag : a)
  if (age < tLand) {
    const d = dragPos(age)
    return {
      x: s.px + s.vx * d,
      y: s.py + s.vy * age + 0.5 * g * age * age,
      z: s.pz + s.vz * d,
      rx: s.wx * age,
      ry: s.wy * age,
      rz: s.wz * age,
      alpha: 1,
      landed: false,
    }
  }
  const after = age - tLand
  if (after > s.float) return null
  const dl = dragPos(tLand)
  const lx = s.px + s.vx * dl
  const lz = s.pz + s.vz * dl
  // small splash hop then settle; the surface bob and the final sink
  const hop = Math.max(0, 0.6 * after * (0.35 - after)) * 4
  const bob = Math.sin(after * 5 + s.tint * 6) * 0.012
  const sinkK = Math.max(0, (after - s.float * 0.6) / (s.float * 0.4))
  const slide = 1 - Math.exp(-after * 3)
  return {
    x: lx + s.vx * 0.12 * slide,
    y: waterY + hop + bob - sinkK * sinkK * 0.08,
    z: lz + s.vz * 0.12 * slide,
    rx: s.wx * tLand + Math.sin(after * 3 + s.tint) * 0.12,
    ry: s.wy * tLand + after * 0.4,
    rz: s.wz * tLand * (1 - slide) + (s.wz > 0 ? 0 : Math.PI) * slide,
    alpha: 1 - sinkK,
    landed: true,
  }
}

/** Seconds until the last shard has sunk (upper bound used to unmount the burst). */
export function splinterDuration(shards: Splinter[], waterY: number): number {
  let m = 0
  for (const s of shards) {
    const c = s.py - waterY
    const disc = s.vy * s.vy - 2 * SPLINTER_GRAVITY * c
    const tLand = disc >= 0 ? (-s.vy - Math.sqrt(disc)) / SPLINTER_GRAVITY : 3
    m = Math.max(m, s.delay + tLand + s.float)
  }
  return m
}
