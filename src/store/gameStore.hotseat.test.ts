import { beforeEach, describe, expect, it } from 'vitest'
import { FLEET, isFleetSunk, type Coord } from '../engine'
import { FLEET_PRESETS } from '../engine'
import { isHotSeat, placementBoard, useGameStore } from './gameStore'

const s = () => useGameStore.getState()

/** Menu → placement for both captains → battle (curtain down). */
function startHotSeat(modes = { salvo: false, storm: false }, seed = 3) {
  s().reset()
  s().setPlayers({ human: { name: 'Anne' }, enemy: { name: 'Jack', kind: 'local' } })
  s().startGame('medium', modes, seed)
  s().autoPlacePlayerFleet()
  s().confirmPlacement()
  expect(s().handoff).toBe('enemy')
  s().endHandoff()
  s().autoPlacePlayerFleet()
  s().confirmPlacement()
  expect(s().phase).toBe('battle')
  expect(s().handoff).toBe('human')
  s().endHandoff()
}

/** Plays `by`'s whole volley (one shot classic, one per surviving ship in salvo) at fresh cells. */
function volley(by: 'human' | 'enemy', cells: Iterator<Coord>) {
  let r = s().fireAt(cells.next().value, by)
  while (r === null) r = s().fireAt(cells.next().value, by)
  return r
}

function* sweep(): Generator<Coord> {
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) yield { x, y }
}

describe('hot-seat (Two captains)', () => {
  beforeEach(() => s().reset())

  it('setPlayers makes the enemy a local captain and keeps names across reset', () => {
    s().setPlayers({ human: { name: 'Anne' }, enemy: { name: 'Jack', kind: 'local' } })
    expect(isHotSeat(s().players)).toBe(true)
    expect(s().players.human.kind).toBe('local')
    s().reset()
    expect(s().players.enemy).toEqual({ name: 'Jack', kind: 'local' })
    s().setPlayers({ enemy: { kind: 'ai' } })
    expect(isHotSeat(s().players)).toBe(false)
    expect(s().players.enemy.name).toBe('Jack')
  })

  it('both captains place their own fleet with a curtain in between; no AI opponent exists', () => {
    s().setPlayers({ enemy: { kind: 'local' } })
    s().startGame('easy')
    expect(s().opponent).toBeUndefined()
    expect(s().enemyBoard.ships).toHaveLength(0)
    expect(s().placing).toBe('human')
    s().autoPlacePlayerFleet()
    expect(s().playerBoard.ships).toHaveLength(FLEET.length)
    s().confirmPlacement()
    expect(s().phase).toBe('placement')
    expect(s().placing).toBe('enemy')
    expect(s().handoff).toBe('enemy')
    // the curtain blocks nothing in the store but the UI hides both boards; the next captain places on their own board
    s().endHandoff()
    expect(s().handoff).toBeNull()
    expect(placementBoard(s()).ships).toHaveLength(0)
    s().placePlayerShip(FLEET[0], { x: 0, y: 0 }, 'horizontal')
    expect(s().enemyBoard.ships).toHaveLength(1)
    expect(s().playerBoard.ships).toHaveLength(FLEET.length)
    s().removePlayerShip(FLEET[0].id)
    expect(s().enemyBoard.ships).toHaveLength(0)
    s().confirmPlacement()
    expect(s().phase).toBe('placement')
    s().autoPlacePlayerFleet()
    s().confirmPlacement()
    expect(s().phase).toBe('battle')
    expect(s().turn).toBe('human')
    expect(s().handoff).toBe('human')
    expect(s().perspective).toBe('human')
  })

  it('alternates fireAt between the two captains without the AI; enemyTurn is a no-op', () => {
    startHotSeat()
    expect(s().fireAt({ x: 0, y: 0 }, 'enemy')).toBeUndefined()
    const first = s().fireAt({ x: 0, y: 0 })
    expect(first).toBeDefined()
    expect(s().turn).toBe('enemy')
    expect(s().enemyTurn()).toBeUndefined()
    expect(s().turn).toBe('enemy')
    expect(s().events).toHaveLength(1)
    // the store does not raise the curtain by itself: the turn flow does, after the cinematic
    expect(s().handoff).toBeNull()
    s().beginHandoff('enemy')
    expect(s().handoff).toBe('enemy')
    expect(s().fireAt({ x: 1, y: 0 }, 'enemy')).toBeUndefined()
    s().endHandoff()
    expect(s().perspective).toBe('enemy')
    expect(s().fireAt({ x: 0, y: 0 }, 'human')).toBeUndefined()
    const second = s().fireAt({ x: 0, y: 0 }, 'enemy')
    expect(second).toBeDefined()
    expect(s().playerBoard.shots).toHaveLength(1)
    expect(s().enemyBoard.shots).toHaveLength(1)
    expect(s().turn).toBe('human')
    expect(s().events.map((e) => e.by)).toEqual(['human', 'enemy'])
  })

  it('plays to a winner, names them and swaps who places first on rematch', () => {
    startHotSeat()
    const human = sweep()
    const enemy = sweep()
    let guard = 0
    while (s().phase === 'battle' && guard++ < 220) {
      volley(s().turn, s().turn === 'human' ? human : enemy)
    }
    expect(s().phase).toBe('gameover')
    const winner = s().winner!
    expect(isFleetSunk(winner === 'human' ? s().enemyBoard : s().playerBoard)).toBe(true)
    expect(s().players[winner].name).toMatch(/Anne|Jack/)
    expect(s().enemyTurn()).toBeUndefined()

    s().rematch()
    expect(s().phase).toBe('placement')
    expect(s().firstPlacer).toBe('enemy')
    expect(s().placing).toBe('enemy')
    expect(s().turn).toBe('enemy')
    expect(s().enemyBoard.ships).toHaveLength(0)
    s().autoPlacePlayerFleet()
    expect(s().enemyBoard.ships).toHaveLength(FLEET.length)
    s().confirmPlacement()
    expect(s().handoff).toBe('human')
    expect(s().placing).toBe('human')
    s().endHandoff()
    s().autoPlacePlayerFleet()
    s().confirmPlacement()
    expect(s().phase).toBe('battle')
    expect(s().turn).toBe('enemy')
    s().endHandoff()
    expect(s().fireAt({ x: 0, y: 0 }, 'human')).toBeUndefined()
    expect(s().fireAt({ x: 0, y: 0 }, 'enemy')).toBeDefined()
    s().rematch()
    expect(s().firstPlacer).toBe('human')
  })

  it('single player is untouched: startGame keeps the AI, rematch never swaps, handoff never raises', () => {
    s().setPlayers({ enemy: { kind: 'ai' } })
    s().startGame('easy')
    expect(s().opponent).toBeDefined()
    expect(s().enemyBoard.ships).toHaveLength(FLEET.length)
    s().autoPlacePlayerFleet()
    s().confirmPlacement()
    expect(s().phase).toBe('battle')
    expect(s().handoff).toBeNull()
    s().beginHandoff('enemy')
    expect(s().handoff).toBeNull()
    s().fireAt({ x: 0, y: 0 })
    expect(s().enemyTurn()).toBeDefined()
    expect(s().turn).toBe('human')
    s().rematch()
    expect(s().firstPlacer).toBe('human')
    expect(s().placing).toBe('human')
  })

  it('hot-seat + salvo: each captain queues one shot per surviving ship and the volley size follows the next shooter', () => {
    startHotSeat({ salvo: true, storm: false })
    expect(s().salvo.size).toBe(5)
    expect(s().fireAt({ x: 0, y: 0 })).toBeNull()
    expect(s().fireAt({ x: 1, y: 0 })).toBeNull()
    expect(s().fireAt({ x: 2, y: 0 })).toBeNull()
    expect(s().fireAt({ x: 3, y: 0 })).toBeNull()
    expect(s().salvo.pending).toHaveLength(4)
    expect(s().fireAt({ x: 4, y: 0 })).toBeDefined()
    expect(s().lastVolley).toHaveLength(5)
    expect(s().lastVolley.every((e) => e.by === 'human')).toBe(true)
    expect(s().turn).toBe('enemy')
    expect(s().salvo.pending).toHaveLength(0)
    expect(s().salvo.size).toBe(5)
    // Jack's volley lands on Anne's board
    for (let x = 0; x < 4; x++) expect(s().fireAt({ x, y: 9 }, 'enemy')).toBeNull()
    expect(s().fireAt({ x: 4, y: 9 }, 'enemy')).toBeDefined()
    expect(s().playerBoard.shots).toHaveLength(5)
    expect(s().turn).toBe('human')
  })

  it('hot-seat + stormy seas: fogged misses hide the first captain’s misses and the game still ends', () => {
    startHotSeat({ salvo: false, storm: true }, 11)
    const human = sweep()
    const enemy = sweep()
    let guard = 0
    while (s().phase === 'battle' && guard++ < 220) volley(s().turn, s().turn === 'human' ? human : enemy)
    expect(s().phase).toBe('gameover')
    expect(s().modes.storm).toBe(true)
    const humanMisses = s().events.filter((e) => e.by === 'human' && e.result.outcome === 'miss').length
    expect(s().fogged.length).toBeGreaterThan(0)
    expect(s().fogged.length).toBeLessThan(humanMisses)
  })
})

describe('hot-seat + Black Flag', () => {
  beforeEach(() => s().reset())
  const bf = { salvo: false, storm: false, blackFlag: true }

  it('each captain picks their own fleet preset; nothing is drawn for the second captain', () => {
    s().setPlayers({ human: { name: 'Anne' }, enemy: { name: 'Jack', kind: 'local' } })
    s().startGame('medium', bf, 3)
    expect(s().fleetPresets.enemy).toBe('classic')
    expect(s().enemyBoard.ships).toHaveLength(0)
    expect(s().opponent).toBeUndefined()
    s().setFleetPreset('wolf-pack')
    expect(s().fleetPresets.human).toBe('wolf-pack')
    expect(s().fleets.human).toHaveLength(7)
    s().autoPlacePlayerFleet()
    s().confirmPlacement()
    s().endHandoff()
    expect(s().placing).toBe('enemy')
    s().setFleetPreset('armada')
    expect(s().fleetPresets).toEqual({ human: 'wolf-pack', enemy: 'armada' })
    expect(s().fleets.enemy).toHaveLength(4)
    expect(s().playerBoard.ships).toHaveLength(7) // the first captain's fleet is untouched
    s().autoPlacePlayerFleet()
    expect(s().enemyBoard.ships).toHaveLength(4)
    s().confirmPlacement()
    expect(s().phase).toBe('battle')
    expect(s().treasure.human).toHaveLength(2)
    expect(s().treasure.enemy).toHaveLength(2)
    expect(FLEET_PRESETS.map((p) => p.id)).toContain('armada')
  })

  it('both captains own a Broadside and a Spyglass; the second captain fires them with by = enemy', () => {
    startHotSeat(bf)
    expect(s().powerShots).toEqual({ human: { broadside: true, spyglass: true }, enemy: { broadside: true, spyglass: true } })
    // Anne's turn: Jack cannot use his power shots yet
    expect(s().fireBroadside({ x: 2, y: 2 }, 'horizontal', 'enemy')).toEqual([])
    expect(s().spyAt({ x: 0, y: 0 }, 'enemy')).toBeUndefined()
    // Anne's Spyglass keeps the turn; her Broadside is the whole turn
    expect(s().spyAt({ x: 0, y: 0 }, 'human')).toMatch(/ship|water/)
    expect(s().turn).toBe('human')
    expect(s().powerShots.human.spyglass).toBe(false)
    const balls = s().fireBroadside({ x: 5, y: 5 }, 'horizontal', 'human')
    expect(balls.length).toBeGreaterThan(0)
    expect(s().enemyBoard.shots.length).toBe(balls.length)
    const treasureHit = balls.some((b) => s().treasure.enemy.some((t) => t.x === b.coord.x && t.y === b.coord.y))
    expect(s().turn).toBe(treasureHit ? 'human' : 'enemy')
    if (treasureHit) return
    s().beginHandoff('enemy')
    s().endHandoff()
    // Jack's own Broadside is still unspent and lands on Anne's board
    expect(s().powerShots.enemy.broadside).toBe(true)
    const jack = s().fireBroadside({ x: 5, y: 5 }, 'vertical', 'enemy')
    expect(jack.length).toBeGreaterThan(0)
    expect(s().playerBoard.shots.length).toBe(jack.length)
    expect(s().powerShots.enemy.broadside).toBe(false)
    expect(s().powerShots.human.broadside).toBe(false)
    expect(s().events.filter((e) => e.kind === 'broadside' && e.by === 'enemy')).toHaveLength(jack.length)
  })

  it('a treasure chest keeps the deck for the captain who found it, with no AI turn in between', () => {
    startHotSeat(bf, 5)
    const chest = s().treasure.enemy[0]
    const r = s().fireAt(chest, 'human')
    expect(r?.outcome).toBe('miss')
    expect(s().events.at(-1)?.kind).toBe('treasure')
    expect(s().turn).toBe('human')
    expect(s().bonusShots).toBe(1)
    expect(s().handoff).toBeNull()
    expect(s().enemyTurn()).toBeUndefined()
    expect(s().playerBoard.shots).toHaveLength(0)
    // the bonus shot spent, the deck passes
    const cells = sweep()
    let next = cells.next().value
    while (s().treasure.enemy.some((t) => t.x === next.x && t.y === next.y)) next = cells.next().value
    s().fireAt(next, 'human')
    expect(s().turn).toBe('enemy')
  })
})
