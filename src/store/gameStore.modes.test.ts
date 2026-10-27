import { beforeEach, describe, expect, it } from 'vitest'
import { seededRng } from '../ai'
import { allCoords, coordKey, enemyView, fire, hasBeenShot, isSunk, randomPlacement, viewGrid, type Coord } from '../engine'
import { DEFAULT_MODES, lostShots, salvoSize, STORM_LOST_CHANCE, useGameStore } from './gameStore'

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
    expect(s().modes).toEqual({ salvo: false, storm: false, blackFlag: false })
    expect(s().salvo).toEqual({ pending: [], size: 5 })
    const r = s().fireAt({ x: 0, y: 0 })
    expect(r).not.toBeNull()
    expect(r).toBeDefined()
    expect(s().events).toHaveLength(1)
    expect(s().lastVolley).toHaveLength(1)
    expect(s().turn).toBe('enemy')
    expect(lostShots(s().events)).toEqual([])
    expect(s().enemyTurn()).toBeDefined()
    expect(s().events).toHaveLength(2)
  })

  it('partial modes merge with the defaults and reset() remembers them for the next battle (BUG-320)', () => {
    s().startGame('medium', { storm: true })
    expect(s().modes).toEqual({ salvo: false, storm: true, blackFlag: false })
    s().reset()
    expect(s().modes).toEqual({ salvo: false, storm: true, blackFlag: false })
    expect(s().salvo).toEqual({ pending: [], size: 1 })
    s().setModes({ storm: false })
    expect(s().modes).toEqual(DEFAULT_MODES)
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

describe('stormy seas: shots lost in the storm', () => {
  beforeEach(() => s().reset())

  /** Plays whole turns (human shot/volley + enemy reply) on a fixed cell list until `n` human shots were fired or the game ends. */
  function playTurns(n: number, cells: Coord[] = allCoords()) {
    let i = 0
    let fired = 0
    let guard = 0
    while (fired < n && s().phase === 'battle' && guard++ < 2000) {
      if (s().turn === 'enemy') {
        s().enemyTurn()
        continue
      }
      const c = cells[i++ % cells.length]
      const r = s().fireAt(c)
      if (r !== undefined) fired++
    }
  }

  it('a lost shot consumes the turn, deals no damage, leaves no mark and the square can be fired at again', () => {
    // find a seed whose very first roll is "lost" (deterministic: seededRng(seed)() < 0.3)
    let seed = 1
    while (seededRng(seed)() >= STORM_LOST_CHANCE) seed++
    startBattle({ storm: true }, seed)
    const before = s().enemyBoard
    const r = s().fireAt({ x: 4, y: 4 })
    expect(r).toEqual({ coord: { x: 4, y: 4 }, outcome: 'lost' })
    expect(s().events).toHaveLength(1)
    expect(s().events[0].by).toBe('human')
    expect(s().lastVolley).toEqual(s().events)
    expect(s().enemyBoard).toBe(before) // untouched: no shot recorded, no hit
    expect(hasBeenShot(s().enemyBoard, { x: 4, y: 4 })).toBe(false)
    expect(viewGrid(enemyView(s().enemyBoard))[4][4]).toBe('unknown')
    expect(s().turn).toBe('enemy') // the turn is spent
    expect(s().fireAt({ x: 4, y: 4 })).toBeUndefined() // not our turn
    s().enemyTurn()
    expect(s().turn).toBe('human')
    // re-firing the same square is legal and rolls again
    const again = s().fireAt({ x: 4, y: 4 })
    expect(again).toBeDefined()
    expect(again).not.toBeNull()
    expect(['lost', 'miss', 'hit', 'sunk']).toContain(again!.outcome)
    if (again!.outcome !== 'lost') expect(hasBeenShot(s().enemyBoard, { x: 4, y: 4 })).toBe(true)
  })

  it('roughly 30% of every shot is lost, for both sides, and lost shots never touch either board', () => {
    let lostH = 0
    let lostE = 0
    let shotsH = 0
    let shotsE = 0
    for (let seed = 1; seed <= 8; seed++) {
      startBattle({ storm: true }, seed)
      playTurns(40)
      const ev = s().events
      const h = ev.filter((e) => e.by === 'human')
      const e = ev.filter((e) => e.by === 'enemy')
      shotsH += h.length
      shotsE += e.length
      lostH += lostShots(ev, 'human').length
      lostE += lostShots(ev, 'enemy').length
      // the boards only hold the shots that landed
      expect(s().enemyBoard.shots).toHaveLength(h.length - lostShots(ev, 'human').length)
      expect(s().playerBoard.shots).toHaveLength(e.length - lostShots(ev, 'enemy').length)
      for (const sh of [...s().enemyBoard.shots, ...s().playerBoard.shots]) expect(sh.outcome).not.toBe('lost')
      s().reset()
    }
    expect(lostH / shotsH).toBeGreaterThan(STORM_LOST_CHANCE - 0.12)
    expect(lostH / shotsH).toBeLessThan(STORM_LOST_CHANCE + 0.12)
    expect(lostE / shotsE).toBeGreaterThan(STORM_LOST_CHANCE - 0.12)
    expect(lostE / shotsE).toBeLessThan(STORM_LOST_CHANCE + 0.12)
  })

  it('a lost hit does no damage: the ship is only hit when the shot lands', () => {
    startBattle({ storm: true }, 5)
    const sloop = s().enemyBoard.ships.find((sh) => sh.spec.id === 'sloop')!
    let guard = 0
    while (s().phase === 'battle' && !isSunk(s().enemyBoard.ships.find((sh) => sh.spec.id === 'sloop')!) && guard++ < 60) {
      if (s().turn === 'enemy') {
        s().enemyTurn()
        continue
      }
      const hitsBefore = s().enemyBoard.ships.find((sh) => sh.spec.id === 'sloop')!.hits.length
      const cell = sloop.cells.find((c) => !hasBeenShot(s().enemyBoard, c))!
      const r = s().fireAt(cell)!
      const hitsAfter = s().enemyBoard.ships.find((sh) => sh.spec.id === 'sloop')!.hits.length
      if (r.outcome === 'lost') expect(hitsAfter).toBe(hitsBefore)
      else expect(hitsAfter).toBe(hitsBefore + 1)
    }
    expect(lostShots(s().events, 'human').length + s().enemyBoard.ships.find((sh) => sh.spec.id === 'sloop')!.hits.length).toBe(s().events.filter((e) => e.by === 'human').length)
  })

  it('is deterministic for a seed and nothing is ever lost outside stormy seas', () => {
    const run = (modes: Partial<typeof DEFAULT_MODES>, seed: number) => {
      s().startGame('easy', modes, seed)
      useGameStore.setState({ enemyBoard: randomPlacement(seededRng(99)) })
      s().autoPlacePlayerFleet()
      s().confirmPlacement()
      playTurns(30)
      const lost = s().events.filter((e) => e.by === 'human').map((e) => e.result.outcome === 'lost')
      s().reset()
      return lost
    }
    const a = run({ storm: true }, 42)
    expect(a).toContain(true)
    expect(run({ storm: true }, 42)).toEqual(a)
    expect(run({ storm: true }, 43)).not.toEqual(a)
    expect(run({}, 42)).not.toContain(true)
    expect(run({ salvo: true }, 42)).not.toContain(true)
  })

  it('salvo + stormy seas: every shot of the volley rolls on its own; lost shots stay in the volley and keep their square open', () => {
    startBattle({ storm: true, salvo: true }, 3)
    const water = openWater()
    let guard = 0
    while (lostShots(s().events, 'human').length === 0 && s().phase === 'battle' && guard++ < 40) {
      if (s().turn === 'enemy') s().enemyTurn()
      else for (const c of water.splice(0, 5)) s().fireAt(c)
    }
    const volley = s().events.filter((e) => e.by === 'human').slice(-5)
    expect(volley).toHaveLength(5)
    const lost = volley.filter((e) => e.result.outcome === 'lost')
    expect(lost.length).toBeGreaterThan(0)
    expect(lost.length).toBeLessThan(5)
    for (const e of lost) expect(hasBeenShot(s().enemyBoard, e.result.coord)).toBe(false)
    for (const e of volley.filter((e) => e.result.outcome !== 'lost')) expect(hasBeenShot(s().enemyBoard, e.result.coord)).toBe(true)
    expect(s().salvo.pending).toEqual([])
  })

  it('the AI never re-fires at a known square, re-targets lost squares and never gets stuck (all difficulties)', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      for (let seed = 1; seed <= 3; seed++) {
        s().startGame(difficulty, { storm: true, salvo: seed === 3 }, seed * 11)
        s().autoPlacePlayerFleet()
        s().confirmPlacement()
        const cells = allCoords()
        let guard = 0
        while (s().phase === 'battle' && guard++ < 1500) {
          if (s().turn === 'enemy') s().enemyTurn()
          else s().fireAt(cells.find((c) => !hasBeenShot(s().enemyBoard, c))!)
        }
        expect(s().phase).toBe('gameover')
        const enemyShots = s().events.filter((e) => e.by === 'enemy')
        const landed = enemyShots.filter((e) => e.result.outcome !== 'lost')
        const keys = landed.map((e) => coordKey(e.result.coord))
        expect(new Set(keys).size).toBe(keys.length) // no landed square is ever fired at twice
        expect(s().playerBoard.shots).toHaveLength(landed.length)
        // lost squares came back: at least one lost coord was fired at again later (over three seeds this always happens)
        if (seed === 1) {
          const lostKeys = lostShots(s().events, 'enemy').map((e) => coordKey(e.result.coord))
          expect(lostKeys.some((k) => keys.includes(k))).toBe(true)
        }
        s().reset()
      }
    }
  })
})

describe('salvo mode: endgame', () => {
  beforeEach(() => s().reset())

  it('caps the volley at the unshot cells left so the last ship can still be sunk (BUG-548)', () => {
    startBattle({ salvo: true }, 7)
    const ships = [...shipCells()]
    const left = new Set(ships.slice(-2)) // the last two cells of the last ship
    let board = s().enemyBoard
    for (const c of allCoords()) if (!left.has(coordKey(c))) board = fire(board, c).board
    useGameStore.setState({ enemyBoard: board, salvo: { pending: [], size: 5 } })
    const [a, b] = allCoords().filter((c) => left.has(coordKey(c)))
    expect(s().fireAt(a)).toBeNull()
    expect(s().salvo.size).toBe(2)
    expect(s().fireAt(b)?.outcome).toBe('sunk')
    expect(s().phase).toBe('gameover')
    expect(s().winner).toBe('human')
  })
})
