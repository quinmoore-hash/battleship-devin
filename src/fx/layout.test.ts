import { describe, expect, it } from 'vitest'
import { FLEET_BY_ID } from '../engine'
import {
  BOARD_LAYOUT,
  cellIndexOnShip,
  cellOffsetAlongShip,
  cellToWorld,
  hashString,
  seededRandom,
  shipCells,
  shipCenter,
  shipPhase,
  shipRotationY,
} from './layout'

describe('cellToWorld', () => {
  it('centres the board on its origin', () => {
    expect(cellToWorld({ x: 0, y: 0 })).toEqual([-4.5, 0, -4.5])
    expect(cellToWorld({ x: 9, y: 9 })).toEqual([4.5, 0, 4.5])
    const [x, , z] = cellToWorld({ x: 4, y: 4 })
    const [x2, , z2] = cellToWorld({ x: 5, y: 5 })
    expect((x + x2) / 2).toBeCloseTo(0)
    expect((z + z2) / 2).toBeCloseTo(0)
  })
  it('applies board origin and cell size', () => {
    expect(cellToWorld({ x: 0, y: 0 }, BOARD_LAYOUT.otter.origin)).toEqual([-4.5, 0, -18.5])
    expect(cellToWorld({ x: 1, y: 0 }, [10, 2, 0], 2)).toEqual([10 - 7, 2, -9])
  })
})

describe('ship geometry helpers', () => {
  const carrier = FLEET_BY_ID['kelp-carrier']
  const patrol = FLEET_BY_ID['pebble-patrol']

  it('lists the cells of a ship', () => {
    expect(shipCells(patrol, { x: 2, y: 3 }, 'horizontal')).toEqual([
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ])
    expect(shipCells(patrol, { x: 2, y: 3 }, 'vertical')).toEqual([
      { x: 2, y: 3 },
      { x: 2, y: 4 },
    ])
  })

  it('finds the centre of a horizontal and a vertical ship', () => {
    expect(shipCenter(carrier, { x: 0, y: 0 }, 'horizontal')).toEqual([-2.5, 0, -4.5])
    expect(shipCenter(carrier, { x: 0, y: 0 }, 'vertical')).toEqual([-4.5, 0, -2.5])
  })

  it('rotates vertical ships to run along +z', () => {
    expect(shipRotationY('horizontal')).toBe(0)
    expect(shipRotationY('vertical')).toBeCloseTo(-Math.PI / 2)
  })

  it('maps hit cells to an index along the ship', () => {
    const ship = { spec: carrier, origin: { x: 2, y: 5 }, orientation: 'horizontal' as const }
    expect(cellIndexOnShip(ship, { x: 2, y: 5 })).toBe(0)
    expect(cellIndexOnShip(ship, { x: 6, y: 5 })).toBe(4)
    expect(cellIndexOnShip(ship, { x: 7, y: 5 })).toBe(-1)
    expect(cellIndexOnShip(ship, { x: 3, y: 6 })).toBe(-1)
    const vert = { ...ship, orientation: 'vertical' as const }
    expect(cellIndexOnShip(vert, { x: 2, y: 7 })).toBe(2)
  })

  it('offsets cells symmetrically around the ship centre', () => {
    expect(cellOffsetAlongShip(5, 0)).toBe(-2)
    expect(cellOffsetAlongShip(5, 4)).toBe(2)
    expect(cellOffsetAlongShip(2, 0, 2)).toBe(-1)
    expect(cellOffsetAlongShip(2, 1, 2)).toBe(1)
  })
})

describe('determinism helpers', () => {
  it('hashes strings stably', () => {
    expect(hashString('otter')).toBe(hashString('otter'))
    expect(hashString('otter')).not.toBe(hashString('Otter'))
  })
  it('gives each ship a stable phase in [0, 2π)', () => {
    const a = shipPhase({ spec: FLEET_BY_ID['stream-sub'], origin: { x: 1, y: 1 } })
    const b = shipPhase({ spec: FLEET_BY_ID['stream-sub'], origin: { x: 1, y: 2 } })
    expect(a).toBe(shipPhase({ spec: FLEET_BY_ID['stream-sub'], origin: { x: 1, y: 1 } }))
    expect(a).not.toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(Math.PI * 2)
  })
  it('seeded random is repeatable and in [0,1)', () => {
    const r1 = seededRandom(42)
    const r2 = seededRandom(42)
    for (let i = 0; i < 20; i++) {
      const v = r1()
      expect(v).toBe(r2())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
