import { describe, expect, it } from 'vitest'
import { randomPlacement, type Difficulty } from '../engine'
import { createOpponent, describeStrategy, playGame, seededRng } from './index'

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']
const GAMES = 200

function benchmark(difficulty: Difficulty, seed: number) {
  const rng = seededRng(seed)
  const shots: number[] = []
  for (let i = 0; i < GAMES; i++) {
    const board = randomPlacement(rng)
    const opponent = createOpponent(difficulty, rng)
    // playGame fires through the engine, which throws on a repeated or out-of-bounds shot.
    const result = playGame(opponent, board)
    expect(new Set(result.coords.map((c) => `${c.x},${c.y}`)).size).toBe(result.shots)
    expect(result.shots).toBeLessThanOrEqual(100)
    shots.push(result.shots)
  }
  return shots.reduce((a, b) => a + b, 0) / shots.length
}

describe('createOpponent', () => {
  it.each(DIFFICULTIES)('%s reports its difficulty', (d) => {
    expect(createOpponent(d).difficulty).toBe(d)
  })

  it.each(DIFFICULTIES)('%s is deterministic for a given rng seed', (d) => {
    const run = () => playGame(createOpponent(d, seededRng(99)), randomPlacement(seededRng(5))).coords
    expect(run()).toEqual(run())
  })

  it.each(DIFFICULTIES)(
    `%s finishes ${GAMES} games against random placements without repeating a shot`,
    (d) => {
      expect(benchmark(d, 1)).toBeGreaterThan(0)
    },
  )

  it('is strictly harder at each step: easy > medium > hard shots to win', () => {
    const easy = benchmark('easy', 42)
    const medium = benchmark('medium', 42)
    const hard = benchmark('hard', 42)
    expect(easy).toBeGreaterThan(medium)
    expect(medium).toBeGreaterThan(hard)
    expect(hard).toBeLessThan(65)
    expect(easy).toBeGreaterThanOrEqual(90)
    expect(easy).toBeLessThanOrEqual(100)
  })
})

describe('describeStrategy', () => {
  it.each(DIFFICULTIES)('%s has one line of flavour text', (d) => {
    const text = describeStrategy(d)
    expect(text.length).toBeGreaterThan(20)
    expect(text).not.toContain('\n')
  })
})
