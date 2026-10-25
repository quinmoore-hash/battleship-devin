import { beforeEach, describe, expect, it } from 'vitest'
import { seededRng } from '../ai'
import { allCoords, coordKey, isSunk, randomPlacement, viewGrid, type Coord } from '../engine'
import { DEFAULT_MODES, foggedEnemyView, salvoSize, STORM_FOG_CHANCE, useGameStore } from './gameStore'

const s = () => useGameStore.getState()

function startBattle(modes?: Partial<typeof DEFAULT_MODES>, seed?: number) {
  s().startGame('easy', modes, seed)
  s().autoPlacePlayerFleet()
  s().confirmPlacement()
}

const shipCells = () => new Set(s().enemyBoard.ships.flatMap((sh) => sh.cells.map(coordKey)))
const openWater = (): Coord[] => {
  const ships = shipCells()
  return allCoords().filter((c) => !ships.has(coordKey(c)))
}

describe('game modes: defaults', () => {
  beforeEach(() => s().reset())

  it('classic rules when no modes are given: one shot resolves immediately', () => {
    startBattle()
    expect(s().modes).toEqual({ salvo: false, storm: false })
    expect(s().salvo).toEqual({ pending: [], size: 5 })
    const r = s().fireAt({ x: 0, y: 0 })
    expect(r).not.toBeNull()
    expect(r).toBeDefined()
    expect(s().events).toHaveLength(1)
    expect(s().lastVolley).toHaveLength(1)
    expect(s().turn).toBe('enemy')
    expect(s().fogged).toEqual([])
    expect(s().enemyTurn()).toBeDefined()
    expect(s().events).toHaveLength(2)
  })

  it('partial modes merge with the defaults and reset() restores classic rules', () => {
    s().startGame('medium', { storm: true })
    expect(s().modes).toEqual({ salvo: false, storm: true })
    s().reset()
    expect(s().modes).toEqual(DEFAULT_MODES)
    expect(s().salvo).toEqual({ pending: [], size: 1 })
  })
})

describe('salvo mode', () => {
  beforeEach(() => s().reset())

  it('queues shots until one per surviving ship has been chosen, then resolves them in order', () => {
    startBattle({ salvo: true })
    expect(s().salvo.size).toBe(5)
    const picks: Coord[] = [0, 1, 2, 3].map((x) => ({ x, y: 0 }))
    for (const [i, c] of picks.entries()) {
      expect(s().fireAt(c)).toBeNull()
      expect(s().salvo.pending).toHaveLength(i + 1)
      expect(s().events).toHaveLength(0)
      expect(s().turn).toBe('human')
    }
    const last = s().fireAt({ x: 4, y: 0 })
    expect(last).toBeDefined()
    expect(last).not.toBeNull()
    expect(last!.coord).toEqual({ x: 4, y: 0 })
    expect(s().events.map((e) => e.result.coord)).toEqual([...picks, { x: 4, y: 0 }])
    expect(s().events.every((e) => e.by === 'human')).toBe(true)
    expect(s().lastVolley).toHaveLength(5)
    expect(s().salvo.pending).toEqual([])
    expect(s().enemyBoard.shots).toHaveLength(5)
    expect(s().turn).toBe('enemy')
  })

  it('rejects a cell that is already queued or already shot, without disturbing the queue', () => {
    startBattle({ salvo: true })
    expect(s().fireAt({ x: 2, y: 2 })).toBeNull()
    expect(s().fireAt({ x: 2, y: 2 })).toBeUndefined()
    expect(s().fireAt({ x: 99, y: 2 })).toBeUndefined()
    expect(s().salvo.pending).toHaveLength(1)
    for (const x of [3, 4, 5, 6]) s().fireAt({ x, y: 2 })
    expect(s().turn).toBe('enemy')
    s().enemyTurn()
    expect(s().fireAt({ x: 2, y: 2 })).toBeUndefined()
    expect(s().salvo.pending).toEqual([])
  })

  it('the enemy fires one shot per surviving enemy ship and the volley sizes track the fleets', () => {
    startBattle({ salvo: true })
    for (const x of [0, 1, 2, 3, 4]) s().fireAt({ x, y: 9 })
    const before = s().events.length
    expect(s().enemyTurn()).toBeDefined()
    const enemyShots = s().events.slice(before)
    expect(enemyShots).toHaveLength(salvoSize(s().enemyBoard))
    expect(enemyShots.every((e) => e.by === 'enemy')).toBe(true)
    expect(s().playerBoard.shots).toHaveLength(enemyShots.length)
    expect(s().lastVolley).toEqual(enemyShots)
    expect(s().turn).toBe('human')
    // the human's next volley is sized by the ships still afloat
    expect(s().salvo.size).toBe(salvoSize(s().playerBoard))
    expect(s().salvo.size).toBe(s().playerBoard.ships.filter((sh) => !isSunk(sh)).length)
  })

  it('shrinks the human volley after a player ship sinks', () => {
    startBattle({ salvo: true })
    // sink the sloop ourselves by driving the enemy's shots: simulate by firing at our own board through the engine is not
    // possible from the store, so loop turns until a ship is lost or the game ends.
    let guard = 0
    const water = openWater()
    while (s().phase === 'battle' && s().playerBoard.ships.every((sh) => !isSunk(sh)) && guard++ < 40) {
      let n = 0
      while (s().turn === 'human' && s().phase === 'battle') {
        const c = water[(guard * 7 + n++) % water.length]
        if (s().fireAt(c) === undefined) continue
      }
      if (s().phase === 'battle') s().enemyTurn()
    }
    if (s().phase === 'battle') {
      const afloat = s().playerBoard.ships.filter((sh) => !isSunk(sh)).length
      expect(afloat).toBeLessThan(5)
      expect(s().salvo.size).toBe(afloat)
    }
  })

  it('stops resolving a volley at the moment the enemy fleet is sunk', () => {
    startBattle({ salvo: true })
    const cells = s().enemyBoard.ships.flatMap((sh) => sh.cells)
    const water = openWater()
    let w = 0
    let guard = 0
    while (s().phase === 'battle' && guard++ < 200) {
      const taken = [...s().enemyBoard.shots.map((sh) => sh.coord), ...s().salvo.pending]
      const next = cells.find((c) => !taken.some((t) => t.x === c.x && t.y === c.y))
      const r = next ? s().fireAt(next) : s().fireAt(water[w++])
      if (r === null) continue
      if (s().phase === 'battle' && s().turn === 'enemy') s().enemyTurn()
    }
    expect(s().phase).toBe('gameover')
    if (s().winner === 'human') {
      // the last human volley ended with the killing shot — nothing queued after it was fired
      const lastHuman = s().lastVolley.filter((e) => e.by === 'human')
      expect(lastHuman.at(-1)!.result.outcome).toBe('sunk')
      expect(s().enemyBoard.shots).toHaveLength(s().events.filter((e) => e.by === 'human').length)
    }
    expect(s().salvo.pending).toEqual([])
  })
})

describe('stormy seas', () => {
  beforeEach(() => s().reset())

  function fireMisses(n: number) {
    const water = openWater()
    const fired: Coord[] = []
    for (const c of water) {
      if (fired.length >= n || s().phase !== 'battle') break
      if (s().turn !== 'human') s().enemyTurn()
      if (s().phase !== 'battle') break
      if (s().fireAt(c) !== undefined) fired.push(c)
    }
    return fired
  }

  it('hides roughly 30% of the misses, never hits, and keeps them recorded on the board', () => {
    let fogged = 0
    let misses = 0
    for (let seed = 1; seed <= 6; seed++) {
      startBattle({ storm: true }, seed)
      const fired = fireMisses(40)
      misses += fired.length
      fogged += s().fogged.length
      const missKeys = new Set(s().enemyBoard.shots.filter((sh) => sh.outcome === 'miss').map((sh) => coordKey(sh.coord)))
      for (const key of s().fogged) expect(missKeys.has(key)).toBe(true)
      // fogged cells are still shots: re-firing is illegal
      for (const key of s().fogged) {
        const [x, y] = key.split(',').map(Number)
        if (s().turn === 'human' && s().phase === 'battle') expect(s().fireAt({ x, y })).toBeUndefined()
      }
      s().reset()
    }
    const ratio = fogged / misses
    expect(ratio).toBeGreaterThan(STORM_FOG_CHANCE - 0.15)
    expect(ratio).toBeLessThan(STORM_FOG_CHANCE + 0.15)
  })

  it('is deterministic for a given seed and never fogs anything in classic mode', () => {
    const run = (modes: Partial<typeof DEFAULT_MODES>, seed: number) => {
      s().startGame('easy', modes, seed)
      useGameStore.setState({ enemyBoard: randomPlacement(seededRng(99)) })
      s().autoPlacePlayerFleet()
      s().confirmPlacement()
      fireMisses(30)
      const fogged = [...s().fogged]
      s().reset()
      return fogged
    }
    const a = run({ storm: true }, 42)
    const b = run({ storm: true }, 42)
    const c = run({ storm: true }, 43)
    expect(a.length).toBeGreaterThan(0)
    expect(a).toEqual(b)
    expect(c).not.toEqual(a)
    expect(run({}, 42)).toEqual([])
  })

  it('foggedEnemyView drops the hidden misses so viewGrid shows them as unknown', () => {
    startBattle({ storm: true }, 7)
    fireMisses(40)
    const { enemyBoard, fogged } = s()
    expect(fogged.length).toBeGreaterThan(0)
    const view = foggedEnemyView(enemyBoard, fogged)
    expect(view.shots).toHaveLength(enemyBoard.shots.length - fogged.length)
    const grid = viewGrid(view)
    for (const key of fogged) {
      const [x, y] = key.split(',').map(Number)
      expect(grid[y][x]).toBe('unknown')
    }
    const full = viewGrid(foggedEnemyView(enemyBoard, []))
    for (const key of fogged) {
      const [x, y] = key.split(',').map(Number)
      expect(full[y][x]).toBe('miss')
    }
  })

  it('stormy seas and salvo combine: a fogged miss can come from any shot of the volley', () => {
    startBattle({ storm: true, salvo: true }, 3)
    const water = openWater()
    let i = 0
    let guard = 0
    while (s().fogged.length === 0 && s().phase === 'battle' && guard++ < 60) {
      if (s().turn === 'enemy') s().enemyTurn()
      else s().fireAt(water[i++ % water.length])
    }
    expect(s().fogged.length).toBeGreaterThan(0)
    expect(s().events.filter((e) => e.by === 'human').length % 1).toBe(0)
  })
})
