import type { Difficulty } from '../engine'
import { EasyOpponent } from './easy'
import { HardOpponent } from './hard'
import { MediumOpponent } from './medium'
import type { AiOpponent } from './types'

export type { AiOpponent, AiFactory } from './types'
export { seededRng } from './rng'
export { playGame, type SimulationResult } from './simulate'

export function createOpponent(difficulty: Difficulty, rng: () => number = Math.random): AiOpponent {
  switch (difficulty) {
    case 'easy':
      return new EasyOpponent(rng)
    case 'medium':
      return new MediumOpponent(rng)
    case 'hard':
      return new HardOpponent(rng)
  }
}

const STRATEGY: Record<Difficulty, string> = {
  easy: 'Devin is napping on his back, flicking pebbles at the water between snores.',
  medium: 'Devin is paying attention: one splash and he circles the spot until something sinks.',
  hard: 'Devin has a clipboard, a heatmap and a grudge. Every shot is the most likely cell.',
}

/** One-line flavour text describing how Devin plays at this difficulty. */
export function describeStrategy(difficulty: Difficulty): string {
  return STRATEGY[difficulty]
}
