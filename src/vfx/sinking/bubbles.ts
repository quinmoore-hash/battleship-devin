import { clamp01 } from '../math'
import { seededRandom } from '../random'
import { window01 } from './pose'

export interface BubbleOptions {
  count: number
  seed: number
  /** Hull footprint the bubbles come up through (ship frame: x along the keel, z across). */
  length: number
  beam: number
  /** Seconds for one bubble to rise from `depth` and pop. */
  period: number
  /** Metres below the surface a bubble starts (hidden by the opaque water until it breaks through). */
  depth: number
}

export interface BubbleState {
  x: number
  y: number
  z: number
  /** Radius multiplier, 0 when popped. */
  scale: number
  /** 0..1 life progress. */
  age: number
  /** 0..1 strength of the surface ring left behind as it pops. */
  ring: number
}

/** Loop-free per-bubble constants derived from the seed (pure, cheap). */
function bubbleSeed(i: number, seed: number) {
  const rnd = seededRandom((seed * 7919 + i * 104729) >>> 0)
  return { u: rnd(), v: rnd(), w: rnd(), size: 0.6 + rnd() * 0.8, speed: 0.85 + rnd() * 0.3 }
}

/** Looping rising bubble `i` at scene time `t`. Breaks the surface at age ≈ 0.86 and pops just after. */
export function bubbleState(i: number, t: number, o: BubbleOptions): BubbleState {
  const c = bubbleSeed(i, o.seed)
  const period = o.period / c.speed
  const offset = c.w * period
  const local = (((t + offset) % period) + period) % period
  const k = local / period
  const rise = o.depth * 1.16
  const y = -o.depth + k * rise
  const wobble = c.u * 12.5 + c.v * 3
  const x = (c.u - 0.5) * o.length * 0.9 + Math.sin(k * 9 + wobble) * 0.04
  const z = (c.v - 0.5) * o.beam * 0.9 + Math.cos(k * 7 + wobble) * 0.04
  const pop = 1 - window01(k, 0.9, 0.97)
  const grow = 0.35 + k * 0.65
  return {
    x,
    y,
    z,
    scale: c.size * grow * pop * (k < 0.03 ? k / 0.03 : 1),
    age: k,
    ring: window01(k, 0.86, 0.92) * (1 - window01(k, 0.92, 1)),
  }
}

/** How much air escapes at `progress`: a little as the hull lists, most during the slide, none once it has settled. */
export function bubbleIntensity(progress: number): number {
  const p = clamp01(progress)
  return window01(p, 0.05, 0.4) * (0.35 + 0.65 * window01(p, 0.42, 0.6)) * (1 - window01(p, 0.86, 1))
}
