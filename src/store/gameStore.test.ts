import { beforeEach, describe, expect, it } from 'vitest'
import { FLEET } from '../engine'
import { useGameStore } from './gameStore'

describe('gameStore', () => {
  beforeEach(() => useGameStore.getState().reset())

  it('walks menu -> placement -> battle -> gameover', () => {
    const s = () => useGameStore.getState()
    s().startGame('easy')
    expect(s().phase).toBe('placement')
    expect(s().otterBoard.ships).toHaveLength(FLEET.length)

    s().confirmPlacement()
    expect(s().phase).toBe('placement')

    s().autoPlacePlayerFleet()
    s().confirmPlacement()
    expect(s().phase).toBe('battle')
    expect(s().turn).toBe('human')

    const result = s().fireAt({ x: 0, y: 0 })
    expect(result).toBeDefined()
    expect(s().turn).toBe('otter')
    expect(s().fireAt({ x: 1, y: 0 })).toBeUndefined()

    const otter = s().otterTurn()
    expect(otter).toBeDefined()
    expect(s().turn).toBe('human')

    let guard = 0
    while (s().phase === 'battle' && guard++ < 300) {
      for (const ship of s().otterBoard.ships) {
        if (s().phase !== 'battle') break
        for (const c of ship.cells) {
          if (s().phase !== 'battle') break
          if (s().fireAt(c)) s().otterTurn()
        }
      }
    }
    expect(s().phase).toBe('gameover')
    expect(s().winner).toBeDefined()
  })

  it('rejects illegal placements and duplicate shots', () => {
    const s = () => useGameStore.getState()
    s().startGame('hard')
    expect(s().placePlayerShip(FLEET[0], { x: 9, y: 9 }, 'horizontal')).toBe(false)
    expect(s().placePlayerShip(FLEET[0], { x: 0, y: 0 }, 'horizontal')).toBe(true)
    s().autoPlacePlayerFleet()
    s().confirmPlacement()
    expect(s().fireAt({ x: 3, y: 3 })).toBeDefined()
    s().otterTurn()
    expect(s().fireAt({ x: 3, y: 3 })).toBeUndefined()
  })
})
