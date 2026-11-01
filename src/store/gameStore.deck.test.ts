import { beforeEach, describe, expect, it } from 'vitest'
import { fire, isSunk, type Board, type Coord } from '../engine'
import { DEFAULT_DECK, deckBus } from '../deck/contract'
import { afloatShipUid, loadSettings, saveSettings, useGameStore } from './gameStore'

const s = () => useGameStore.getState()

function startBattle(seed = 7) {
  s().reset()
  s().startGame('easy', { salvo: false, storm: false, blackFlag: false }, seed)
  s().autoPlacePlayerFleet()
  s().confirmPlacement()
  expect(s().phase).toBe('battle')
}

/** Sinks `uid` on `key`'s board through the pure engine (the enemy's shots, without playing turns). */
function sinkOwn(key: 'playerBoard' | 'enemyBoard', uid: string) {
  let board: Board = s()[key]
  const ship = board.ships.find((x) => x.uid === uid)!
  for (const c of ship.cells) board = fire(board, c).board
  useGameStore.setState({ [key]: board })
  expect(isSunk(s()[key].ships.find((x) => x.uid === uid)!)).toBe(true)
}

function startHotSeat() {
  s().reset()
  s().setPlayers({ human: { name: 'Anne' }, enemy: { name: 'Jack', kind: 'local' } })
  s().startGame('medium', { salvo: false, storm: false, blackFlag: false }, 3)
  s().autoPlacePlayerFleet()
  s().confirmPlacement()
  s().endHandoff()
  s().autoPlacePlayerFleet()
  s().confirmPlacement()
  expect(s().phase).toBe('battle')
  s().endHandoff()
  expect(s().perspective).toBe('human')
}

const freshCell = (board: Board): Coord => {
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if (!board.shots.some((c) => c.coord.x === x && c.coord.y === y)) return { x, y }
  throw new Error('no cell left')
}

describe('deck slice', () => {
  beforeEach(() => s().reset())

  it('is off by default and setDeck is a no-op outside the battle', () => {
    expect(s().deck).toEqual(DEFAULT_DECK)
    s().setDeck(true)
    expect(s().deck.on).toBe(false)
    s().startGame('easy')
    s().setDeck(true)
    expect(s().deck.on).toBe(false)
  })

  it('setDeck(true) boards the first afloat own ship; off keeps the ship for next time; manStation only while on', () => {
    startBattle()
    s().manStation(2)
    expect(s().deck.station).toBeNull()
    s().setDeck(true)
    const first = s().playerBoard.ships[0].uid
    expect(s().deck).toEqual({ on: true, shipUid: first, station: null })
    expect(s().deckOnBy.human).toBe(true)
    s().manStation(3)
    expect(s().deck.station).toBe(3)
    s().setDeck(false)
    expect(s().deck).toEqual({ on: false, shipUid: first, station: null })
    expect(s().deckOnBy.human).toBe(false)
    s().setDeck(true)
    expect(s().deck.shipUid).toBe(first)
  })

  it('boardShip stands on another afloat own ship and refuses sunk or unknown ones', () => {
    startBattle()
    s().setDeck(true)
    const [a, b] = s().playerBoard.ships.map((x) => x.uid)
    s().manStation(1)
    s().boardShip(b)
    expect(s().deck).toEqual({ on: true, shipUid: b, station: null })
    s().boardShip('kraken')
    expect(s().deck.shipUid).toBe(b)
    sinkOwn('playerBoard', a)
    s().boardShip(a)
    expect(s().deck.shipUid).toBe(b)
  })

  it('setDeck(true) with a sunk remembered ship boards the next afloat one', () => {
    startBattle()
    s().setDeck(true)
    const [a, b] = s().playerBoard.ships.map((x) => x.uid)
    s().setDeck(false)
    sinkOwn('playerBoard', a)
    s().setDeck(true)
    expect(s().deck.shipUid).toBe(b)
    expect(afloatShipUid(s().playerBoard, a)).toBe(b)
  })

  it('the standing ship sinking switches at once when nobody listens on deckBus, and not when a controller does', () => {
    startBattle()
    s().setDeck(true)
    const [a, b] = s().playerBoard.ships.map((x) => x.uid)
    s().manStation(0)
    sinkOwn('playerBoard', a)
    expect(s().deck).toEqual({ on: true, shipUid: b, station: null })

    const off = deckBus.on(() => {})
    try {
      sinkOwn('playerBoard', b)
      expect(s().deck.shipUid).toBe(b) // the listener (DeckController) plays abandon-ship and boards the next ship itself
    } finally {
      off()
    }
  })

  it('no ship left turns the deck off', () => {
    startBattle()
    s().setDeck(true)
    for (const ship of s().playerBoard.ships.slice(0, -1)) sinkOwn('playerBoard', ship.uid)
    const last = s().playerBoard.ships.at(-1)!.uid
    expect(s().deck).toEqual({ on: true, shipUid: last, station: null })
    sinkOwn('playerBoard', last)
    // all sunk: the subscription sees no afloat ship (phase is still battle because the engine was bypassed)
    expect(s().deck.on).toBe(false)
  })

  it('leaving the battle (quit / game over / restart) resets the deck', () => {
    startBattle()
    s().setDeck(true)
    s().manStation(1)
    s().reset()
    expect(s().deck).toEqual(DEFAULT_DECK)
    expect(s().deckOnBy).toEqual({ human: false, enemy: false })

    startBattle()
    s().setDeck(true)
    s().startGame('easy')
    expect(s().deck).toEqual(DEFAULT_DECK)

    startBattle()
    s().setDeck(true)
    for (const ship of s().enemyBoard.ships)
      for (const c of ship.cells) {
        s().fireAt(c)
        if (s().phase === 'battle') s().enemyTurn()
      }
    expect(s().phase).toBe('gameover')
    expect(s().deck).toEqual(DEFAULT_DECK)
  })

  it('hot-seat: each captain keeps their own deck choice across the handoff and stands on their own fleet', () => {
    startHotSeat()
    s().setDeck(true)
    const anneShip = s().playerBoard.ships[0].uid
    expect(s().deck.shipUid).toBe(anneShip)
    s().fireAt(freshCell(s().enemyBoard), 'human')
    s().beginHandoff('enemy')
    expect(s().handoff).toBe('enemy')
    // curtain up: the deck state is untouched (the scene shows the handoff view), nothing of Anne's is on screen
    s().endHandoff()
    expect(s().perspective).toBe('enemy')
    expect(s().deck.on).toBe(false)
    expect(s().deckOnBy).toEqual({ human: true, enemy: false })
    s().setDeck(true)
    const jackShip = s().enemyBoard.ships[0].uid
    expect(s().deck.shipUid).toBe(jackShip)
    expect(s().playerBoard.ships.some((x) => x.uid === jackShip && x === s().enemyBoard.ships[0])).toBe(false)
    s().setDeck(false)
    s().fireAt(freshCell(s().playerBoard), 'enemy')
    s().beginHandoff('human')
    s().endHandoff()
    expect(s().perspective).toBe('human')
    expect(s().deck).toEqual({ on: true, shipUid: anneShip, station: null })
    s().fireAt(freshCell(s().enemyBoard), 'human')
    s().beginHandoff('enemy')
    s().endHandoff()
    expect(s().deck.on).toBe(false)
  })

  it('persists deckSensitivity / deckInvertY with the other settings and validates them on load', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    saveSettings({ ...s().settings, deckSensitivity: 2.5, deckInvertY: true }, storage)
    expect(loadSettings(storage, '')).toMatchObject({ deckSensitivity: 2.5, deckInvertY: true })
    storage.setItem('battleship-devin.settings', JSON.stringify({ deckSensitivity: 9, deckInvertY: 'yes' }))
    expect(loadSettings(storage, '')).toMatchObject({ deckSensitivity: 1, deckInvertY: false })
  })
})
