import { describe, expect, it } from 'vitest'

/** Tiny deterministic LCG so random placement is reproducible in tests. */
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
import {
  broadsideCells,
  createBoard,
  fire,
  FLEET,
  FLEET_BY_ID,
  FLEET_PRESETS,
  fleetCells,
  fleetUnits,
  hasTreasureAt,
  isFleetPlaced,
  placeShip,
  presetFleet,
  randomPlacement,
  removeShip,
  shipAt,
  touching,
  treasureCells,
  uidClass,
} from '.'

describe('Black Flag fleet presets', () => {
  it('has four presets that all cover 17 cells; Classic is the default FLEET', () => {
    expect(FLEET_PRESETS.map((p) => p.id)).toEqual(['classic', 'armada', 'wolf-pack', 'raiders'])
    for (const p of FLEET_PRESETS) expect(fleetCells(presetFleet(p.id)), p.id).toBe(17)
    expect(presetFleet('classic')).toEqual(FLEET)
    expect(presetFleet('armada').map((s) => s.length)).toEqual([5, 5, 4, 3])
    expect(presetFleet('wolf-pack').map((s) => s.length)).toEqual([3, 3, 3, 2, 2, 2, 2])
    expect(presetFleet('raiders').map((s) => s.length)).toEqual([4, 3, 3, 3, 2, 2])
  })

  it('gives repeated classes unique instance uids', () => {
    expect(fleetUnits(presetFleet('wolf-pack')).map((u) => u.uid)).toEqual(['frigate', 'brigantine', 'brigantine#2', 'sloop', 'sloop#2', 'sloop#3', 'sloop#4'])
    expect(fleetUnits(FLEET).map((u) => u.uid)).toEqual(FLEET.map((s) => s.id))
    expect(uidClass('sloop#3')).toBe('sloop')
    expect(uidClass('galleon')).toBe('galleon')
  })
})

describe('duplicate-class placement', () => {
  const sloop = FLEET_BY_ID.sloop
  it('places, replaces and removes ships of the same class by uid', () => {
    let board = placeShip(createBoard(), sloop, { x: 0, y: 0 }, 'horizontal', 'sloop')!
    board = placeShip(board, sloop, { x: 0, y: 2 }, 'horizontal', 'sloop#2')!
    expect(board.ships.map((s) => s.uid)).toEqual(['sloop', 'sloop#2'])
    // moving sloop#2 replaces that instance only
    board = placeShip(board, sloop, { x: 5, y: 5 }, 'vertical', 'sloop#2')!
    expect(board.ships).toHaveLength(2)
    expect(shipAt(board, { x: 5, y: 6 })?.uid).toBe('sloop#2')
    expect(shipAt(board, { x: 0, y: 2 })).toBeUndefined()
    // overlapping the other instance is refused
    expect(() => placeShip(board, sloop, { x: 0, y: 0 }, 'horizontal', 'sloop#2')).toThrow()
    board = removeShip(board, 'sloop')
    expect(board.ships.map((s) => s.uid)).toEqual(['sloop#2'])
  })

  it('isFleetPlaced / randomPlacement honour the chosen fleet', () => {
    const wolf = presetFleet('wolf-pack')
    const board = randomPlacement(lcg(37), wolf)
    expect(board.ships).toHaveLength(7)
    expect(new Set(board.ships.map((s) => s.uid)).size).toBe(7)
    expect(isFleetPlaced(board, wolf)).toBe(true)
    expect(isFleetPlaced(board, FLEET)).toBe(false)
    expect(isFleetPlaced(randomPlacement(lcg(37)), FLEET)).toBe(true)
  })

  it('fire() hits and sinks the right instance and reports its uid', () => {
    let board = placeShip(createBoard(), sloop, { x: 0, y: 0 }, 'horizontal', 'sloop')!
    board = placeShip(board, sloop, { x: 0, y: 2 }, 'horizontal', 'sloop#2')!
    let r = fire(board, { x: 0, y: 2 })
    expect(r.result).toMatchObject({ outcome: 'hit', shipId: 'sloop', shipUid: 'sloop#2' })
    r = fire(r.board, { x: 1, y: 2 })
    expect(r.result).toMatchObject({ outcome: 'sunk', shipId: 'sloop', shipUid: 'sloop#2' })
    expect(r.board.ships.find((s) => s.uid === 'sloop')!.hits).toHaveLength(0)
  })
})

describe('broadsideCells', () => {
  it('is a 3-cell line centred on the target, clipped at the edges', () => {
    expect(broadsideCells({ x: 4, y: 3 }, 'horizontal')).toEqual([
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 5, y: 3 },
    ])
    expect(broadsideCells({ x: 4, y: 3 }, 'vertical')).toEqual([
      { x: 4, y: 2 },
      { x: 4, y: 3 },
      { x: 4, y: 4 },
    ])
    expect(broadsideCells({ x: 0, y: 0 }, 'horizontal')).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ])
    expect(broadsideCells({ x: 9, y: 9 }, 'vertical')).toEqual([
      { x: 9, y: 8 },
      { x: 9, y: 9 },
    ])
  })
})

describe('treasureCells', () => {
  it('hides two chests in open water, never touching each other, deterministically', () => {
    const board = randomPlacement(lcg(42))
    let n = 0
    const rng = () => ((n++ * 7919) % 1000) / 1000
    const chests = treasureCells(board, rng)
    expect(chests).toHaveLength(2)
    for (const c of chests) expect(shipAt(board, c)).toBeUndefined()
    expect(touching(chests[0], chests[1])).toBe(false)
    expect(hasTreasureAt(chests, chests[1])).toBe(true)
    n = 0
    expect(treasureCells(board, rng)).toEqual(chests)
  })
})
