import { beforeEach, describe, expect, it } from 'vitest'
import { allCoords, coordKey, FLEET, hasBeenShot, shipAt, type Coord, type Difficulty } from '../engine'
import { useGameStore, type GameModes } from './gameStore'

const s = () => useGameStore.getState()

function begin(difficulty: Difficulty, modes: Partial<GameModes> = {}, seed = 11) {
  s().reset()
  s().startGame(difficulty, { blackFlag: true, ...modes }, seed)
  s().autoPlacePlayerFleet()
  s().confirmPlacement()
  expect(s().phase).toBe('battle')
}

/** An open-water cell on the enemy board that is not a chest and has not been shot. */
const openWater = (): Coord => allCoords().find((c) => !shipAt(s().enemyBoard, c) && !hasBeenShot(s().enemyBoard, c) && !s().treasure.enemy.some((t) => coordKey(t) === coordKey(c)))!
const shipCell = (): Coord => allCoords().find((c) => shipAt(s().enemyBoard, c) && !hasBeenShot(s().enemyBoard, c))!

describe('Black Flag off: classic regression', () => {
  beforeEach(() => s().reset())
  it('keeps the classic fleet, no chests and no power shots', () => {
    s().startGame('easy')
    expect(s().modes).toEqual({ salvo: false, storm: false, blackFlag: false })
    expect(s().fleets.human).toEqual(FLEET)
    expect(s().enemyBoard.ships).toHaveLength(5)
    s().autoPlacePlayerFleet()
    s().confirmPlacement()
    expect(s().treasure).toEqual({ human: [], enemy: [] })
    expect(s().powerShots).toEqual({ human: { broadside: false, spyglass: false }, enemy: { broadside: false, spyglass: false } })
    expect(s().spyAt({ x: 0, y: 0 })).toBeUndefined()
    expect(s().fireBroadside({ x: 4, y: 4 }, 'horizontal')).toEqual([])
    expect(s().turn).toBe('human')
    expect(s().events).toHaveLength(0)
    expect(s().fireAt({ x: 0, y: 0 })).toBeDefined()
    expect(s().events.map((e) => e.kind)).toEqual(['shot'])
    expect(s().turn).toBe('enemy')
  })
})

describe('Black Flag setup', () => {
  it('lets the player pick a preset, gives the enemy a random one and buries two chests per board', () => {
    s().reset()
    s().startGame('easy', { blackFlag: true }, 5)
    expect(s().powerShots.human).toEqual({ broadside: true, spyglass: true })
    s().setFleetPreset('wolf-pack')
    expect(s().fleets.human.map((f) => f.length)).toEqual([3, 3, 3, 2, 2, 2, 2])
    expect(s().fleetPresets.human).toBe('wolf-pack')
    s().autoPlacePlayerFleet()
    expect(s().playerBoard.ships).toHaveLength(7)
    s().confirmPlacement()
    expect(s().enemyBoard.ships).toHaveLength(s().fleets.enemy.length)
    for (const side of ['human', 'enemy'] as const) {
      expect(s().treasure[side]).toHaveLength(2)
      const board = side === 'human' ? s().playerBoard : s().enemyBoard
      for (const t of s().treasure[side]) expect(shipAt(board, t)).toBeUndefined()
    }
  })

  it('is deterministic for a seed', () => {
    const run = () => {
      begin('hard', {}, 99)
      const picks = { preset: s().fleetPresets.enemy, treasure: s().treasure, ships: s().enemyBoard.ships.map((x) => x.cells) }
      for (const c of allCoords()) {
        if (s().phase !== 'battle') break
        if (s().turn === 'human' && s().fireAt(c) && s().turn === 'enemy') s().enemyTurn()
      }
      return { ...picks, events: s().events.map((e) => ({ ...e, id: 0, group: e.group === undefined ? undefined : 'g' })) }
    }
    expect(run()).toEqual(run())
  })
})

describe('Spyglass', () => {
  it('reveals a cell without firing or spending the turn, once per game', () => {
    begin('easy')
    const c = shipCell()
    expect(s().spyAt(c)).toBe('ship')
    expect(s().turn).toBe('human')
    expect(hasBeenShot(s().enemyBoard, c)).toBe(false)
    expect(s().events.at(-1)).toMatchObject({ kind: 'spyglass', by: 'human', spied: 'ship' })
    expect(s().spied.human).toEqual([{ coord: c, ship: true }])
    expect(s().powerShots.human.spyglass).toBe(false)
    expect(s().spyAt(openWater())).toBeUndefined()
    expect(s().events).toHaveLength(1)
  })
})

describe('Broadside', () => {
  it('fires a clipped line through the target, skips shot cells, spends the whole turn and is single-use', () => {
    begin('easy')
    const first = s().fireAt({ x: 1, y: 0 })
    expect(first).toBeDefined()
    s().enemyTurn()
    expect(s().turn).toBe('human')
    const before = s().events.length
    const balls = s().fireBroadside({ x: 0, y: 0 }, 'horizontal')
    // A1 ±1 along the row = A1, B1 (off-board skipped), B1 already shot → skipped: only A1 fires
    expect(balls.map((b) => b.coord)).toEqual([{ x: 0, y: 0 }])
    const added = s().events.slice(before)
    expect(added.every((e) => e.kind === 'broadside' || e.kind === 'treasure')).toBe(true)
    expect(new Set(added.map((e) => e.group)).size).toBe(1)
    expect(s().powerShots.human.broadside).toBe(false)
    if (s().turn === 'enemy') s().enemyTurn()
    expect(s().fireBroadside({ x: 5, y: 5 }, 'vertical')).toEqual([])
    const n = s().events.length
    const line = s().fireAt({ x: 5, y: 5 })
    expect(line).toBeDefined()
    expect(s().events.slice(n).map((e) => e.result.coord)).toEqual([{ x: 5, y: 5 }])
  })

  it('a full 3-ball line resolves three cells in one turn', () => {
    begin('easy')
    const balls = s().fireBroadside({ x: 4, y: 4 }, 'vertical')
    expect(balls.map((b) => b.coord)).toEqual([
      { x: 4, y: 3 },
      { x: 4, y: 4 },
      { x: 4, y: 5 },
    ])
    expect(s().turn).toBe(s().bonusShots > 0 ? 'human' : 'enemy')
  })
})

describe('Treasure', () => {
  it('classic: a chest grants one extra shot and marks the cell', () => {
    begin('easy')
    const chest = s().treasure.enemy[0]
    expect(s().fireAt(chest)).toMatchObject({ outcome: 'miss' })
    expect(s().events.at(-1)).toMatchObject({ kind: 'treasure', by: 'human' })
    expect(s().turn).toBe('human')
    expect(s().bonusShots).toBe(1)
    expect(s().fireAt(openWater())).toBeDefined()
    expect(s().turn).toBe('enemy')
    expect(s().bonusShots).toBe(0)
  })

  it('salvo: a chest adds one shot to the volley', () => {
    begin('easy', { salvo: true })
    const chest = s().treasure.enemy[0]
    const size = s().salvo.size
    expect(size).toBe(5)
    expect(s().fireAt(chest)).toBeNull()
    const rest = allCoords().filter((c) => coordKey(c) !== coordKey(chest) && !s().treasure.enemy.some((t) => coordKey(t) === coordKey(c)))
    for (let i = 0; i < size - 2; i++) expect(s().fireAt(rest[i])).toBeNull()
    expect(s().fireAt(rest[size - 2])).toBeDefined()
    expect(s().turn).toBe('human')
    expect(s().salvo.size).toBe(1)
    expect(s().fireAt(rest[size - 1])).toBeDefined()
    expect(s().turn).toBe('enemy')
  })

  it('stormy: the extra shot can still be lost to the fog', () => {
    begin('easy', { storm: true })
    useGameStore.setState({ fogRng: () => 0 }) // every miss fogs
    const chest = s().treasure.enemy[0]
    s().fireAt(chest)
    expect(s().turn).toBe('human')
    const bonus = openWater()
    s().fireAt(bonus)
    expect(s().fogged).toContain(coordKey(bonus))
    expect(s().turn).toBe('enemy')
  })
})

describe('AI power shots', () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    it(`${difficulty}: never fires at a known cell, uses each power at most once, treats chests as misses`, () => {
      begin(difficulty, {}, 3)
      for (const c of allCoords()) {
        if (s().phase !== 'battle') break
        if (s().turn === 'human' && s().fireAt(c) && s().turn === 'enemy') s().enemyTurn()
      }
      const enemy = s().events.filter((e) => e.by === 'enemy')
      const shots = enemy.filter((e) => e.kind !== 'spyglass')
      expect(new Set(shots.map((e) => coordKey(e.result.coord))).size).toBe(shots.length)
      const groups = new Set(enemy.filter((e) => e.kind === 'broadside').map((e) => e.group))
      expect(groups.size).toBeLessThanOrEqual(1)
      expect(enemy.filter((e) => e.kind === 'spyglass').length).toBeLessThanOrEqual(1)
      if (difficulty === 'easy') expect(groups.size + enemy.filter((e) => e.kind === 'spyglass').length).toBe(0)
      for (const e of enemy.filter((e) => e.kind === 'treasure')) expect(e.result.outcome).toBe('miss')
      // a spyglass look never lands on a cell already shot, and the looked-at cell is still shot at most once later
      for (const [i, e] of enemy.entries()) if (e.kind === 'spyglass') expect(enemy.slice(0, i).some((p) => p.kind !== 'spyglass' && coordKey(p.result.coord) === coordKey(e.result.coord))).toBe(false)
    })
  }
})
