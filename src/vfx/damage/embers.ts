import { seededRandom } from '../random'

export interface EmberOptions {
  count: number
  seed: number
  /** Seconds one ember takes to rise and die. */
  life: number
  height: number
  /** Horizontal wander amplitude. */
  wander: number
  /** Wind (x, z) in units per second; pushes embers/smoke downwind as they rise. */
  wind?: [number, number]
  /** Spawn radius at the base. */
  radius?: number
}

export interface EmberState {
  x: number
  y: number
  z: number
  /** 0..1 brightness (flicker included). 0 = dead. */
  glow: number
  size: number
  age: number
}

/** Per-ember constants, derived from the seed once. */
export function emberSeeds(opts: EmberOptions): Float32Array {
  const rnd = seededRandom(opts.seed)
  const a = new Float32Array(opts.count * 4)
  for (let i = 0; i < opts.count; i++) {
    a[i * 4] = rnd() // phase offset 0..1
    a[i * 4 + 1] = rnd() * Math.PI * 2 // spawn angle
    a[i * 4 + 2] = 0.5 + rnd() // size factor
    a[i * 4 + 3] = rnd() * 10 // wobble seed
  }
  return a
}

/**
 * Looping rising ember `i` at time `t`: spawns at the base, rises with a wobble, drifts with the
 * wind and flickers out near the top. Pure so it can be tested and shared with the smoke column.
 */
export function emberAt(i: number, t: number, seeds: Float32Array, opts: EmberOptions): EmberState {
  const phase = seeds[i * 4]
  const angle = seeds[i * 4 + 1]
  const sizeK = seeds[i * 4 + 2]
  const wob = seeds[i * 4 + 3]
  const local = (((t / opts.life + phase) % 1) + 1) % 1
  const age = local
  const r = (opts.radius ?? 0.12) * (0.3 + 0.7 * ((wob * 7.13) % 1))
  const wind = opts.wind ?? [0, 0]
  const rise = age * opts.height
  const ease = age * (2 - age)
  const fadeIn = Math.min(age * 8, 1)
  const fadeOut = 1 - age * age
  const flicker = 0.7 + 0.3 * Math.sin(t * 17 + wob * 20) * Math.sin(t * 7.3 + wob)
  return {
    x: Math.cos(angle) * r + Math.sin(t * 2.1 + wob) * opts.wander * ease + wind[0] * age * opts.life * 0.6,
    y: rise,
    z: Math.sin(angle) * r + Math.cos(t * 1.7 + wob * 1.3) * opts.wander * ease + wind[1] * age * opts.life * 0.6,
    glow: fadeIn * fadeOut * flicker,
    size: sizeK * (1 - age * 0.5),
    age,
  }
}
