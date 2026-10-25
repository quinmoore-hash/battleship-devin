import { seededRandom } from '../random'

export interface SmokePlumeOptions {
  count: number
  seed: number
  /** Seconds for a puff to rise from the source to the top of the column. */
  life: number
  height: number
  /** Wind (x, z) units/second; the column leans and drifts downwind. */
  wind?: [number, number]
  /** Puff radius at the source and at the top. */
  radius: [number, number]
  /** Turbulent wander amplitude. */
  wander?: number
}

export interface SmokePuffState {
  x: number
  y: number
  z: number
  radius: number
  /** 0..1 opacity; thins with height and fades in at the source. */
  alpha: number
  /** Billboard spin (radians). */
  spin: number
  age: number
}

/** Per-puff constants derived from the seed once: phase, wobble seed, spin rate, spin offset. */
export function smokeSeeds(opts: SmokePlumeOptions): Float32Array {
  const rnd = seededRandom(opts.seed)
  const a = new Float32Array(opts.count * 4)
  for (let i = 0; i < opts.count; i++) {
    a[i * 4] = i / opts.count + (rnd() - 0.5) * (0.6 / opts.count) // even stagger with jitter
    a[i * 4 + 1] = rnd() * 10
    a[i * 4 + 2] = (rnd() - 0.5) * 1.2
    a[i * 4 + 3] = rnd() * Math.PI * 2
  }
  return a
}

/**
 * Looping smoke puff `i` at time `t`. Puffs leave the source small and dense, expand as they rise,
 * get pushed downwind quadratically (the plume leans) and thin to nothing at the top.
 */
export function smokePuffAt(i: number, t: number, seeds: Float32Array, opts: SmokePlumeOptions): SmokePuffState {
  const phase = seeds[i * 4]
  const wob = seeds[i * 4 + 1]
  const spinRate = seeds[i * 4 + 2]
  const spin0 = seeds[i * 4 + 3]
  const age = (((t / opts.life + phase) % 1) + 1) % 1
  const wind = opts.wind ?? [0, 0]
  const wander = opts.wander ?? 0.15
  const lean = age * age * opts.life
  const ease = Math.sqrt(age)
  const radius = opts.radius[0] + (opts.radius[1] - opts.radius[0]) * ease
  const fadeIn = Math.min(age * 10, 1)
  const thin = Math.pow(1 - age, 1.4)
  return {
    x: wind[0] * lean + Math.sin(age * 5 + wob) * wander * ease,
    y: age * opts.height * (0.3 + 0.7 * (2 - age) * age) ,
    z: wind[1] * lean + Math.cos(age * 4.3 + wob * 1.7) * wander * ease,
    radius,
    alpha: fadeIn * thin,
    spin: spin0 + t * spinRate,
    age,
  }
}
