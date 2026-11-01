import { describe, expect, it } from 'vitest'
import { createBoard, fire, FLEET, FLEET_BY_ID, fleetUnits, placeShip, presetFleet, type Board } from '../engine'
import { fleetScore, ownChartCell, ownChartModel, scoreLead, scoreStripText } from './ownChart'

const sloop = FLEET_BY_ID['sloop']
const brig = FLEET_BY_ID['brigantine']

/** Sloop A1–B1, brigantine D4–D6. */
function fleet(): Board {
  let b = createBoard()
  b = placeShip(b, sloop, { x: 0, y: 0 }, 'horizontal')
  b = placeShip(b, brig, { x: 3, y: 3 }, 'vertical')
  return b
}

describe('own-waters chart mapper', () => {
  it('marks own ships per hue, open water unknown', () => {
    const m = ownChartModel(fleet(), FLEET)
    const a1 = ownChartCell(m, { x: 0, y: 0 })
    expect(a1.state).toBe('ship')
    expect(a1.className).toContain('cell-own')
    expect(a1.title).toBe('A1 — Sloop')
    const d4 = ownChartCell(m, { x: 3, y: 3 })
    expect(d4.state).toBe('ship')
    // sloop and brigantine take different hues (fleet order)
    expect(d4.className).not.toBe(a1.className)
    expect(ownChartCell(m, { x: 9, y: 9 })).toEqual({ state: 'unknown', className: undefined, title: undefined })
  })

  it('shows enemy hits, misses and sunk ships', () => {
    let b = fleet()
    b = fire(b, { x: 5, y: 5 }).board // miss
    b = fire(b, { x: 3, y: 3 }).board // hit brigantine
    b = fire(b, { x: 0, y: 0 }).board // hit sloop
    b = fire(b, { x: 1, y: 0 }).board // sinks sloop
    const m = ownChartModel(b, FLEET)
    expect(ownChartCell(m, { x: 5, y: 5 })).toMatchObject({ state: 'miss', title: 'F6 — enemy miss' })
    expect(ownChartCell(m, { x: 3, y: 3 })).toMatchObject({ state: 'hit', title: 'D4 — Brigantine hit' })
    expect(ownChartCell(m, { x: 3, y: 4 }).state).toBe('ship')
    for (const x of [0, 1]) expect(ownChartCell(m, { x, y: 0 })).toMatchObject({ state: 'sunk', title: `${'AB'[x]}1 — Sloop sunk` })
    // hit / sunk cells keep the per-ship class so the hull colour still reads under the marker
    expect(ownChartCell(m, { x: 0, y: 0 }).className).toContain('cell-own')
  })

  it('marks treasure the enemy found and keeps storm-lost shots invisible', () => {
    const m = ownChartModel(fleet(), FLEET, new Set(['7,7']))
    expect(ownChartCell(m, { x: 7, y: 7 })).toMatchObject({ state: 'unknown', className: 'cell-treasure', title: 'H8 — the enemy found treasure' })
    // a lost shot is never recorded on the board, so the board alone decides: nothing to show
    expect(ownChartCell(m, { x: 8, y: 8 }).state).toBe('unknown')
  })

  it('cycles hues for a Black Flag fleet with repeated classes', () => {
    const preset = presetFleet('wolf-pack')
    let b = createBoard()
    fleetUnits(preset).forEach((u, i) => {
      b = placeShip(b, u.spec, { x: 0, y: i }, 'horizontal', u.uid)
    })
    const m = ownChartModel(b, preset)
    const hues = preset.map((_, y) => ownChartCell(m, { x: 0, y }).className)
    expect(new Set(hues).size).toBe(6) // seven ships, six hues: one wraps
    expect(hues.every((h) => /cell-own-\d/.test(h ?? ''))).toBe(true)
  })
})

describe('score strip', () => {
  it('counts afloat ships against the fleet size', () => {
    let b = fleet()
    b = fire(b, { x: 0, y: 0 }).board
    b = fire(b, { x: 1, y: 0 }).board
    expect(fleetScore(b, [sloop, brig])).toEqual({ afloat: 1, total: 2 })
    expect(fleetScore(createBoard(), FLEET)).toEqual({ afloat: 0, total: 5 })
  })

  it('reads as one line, with captain names in hot-seat', () => {
    expect(scoreStripText({ afloat: 4, total: 5 }, { afloat: 2, total: 5 })).toBe('Your fleet 4 of 5 afloat · Enemy fleet 2 of 5 afloat')
    expect(scoreStripText({ afloat: 7, total: 7 }, { afloat: 5, total: 5 }, { me: "Anne's fleet", foe: "Jack's fleet" })).toBe("Anne's fleet 7 of 7 afloat · Jack's fleet 5 of 5 afloat")
  })

  it('says who is ahead', () => {
    expect(scoreLead({ afloat: 4, total: 5 }, { afloat: 2, total: 5 })).toBe('ahead')
    expect(scoreLead({ afloat: 1, total: 5 }, { afloat: 2, total: 5 })).toBe('behind')
    expect(scoreLead({ afloat: 3, total: 5 }, { afloat: 3, total: 5 })).toBe('even')
  })
})
