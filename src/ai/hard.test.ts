import { describe, expect, it } from 'vitest'
import {
  coordKey,
  createBoard,
  enemyView,
  fire,
  FLEET_BY_ID,
  placeShip,
  randomPlacement,
  type Board,
  type Coord,
  type EnemyBoardView,
  type ShotResult,
} from '../engine'
import { HardOpponent, heatmap } from './hard'
import { readView } from './knowledge'
import { seededRng } from './rng'

const miss = (x: number, y: number): ShotResult => ({ coord: { x, y }, outcome: 'miss' })

describe('HardOpponent', () => {
  it('never fires at a cell where no remaining ship could fit', () => {
    // Only the Pebble Patrol (2) is left and (0,0) is boxed in by misses: no placement covers it.
    const view: EnemyBoardView = {
      size: 10,
      shots: [miss(1, 0), miss(0, 1)],
      remainingShips: [FLEET_BY_ID['pebble-patrol']],
    }
    for (let seed = 0; seed < 50; seed++) {
      const shot = new HardOpponent(seededRng(seed)).nextShot(view)
      expect(coordKey(shot)).not.toBe('0,0')
    }
  })

  it('only ever fires at cells with non-zero placement probability over whole games', () => {
    const rng = seededRng(11)
    for (let game = 0; game < 50; game++) {
      let board: Board = randomPlacement(rng)
      const opponent = new HardOpponent(rng)
      for (let i = 0; i < 100; i++) {
        const view = enemyView(board)
        if (view.remainingShips.length === 0) break
        const shot = opponent.nextShot(view)
        const heat = heatmap(readView(view), view.remainingShips)
        expect(heat.get(coordKey(shot)) ?? 0).toBeGreaterThan(0)
        const next = fire(board, shot)
        opponent.observe(next.result)
        board = next.board
      }
    }
  })

  it('finishes off a hit ship before wandering away', () => {
    for (let seed = 0; seed < 20; seed++) {
      const opponent = new HardOpponent(seededRng(seed))
      let board = placeShip(createBoard(), FLEET_BY_ID['driftwood-destroyer'], { x: 5, y: 5 }, 'vertical')
      const first = fire(board, { x: 5, y: 6 })
      opponent.observe(first.result)
      board = first.board
      const shot = opponent.nextShot(enemyView(board))
      const adjacent: Coord[] = [
        { x: 4, y: 6 },
        { x: 6, y: 6 },
        { x: 5, y: 5 },
        { x: 5, y: 7 },
      ]
      expect(adjacent.map(coordKey)).toContain(coordKey(shot))
    }
  })

  it('separates two adjacent ships after the first one sinks', () => {
    // Patrol (2) at row 2, Sub (3) directly below it. Hit the sub, then sink the patrol.
    const opponent = new HardOpponent(seededRng(1))
    let board = placeShip(createBoard(), FLEET_BY_ID['pebble-patrol'], { x: 2, y: 2 }, 'horizontal')
    board = placeShip(board, FLEET_BY_ID['stream-sub'], { x: 2, y: 3 }, 'horizontal')
    for (const c of [{ x: 3, y: 3 }, { x: 2, y: 2 }, { x: 3, y: 2 }]) {
      const next = fire(board, c)
      opponent.observe(next.result)
      board = next.board
    }
    const view = enemyView(board)
    expect(view.remainingShips.map((s) => s.id)).toEqual(['stream-sub'])
    const shot = opponent.nextShot(view)
    // The only unexplained hit is (3,3); the patrol's cells are known sunk, so the next shot
    // must be in line with (3,3) and not on the sunk cells.
    expect(['2,3', '4,3', '3,4']).toContain(coordKey(shot))
  })

  it('uses parity while hunting on an empty board', () => {
    const view: EnemyBoardView = { size: 10, shots: [], remainingShips: [FLEET_BY_ID['pebble-patrol']] }
    const opponent = new HardOpponent(seededRng(8))
    const first = opponent.nextShot(view)
    const second = opponent.nextShot({ ...view, shots: [{ coord: first, outcome: 'miss' }] })
    expect((first.x + first.y) % 2).toBe((second.x + second.y) % 2)
  })
})
