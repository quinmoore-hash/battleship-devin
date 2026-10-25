import { describe, expect, it } from 'vitest'
import {
  canPlace,
  coordLabel,
  createBoard,
  enemyView,
  fire,
  isFleetPlaced,
  isFleetSunk,
  placeShip,
  randomPlacement,
  viewGrid,
} from './board'
import { FLEET, FLEET_BY_ID } from './fleet'

const carrier = FLEET_BY_ID['man-o-war']
const patrol = FLEET_BY_ID['sloop']

describe('placement', () => {
  it('rejects ships that run off the board', () => {
    const board = createBoard()
    expect(canPlace(board, carrier, { x: 6, y: 0 }, 'horizontal')).toBe(false)
    expect(canPlace(board, carrier, { x: 5, y: 0 }, 'horizontal')).toBe(true)
    expect(canPlace(board, carrier, { x: 0, y: 6 }, 'vertical')).toBe(false)
  })

  it('rejects overlapping ships', () => {
    const board = placeShip(createBoard(), carrier, { x: 0, y: 0 }, 'horizontal')
    expect(canPlace(board, patrol, { x: 4, y: 0 }, 'vertical')).toBe(false)
    expect(canPlace(board, patrol, { x: 5, y: 0 }, 'vertical')).toBe(true)
  })

  it('re-placing the same ship replaces it instead of overlapping with itself', () => {
    let board = placeShip(createBoard(), carrier, { x: 0, y: 0 }, 'horizontal')
    board = placeShip(board, carrier, { x: 1, y: 0 }, 'horizontal')
    expect(board.ships).toHaveLength(1)
    expect(board.ships[0].origin).toEqual({ x: 1, y: 0 })
  })

  it('randomPlacement places the whole fleet without overlap', () => {
    let seed = 42
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    }
    for (let i = 0; i < 50; i++) {
      const board = randomPlacement(rng)
      expect(isFleetPlaced(board)).toBe(true)
      const cells = board.ships.flatMap((s) => s.cells.map((c) => `${c.x},${c.y}`))
      expect(new Set(cells).size).toBe(cells.length)
      expect(cells).toHaveLength(FLEET.reduce((n, s) => n + s.length, 0))
    }
  })
})

describe('firing', () => {
  const board = placeShip(createBoard(), patrol, { x: 2, y: 2 }, 'horizontal')

  it('reports misses', () => {
    const { result } = fire(board, { x: 0, y: 0 })
    expect(result).toEqual({ coord: { x: 0, y: 0 }, outcome: 'miss' })
  })

  it('reports hits and sinks', () => {
    const first = fire(board, { x: 2, y: 2 })
    expect(first.result.outcome).toBe('hit')
    expect(first.result.shipId).toBe('sloop')
    const second = fire(first.board, { x: 3, y: 2 })
    expect(second.result.outcome).toBe('sunk')
    expect(isFleetSunk(second.board)).toBe(true)
  })

  it('refuses to fire at the same cell twice', () => {
    const { board: after } = fire(board, { x: 0, y: 0 })
    expect(() => fire(after, { x: 0, y: 0 })).toThrow()
  })

  it('refuses out-of-bounds shots', () => {
    expect(() => fire(board, { x: 10, y: 0 })).toThrow()
  })

  it('enemyView only exposes shots and remaining ship specs', () => {
    const { board: after } = fire(board, { x: 2, y: 2 })
    const view = enemyView(after)
    expect(view.shots).toHaveLength(1)
    expect(view.remainingShips.map((s) => s.id)).toEqual(['sloop'])
    expect(viewGrid(view)[2][2]).toBe('hit')
    expect(viewGrid(view)[0][0]).toBe('unknown')
  })

  it('viewGrid marks all cells of a sunk ship', () => {
    const a = fire(board, { x: 2, y: 2 })
    const b = fire(a.board, { x: 3, y: 2 })
    const grid = viewGrid(enemyView(b.board))
    expect(grid[2][2]).toBe('sunk')
    expect(grid[2][3]).toBe('sunk')
  })
})

describe('labels', () => {
  it('formats coordinates like a real game board', () => {
    expect(coordLabel({ x: 0, y: 0 })).toBe('A1')
    expect(coordLabel({ x: 9, y: 9 })).toBe('J10')
  })
})
