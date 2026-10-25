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
    tagline: 'Devin is napping on his back.',
    how: 'Fires at random and never follows up on a hit. Perfect for learning the ropes.',
    waves: 1,
  },
  {
    id: 'medium',
    label: 'Medium',
    tagline: 'Devin is paying attention.',
    how: 'Hunts randomly until he hits, then works the neighbouring cells until the ship sinks.',
    waves: 2,
  },
  {
    id: 'hard',
    label: 'Hard',
    tagline: 'Devin has a clipboard and a grudge.',
    how: 'Builds a probability heatmap over every legal placement, uses parity and ship-fit analysis.',
    waves: 3,
  },
]
