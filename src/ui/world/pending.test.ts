import { describe, expect, it } from 'vitest'
import { FLEET_BY_ID, type PlacedShip } from '../../engine'
import type { GameEvent } from '../../store/gameStore'
import { maskPendingHit, settledWrecks, visibleShots, withoutFogged } from './pending'

const ship = (hits: { x: number; y: number }[], id = 'sloop'): PlacedShip => {
  const spec = FLEET_BY_ID[id as keyof typeof FLEET_BY_ID]
  const cells = Array.from({ length: spec.length }, (_, i) => ({ x: i, y: 0 }))
  return { spec, uid: spec.id, origin: { x: 0, y: 0 }, orientation: 'horizontal', cells, hits } as PlacedShip
}
const ev = (id: number, by: 'human' | 'enemy', x: number, y: number, outcome: 'hit' | 'miss' = 'hit'): GameEvent => ({ id, by, kind: 'shot', result: { coord: { x, y }, outcome } })

describe('visibleShots', () => {
  const events = [ev(1, 'human', 1, 1), ev(2, 'enemy', 2, 2, 'miss'), ev(3, 'human', 3, 3)]
  it('returns one side\'s shots in order', () => {
    expect(visibleShots(events, 'human', null).map((s) => s.coord.x)).toEqual([1, 3])
    expect(visibleShots(events, 'enemy', null).map((s) => s.coord.x)).toEqual([2])
  })
  it('hides the shot still in the air, only for the side that fired it', () => {
    expect(visibleShots(events, 'human', { by: 'human', target: { x: 3, y: 3 } }).map((s) => s.coord.x)).toEqual([1])
    expect(visibleShots(events, 'human', { by: 'enemy', target: { x: 3, y: 3 } }).map((s) => s.coord.x)).toEqual([1, 3])
  })
})

describe('maskPendingHit', () => {
  const ships = [ship([{ x: 0, y: 0 }, { x: 1, y: 0 }]), ship([], 'frigate')]
  it('is identity without a target or on a miss', () => {
    expect(maskPendingHit(ships, null)).toBe(ships)
    expect(maskPendingHit(ships, { x: 9, y: 9 })).toBe(ships)
  })
  it('removes the pending hit from its ship and leaves the others untouched', () => {
    const masked = maskPendingHit(ships, { x: 1, y: 0 })
    expect(masked[0].hits).toEqual([{ x: 0, y: 0 }])
    expect(masked[1]).toBe(ships[1])
    expect(ships[0].hits).toHaveLength(2)
  })
})

describe('settledWrecks', () => {
  const sunk = ship([{ x: 0, y: 0 }, { x: 1, y: 0 }])
  const afloat = ship([{ x: 0, y: 0 }], 'frigate')
  it('lists sunk ships whose sink animation is done or never ran', () => {
    expect(settledWrecks([sunk, afloat], {})).toEqual([sunk])
    expect(settledWrecks([sunk, afloat], { sloop: 1 })).toEqual([sunk])
  })
  it('waits while the director is still sinking the ship', () => {
    expect(settledWrecks([sunk, afloat], { sloop: 0.4 })).toEqual([])
  })
})

describe('withoutFogged (BUG-315)', () => {
  const shots = [ev(1, 'human', 1, 1).result, ev(2, 'human', 2, 2, 'miss').result, ev(3, 'human', 3, 3, 'miss').result]
  it('drops fogged misses and keeps everything else in order', () => {
    expect(withoutFogged(shots, ['2,2']).map((s) => s.coord.x)).toEqual([1, 3])
    expect(withoutFogged(shots, ['2,2', '3,3']).map((s) => s.coord.x)).toEqual([1])
  })
  it('never hides a hit, even if its key is listed', () => {
    expect(withoutFogged(shots, ['1,1']).map((s) => s.coord.x)).toEqual([1, 2, 3])
  })
  it('returns the same array when nothing is fogged', () => {
    expect(withoutFogged(shots, [])).toBe(shots)
  })
})
