import { enemyView, fire, isFleetSunk, type Board, type Coord } from '../engine'
import type { AiOpponent } from './types'

export interface SimulationResult {
  shots: number
  coords: Coord[]
}

/** Plays `opponent` against `board` until the fleet is sunk. Throws if a shot is ever repeated. */
export function playGame(opponent: AiOpponent, board: Board): SimulationResult {
  const coords: Coord[] = []
  let current = board
  while (!isFleetSunk(current)) {
    const coord = opponent.nextShot(enemyView(current))
    const next = fire(current, coord) // throws on repeats / out of bounds
    opponent.observe(next.result)
    coords.push(coord)
    current = next.board
  }
  return { shots: coords.length, coords }
}
