import type { Difficulty } from '../engine'

/** Pacing in ms. Reduced motion collapses everything so turns feel instant. */
export const PACING = {
  result: { normal: 750, reduced: 60 },
  afterEnemy: { normal: 500, reduced: 40 },
  think: {
    easy: [1100, 1700],
    medium: [800, 1300],
    hard: [500, 900],
    reduced: [80, 140],
  } as Record<Difficulty | 'reduced', [number, number]>,
}
