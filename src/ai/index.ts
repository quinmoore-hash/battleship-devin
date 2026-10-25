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
  easy: 'A green crew firing blind: every broadside lands at random.',
  medium: 'A seasoned captain: one hit and the enemy circles the spot until the ship goes down.',
  hard: 'An admiral with charts and a grudge: every shot is the most likely cell on the board.',
}

/** One-line flavour text describing how the enemy fleet plays at this difficulty. */
export function describeStrategy(difficulty: Difficulty): string {
  return STRATEGY[difficulty]
}
