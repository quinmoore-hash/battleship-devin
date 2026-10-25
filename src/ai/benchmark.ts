/**
 * Shots-to-win benchmark for every difficulty against random placements.
 *
 *   npx tsx src/ai/benchmark.ts [games] [seed]
 */
import { randomPlacement, type Difficulty } from '../engine'
import { createOpponent } from './index'
import { seededRng } from './rng'
import { playGame } from './simulate'

// src/ is compiled with DOM types only, so reach for argv without the node typings.
const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? []
const games = Number(argv[2] ?? 500)
const seed = Number(argv[3] ?? 2026)
const difficulties: Difficulty[] = ['easy', 'medium', 'hard']

console.log(`${games} games per difficulty, seed ${seed}\n`)
console.log('difficulty | avg   | min | max | p50 | p90')
console.log('-----------|-------|-----|-----|-----|----')
for (const difficulty of difficulties) {
  const rng = seededRng(seed)
  const shots: number[] = []
  const started = performance.now()
  for (let i = 0; i < games; i++) {
    const board = randomPlacement(rng)
    shots.push(playGame(createOpponent(difficulty, rng), board).shots)
  }
  const ms = performance.now() - started
  const sorted = [...shots].sort((a, b) => a - b)
  const avg = shots.reduce((a, b) => a + b, 0) / shots.length
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
  console.log(
    `${difficulty.padEnd(10)} | ${avg.toFixed(1).padStart(5)} | ${String(sorted[0]).padStart(3)} | ${String(sorted[sorted.length - 1]).padStart(3)} | ${String(pct(0.5)).padStart(3)} | ${String(pct(0.9)).padStart(3)}   (${(ms / games).toFixed(2)} ms/game)`,
  )
}
