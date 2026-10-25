import { describe, expect, it } from 'vitest'
import {
  createBoard,
  enemyView,
  fire,
  FLEET_BY_ID,
  neighbors,
  placeShip,
  type Board,
  type Coord,
} from '../engine'
import { MediumOpponent } from './medium'
import { seededRng } from './rng'

const key = (c: Coord) => `${c.x},${c.y}`

/** Fires at `coord`, feeds the result to the opponent, returns the new board. */
function shoot(opponent: MediumOpponent, board: Board, coord: Coord): Board {
  const next = fire(board, coord)
  opponent.observe(next.result)
  return next.board
}

describe('MediumOpponent', () => {
  it('follows up a hit with an orthogonally adjacent cell', () => {
    for (let seed = 0; seed < 20; seed++) {
      const opponent = new MediumOpponent(seededRng(seed))
      let board = placeShip(createBoard(), FLEET_BY_ID['clam-cruiser'], { x: 3, y: 4 }, 'horizontal')
      board = shoot(opponent, board, { x: 4, y: 4 })
      const next = opponent.nextShot(enemyView(board))
      expect(neighbors({ x: 4, y: 4 }).map(key)).toContain(key(next))
    }
  })

  it('continues along the axis once two hits line up', () => {
    for (let seed = 0; seed < 20; seed++) {
      const opponent = new MediumOpponent(seededRng(seed))
      let board = placeShip(createBoard(), FLEET_BY_ID['kelp-carrier'], { x: 2, y: 5 }, 'horizontal')
      board = shoot(opponent, board, { x: 4, y: 5 })
      board = shoot(opponent, board, { x: 5, y: 5 })
      const next = opponent.nextShot(enemyView(board))
      expect([key({ x: 3, y: 5 }), key({ x: 6, y: 5 })]).toContain(key(next))
    }
  })

  it('keeps working on a stray hit from an adjacent ship after the first ship sinks', () => {
    for (let seed = 0; seed < 20; seed++) {
      const opponent = new MediumOpponent(seededRng(seed))
      let board = placeShip(createBoard(), FLEET_BY_ID['pebble-patrol'], { x: 2, y: 2 }, 'horizontal')
      board = placeShip(board, FLEET_BY_ID['stream-sub'], { x: 2, y: 3 }, 'horizontal')
      // Hit the sub first (stray), then sink the patrol boat.
      board = shoot(opponent, board, { x: 3, y: 3 })
      board = shoot(opponent, board, { x: 2, y: 2 })
      board = shoot(opponent, board, { x: 3, y: 2 })
      expect(board.shots.at(-1)?.outcome).toBe('sunk')
      const next = opponent.nextShot(enemyView(board))
      const around = neighbors({ x: 3, y: 3 }).map(key)
      expect(around).toContain(key(next))
    }
  })

  it('goes back to hunting when nothing is left to target', () => {
    const opponent = new MediumOpponent(seededRng(3))
    let board = placeShip(createBoard(), FLEET_BY_ID['pebble-patrol'], { x: 0, y: 0 }, 'horizontal')
    board = placeShip(board, FLEET_BY_ID['kelp-carrier'], { x: 0, y: 9 }, 'horizontal')
    board = shoot(opponent, board, { x: 0, y: 0 })
    board = shoot(opponent, board, { x: 1, y: 0 })
    const next = opponent.nextShot(enemyView(board))
    expect(board.shots.map((s) => key(s.coord))).not.toContain(key(next))
  })
})
