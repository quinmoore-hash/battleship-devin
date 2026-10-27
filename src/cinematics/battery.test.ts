import { describe, expect, it } from 'vitest'
import { FLEET, type PlacedShip, type ShotResult } from '../engine'
import { BOARD_LAYOUT, cellToWorld } from '../scene/layout'
import { navyLineMuzzles, pickBattery, planShot } from './battery'

const spec = (id: PlacedShip['spec']['id']) => FLEET.find((s) => s.id === id)!
const ship = (id: PlacedShip['spec']['id'], x: number, y: number, orientation: 'horizontal' | 'vertical' = 'horizontal', hits: PlacedShip['hits'] = []): PlacedShip => {
  const s = spec(id)
  const cells = Array.from({ length: s.length }, (_, i) => (orientation === 'horizontal' ? { x: x + i, y } : { x, y: y + i }))
  return { spec: s, uid: s.id, origin: { x, y }, orientation, cells, hits }
}

const player = BOARD_LAYOUT.player.origin
const enemy = BOARD_LAYOUT.enemy.origin

describe('pickBattery', () => {
  // player board: ships at rows 0..9 (row 0 is nearest the enemy waters, z = origin.z + 0.5)
  const fleet = [ship('man-o-war', 0, 8), ship('frigate', 2, 1), ship('sloop', 7, 5, 'vertical')]
  it('picks the nearest afloat ship to the target cell', () => {
    expect(pickBattery(fleet, { x: 2, y: 9 }, player, enemy)?.shipId).toBe('frigate')
    expect(pickBattery([fleet[0], fleet[2]], { x: 8, y: 0 }, player, enemy)?.shipId).toBe('sloop')
  })
  it('skips sunk ships', () => {
    const sunkFrigate = ship('frigate', 2, 1, 'horizontal', Array.from({ length: spec('frigate').length }, (_, i) => ({ x: 2 + i, y: 1 })))
    expect(pickBattery([sunkFrigate, ship('man-o-war', 0, 8)], { x: 2, y: 9 }, player, enemy)?.shipId).toBe('man-o-war')
    expect(pickBattery([sunkFrigate], { x: 2, y: 9 }, player, enemy)).toBeNull()
  })
  it('fires from the side facing the target with the nearest guns', () => {
    // horizontal ship, bow +x: enemy waters are at smaller z, which is the ship's port (local +z is starboard? let facingSide decide)
    const b = pickBattery([ship('frigate', 2, 1)], { x: 2, y: 9 }, player, enemy)!
    expect(['port', 'starboard']).toContain(b.side)
    expect(b.cells.length).toBeGreaterThan(0)
    expect(b.cells.length).toBeLessThanOrEqual(3)
    // the target is far to port/starboard and dead abeam the stern-most cell → the chosen guns cluster near the bow (x=2 cell 0)
    expect(Math.max(...b.cells)).toBeLessThanOrEqual(2)
  })
  it('a sloop fires both guns of a side', () => {
    const b = pickBattery([ship('sloop', 7, 5, 'vertical')], { x: 8, y: 0 }, player, enemy)!
    expect(b.shipId).toBe('sloop')
    expect(b.cells).toEqual([0, 1])
  })
})

describe('planShot', () => {
  const human = [ship('frigate', 2, 1)]
  const navy = [ship('galleon', 4, 4)]
  const miss: ShotResult = { coord: { x: 0, y: 0 }, outcome: 'miss' }
  const hit: ShotResult = { coord: { x: 5, y: 4 }, outcome: 'hit' }
  it('a miss lands on the water at the target cell', () => {
    const p = planShot('human', miss, human, navy)
    expect(p.impact).toEqual(cellToWorld(miss.coord, enemy))
    expect(p.muzzles.length).toBeGreaterThan(0)
    expect(p.shooter).not.toBeNull()
    expect(p.victim).toBeUndefined()
  })
  it('a hit lands on the hidden hull above the water, inside the target cell', () => {
    const p = planShot('human', hit, human, navy)
    const c = cellToWorld(hit.coord, enemy)
    expect(p.victim?.ship.spec.id).toBe('galleon')
    expect(p.victim?.cellIndex).toBe(1)
    expect(p.impact[1]).toBeGreaterThan(c[1])
    expect(Math.abs(p.impact[0] - c[0])).toBeLessThan(0.51)
    expect(Math.abs(p.impact[2] - c[2])).toBeLessThan(1.5)
  })
  it('a shot lost in the storm comes down off the target cell, on the water, with no victim', () => {
    const lost: ShotResult = { coord: { x: 5, y: 4 }, outcome: 'lost' }
    const p = planShot('human', lost, human, navy)
    const c = cellToWorld(lost.coord, enemy)
    expect(p.victim).toBeUndefined()
    expect(p.impact[1]).toBe(c[1])
    const off = Math.hypot(p.impact[0] - c[0], p.impact[2] - c[2])
    expect(off).toBeGreaterThan(0.6)
    expect(off).toBeLessThan(1.2)
    expect(planShot('human', lost, human, navy).impact).toEqual(p.impact) // deterministic
  })

  it('the Navy fires from its gun line when it has no afloat ship to fire from', () => {
    const p = planShot('enemy', { coord: { x: 3, y: 1 }, outcome: 'hit' }, [], human)
    expect(p.shooter).toBeNull()
    expect(p.muzzles).toHaveLength(3)
    expect(p.muzzles.every((m) => m.position[2] < enemy[2])).toBe(true)
    expect(p.victim?.ship.spec.id).toBe('frigate')
  })
  it('the Navy line sits past the far edge, centred on the target column', () => {
    const m = navyLineMuzzles({ x: 9, y: 0 })
    expect(m[1].position[0]).toBeCloseTo(enemy[0] + 9.5)
  })
})
