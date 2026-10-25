import { seededRandom } from './random'

export interface Particle {
  px: number
  py: number
  pz: number
  vx: number
  vy: number
  vz: number
  size: number
  life: number
  delay: number
  /** 0..1 used to pick a colour from the palette. */
  tint: number
}

export interface BurstOptions {
  count: number
  seed: number
  /** Horizontal speed range. */
  speed: [number, number]
  /** Vertical speed range. */
  up: [number, number]
  size: [number, number]
  life: [number, number]
  /** Max start delay so the burst isn't a single frame. */
  stagger?: number
  /** Initial spread radius. */
  spread?: number
}

/** Deterministic set of particles for a one-shot burst. Same seed => same burst. */
export function makeBurst(opts: BurstOptions): Particle[] {
  const rnd = seededRandom(opts.seed)
  const range = ([a, b]: [number, number]) => a + (b - a) * rnd()
  const spread = opts.spread ?? 0.05
  return Array.from({ length: opts.count }, () => {
    const angle = rnd() * Math.PI * 2
    const speed = range(opts.speed)
    const r = rnd() * spread
    return {
      px: Math.cos(angle) * r,
      py: 0,
      pz: Math.sin(angle) * r,
      vx: Math.cos(angle) * speed,
      vy: range(opts.up),
      vz: Math.sin(angle) * speed,
      size: range(opts.size),
      life: range(opts.life),
      delay: rnd() * (opts.stagger ?? 0),
      tint: rnd(),
    }
  })
}

export interface ParticleState {
  x: number
  y: number
  z: number
  /** Scale multiplier, already includes fade-out. 0 when dead. */
  scale: number
  /** 0..1 life progress. */
  age: number
}

/** Position of a particle `t` seconds after the burst started under constant `gravity` (negative = falls). */
export function particleAt(p: Particle, t: number, gravity: number, drag = 0): ParticleState | null {
  const age = t - p.delay
  if (age < 0 || age > p.life) return null
  const k = age / p.life
  const d = drag > 0 ? (1 - Math.exp(-drag * age)) / drag : age
  return {
    x: p.px + p.vx * d,
    y: p.py + p.vy * age + 0.5 * gravity * age * age,
    z: p.pz + p.vz * d,
    scale: p.size * (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85),
    age: k,
  }
}

/** Longest time any particle in the burst is alive. */
export const burstDuration = (particles: Particle[]): number =>
  particles.reduce((m, p) => Math.max(m, p.delay + p.life), 0)

export interface SmokeOptions {
  count: number
  /** Seconds for one puff to rise and fade. */
  period: number
  height: number
  /** Horizontal drift amplitude. */
  drift: number
  baseScale: number
  seed?: number
}

/** Looping rising-smoke puff `i` at time `t`. Pure so it can be unit-tested. */
export function smokePuff(i: number, t: number, opts: SmokeOptions): ParticleState {
  const offset = (i / opts.count) * opts.period
  const local = (((t + offset) % opts.period) + opts.period) % opts.period
  const k = local / opts.period
  const wobble = i * 2.399 + (opts.seed ?? 0)
  const fadeIn = Math.min(k * 6, 1)
  const fadeOut = 1 - k
  return {
    x: Math.sin(k * 3 + wobble) * opts.drift * k,
    y: k * opts.height,
    z: Math.cos(k * 2.3 + wobble) * opts.drift * k,
    scale: opts.baseScale * (0.4 + k * 1.1) * fadeIn * fadeOut,
    age: k,
  }
}
