/** Deterministic finished games for the demo route and tests: two AIs play each other from seeded placements. */
import { createOpponent, seededRng } from '../ai'
import { enemyView, fire, isFleetSunk, randomPlacement, type Board, type Difficulty, type Player } from '../engine'
import type { GameEvent } from '../store/gameStore'
import type { ReplaySnapshot } from './replayModel'

export interface SimulateOptions {
  difficulty?: Difficulty
  /** Skill of the AI standing in for the human. */
  humanSkill?: Difficulty
  /** Stop after this many events (unfinished game), e.g. for a mid-battle photo. */
  maxEvents?: number
}

export function simulateGame(seed: number, { difficulty = 'medium', humanSkill = 'hard', maxEvents = Infinity }: SimulateOptions = {}): ReplaySnapshot {
  const rng = seededRng(seed)
  let playerBoard: Board = randomPlacement(rng)
  let enemyBoard: Board = randomPlacement(rng)
  const human = createOpponent(humanSkill, seededRng(seed * 7 + 1))
  const enemy = createOpponent(difficulty, seededRng(seed * 13 + 2))
  const events: GameEvent[] = []
  let turn: Player = 'human'
  let winner: Player | undefined
  let id = 1
  while (!winner && events.length < maxEvents) {
    if (turn === 'human') {
      const coord = human.nextShot(enemyView(enemyBoard))
      const next = fire(enemyBoard, coord)
      enemyBoard = next.board
      human.observe(next.result)
      events.push({ id: id++, by: 'human', kind: 'shot', result: next.result })
      if (isFleetSunk(enemyBoard)) winner = 'human'
      turn = 'enemy'
    } else {
      const coord = enemy.nextShot(enemyView(playerBoard))
      const next = fire(playerBoard, coord)
      playerBoard = next.board
      enemy.observe(next.result)
      events.push({ id: id++, by: 'enemy', kind: 'shot', result: next.result })
      if (isFleetSunk(playerBoard)) winner = 'enemy'
      turn = 'human'
    }
  }
  return { difficulty, winner, modes: { salvo: false, storm: false, blackFlag: false }, playerBoard, enemyBoard, events }
}
