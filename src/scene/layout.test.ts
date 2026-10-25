import { describe, expect, it } from 'vitest'
import { allCoords, BOARD_SIZE } from '../engine'
import { BOARD_LAYOUT, boardBounds, boardCenter, cellToWorld, worldToCell } from './layout'

describe('cellToWorld', () => {
  it('returns the centre of the cell relative to the origin', () => {
    expect(cellToWorld({ x: 0, y: 0 }, [0, 0, 0], 1)).toEqual([0.5, 0, 0.5])
    expect(cellToWorld({ x: 3, y: 7 }, [-5, 0.12, 1], 1)).toEqual([-1.5, 0.12, 8.5])
    expect(cellToWorld({ x: 1, y: 2 }, [10, 0, 10], 2)).toEqual([13, 0, 15])
  })

  it('round-trips through worldToCell for every cell on both boards', () => {
    for (const board of [BOARD_LAYOUT.player, BOARD_LAYOUT.enemy]) {
      for (const coord of allCoords()) {
        const [x, , z] = cellToWorld(coord, board.origin, board.cellSize)
        expect(worldToCell({ x, z }, board.origin, board.cellSize, board.size)).toEqual(coord)
      }
    }
  })

  it('worldToCell returns null outside the board', () => {
    const b = BOARD_LAYOUT.player
    expect(worldToCell({ x: b.origin[0] - 0.01, z: b.origin[2] + 1 }, b.origin, b.cellSize, b.size)).toBeNull()
    expect(worldToCell({ x: b.origin[0] + 1, z: b.origin[2] + 10.01 }, b.origin, b.cellSize, b.size)).toBeNull()
  })
})

describe('BOARD_LAYOUT', () => {
  it('matches the engine board size', () => {
    expect(BOARD_LAYOUT.player.size).toBe(BOARD_SIZE)
    expect(BOARD_LAYOUT.enemy.size).toBe(BOARD_SIZE)
  })

  it('places both boards on the same surface height', () => {
    expect(BOARD_LAYOUT.player.origin[1]).toBe(BOARD_LAYOUT.surfaceY)
    expect(BOARD_LAYOUT.enemy.origin[1]).toBe(BOARD_LAYOUT.surfaceY)
  })

  it('never lets a cell of one board overlap a cell of the other', () => {
    const player = new Set<string>()
    for (const c of allCoords()) {
      const [x, , z] = cellToWorld(c, BOARD_LAYOUT.player.origin, BOARD_LAYOUT.player.cellSize)
      player.add(`${x},${z}`)
    }
    for (const c of allCoords()) {
      const [x, , z] = cellToWorld(c, BOARD_LAYOUT.enemy.origin, BOARD_LAYOUT.enemy.cellSize)
      expect(player.has(`${x},${z}`)).toBe(false)
      // a point on the enemy's board must not resolve to a cell on the player's board and vice versa
      expect(worldToCell({ x, z }, BOARD_LAYOUT.player.origin, BOARD_LAYOUT.player.cellSize)).toBeNull()
    }
  })

  it('keeps the documented gap of open water between the boards', () => {
    const [, enemyMinZ, , enemyMaxZ] = boardBounds(BOARD_LAYOUT.enemy)
    const [, playerMinZ, , playerMaxZ] = boardBounds(BOARD_LAYOUT.player)
    expect(enemyMaxZ).toBeLessThan(playerMinZ)
    expect(playerMinZ - enemyMaxZ).toBe(BOARD_LAYOUT.gap)
    expect(enemyMaxZ - enemyMinZ).toBe(10)
    expect(playerMaxZ - playerMinZ).toBe(10)
  })

  it('centres both boards on x = 0', () => {
    expect(boardCenter(BOARD_LAYOUT.player)[0]).toBe(0)
    expect(boardCenter(BOARD_LAYOUT.enemy)[0]).toBe(0)
  })
})
