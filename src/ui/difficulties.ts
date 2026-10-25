import { describeStrategy } from '../ai'
import type { Difficulty } from '../engine'

export const DIFFICULTIES: {
  id: Difficulty
  label: string
  tagline: string
  how: string
  waves: number
}[] = [
  {
    id: 'easy',
    label: 'Easy',
    tagline: describeStrategy('easy'),
    how: 'Fires at random and never follows up on a hit. Perfect for learning the ropes.',
    waves: 1,
  },
  {
    id: 'medium',
    label: 'Medium',
    tagline: describeStrategy('medium'),
    how: 'Hunts randomly until he hits, then works the neighbouring cells until the ship sinks.',
    waves: 2,
  },
  {
    id: 'hard',
    label: 'Hard',
    tagline: describeStrategy('hard'),
    how: 'Builds a probability heatmap over every legal placement, uses parity and ship-fit analysis.',
    waves: 3,
  },
]
