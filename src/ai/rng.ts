/**
 * Small, fast, seedable PRNG (mulberry32). Returns numbers in [0, 1) like Math.random.
 * Used by tests and the benchmark so every game is reproducible.
 */
export function seededRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniformly pick one element of a non-empty array. */
export function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)]
}
