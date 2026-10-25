import { describe, expect, it } from 'vitest'
import { FRIGATE_ANCHORS } from './anchors'
import { FRIGATE, GUN_X, MASTS, bulwarkHalfWidth, deckY, gunCell, gunX, halfBeamAtDeck, keelY, railY, sectionHalfWidth } from './form'

const half = FRIGATE.length / 2

describe('frigate anchors', () => {
  it('has one cannon per side for every cell, two per cell', () => {
    for (let cell = 0; cell < FRIGATE.length; cell++) {
      const port = FRIGATE_ANCHORS.cannons.filter((c) => c.cell === cell && c.side === 'port')
      const stbd = FRIGATE_ANCHORS.cannons.filter((c) => c.cell === cell && c.side === 'starboard')
      expect(port.length).toBe(2)
      expect(stbd.length).toBe(2)
    }
    expect(FRIGATE_ANCHORS.cannons.length).toBe(GUN_X.length * 2)
  })

  it('places every muzzle inside its cell, just outboard of the bulwark, firing outward', () => {
    for (const c of FRIGATE_ANCHORS.cannons) {
      const [x, y, z] = c.muzzle
      expect(x).toBeLessThanOrEqual(half - c.cell)
      expect(x).toBeGreaterThanOrEqual(half - c.cell - 1)
      expect(Math.abs(x)).toBeLessThan(half)
      const sign = c.side === 'starboard' ? 1 : -1
      expect(Math.sign(z)).toBe(sign)
      const hw = bulwarkHalfWidth(x, y)
      expect(Math.abs(z)).toBeGreaterThan(hw)
      expect(Math.abs(z)).toBeLessThan(hw + 0.15)
      expect(y).toBeGreaterThan(deckY(x))
      expect(y).toBeLessThan(deckY(x) + FRIGATE.bulwarkH)
      expect(Math.sign(c.direction[2])).toBe(sign)
      const len = Math.hypot(...c.direction)
      expect(len).toBeCloseTo(1, 5)
    }
  })

  it('stands three masts on the centreline on their decks, bow to stern', () => {
    expect(FRIGATE_ANCHORS.masts.length).toBe(3)
    FRIGATE_ANCHORS.masts.forEach((m, i) => {
      expect(m.base[2]).toBe(0)
      expect(m.base[1]).toBe(deckY(m.base[0]))
      expect(Math.abs(m.base[0])).toBeLessThan(half)
      expect(m.height).toBe(MASTS[i].height)
      if (i > 0) expect(m.base[0]).toBeLessThan(FRIGATE_ANCHORS.masts[i - 1].base[0])
    })
    expect(FRIGATE_ANCHORS.masts[1].height).toBeGreaterThan(FRIGATE_ANCHORS.masts[0].height)
    expect(FRIGATE_ANCHORS.masts[1].height).toBeGreaterThan(FRIGATE_ANCHORS.masts[2].height)
  })

  it('impact points lie on the port hull side between the waterline and the deck, one per cell', () => {
    expect(FRIGATE_ANCHORS.impactPoints.length).toBe(FRIGATE.length)
    FRIGATE_ANCHORS.impactPoints.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(half - (i + 0.5), 5)
      expect(p[1]).toBeGreaterThan(0)
      expect(p[1]).toBeLessThan(FRIGATE.deckY)
      expect(p[2]).toBeLessThan(0)
      expect(Math.abs(p[2])).toBeCloseTo(sectionHalfWidth(p[0], p[1]), 5)
      expect(Math.abs(p[2])).toBeLessThanOrEqual(FRIGATE.beam / 2)
    })
  })

  it('reports hull dims consistent with the form', () => {
    expect(FRIGATE_ANCHORS.deckY).toBe(FRIGATE.deckY)
    expect(FRIGATE_ANCHORS.hull.beam).toBe(FRIGATE.beam)
    expect(FRIGATE_ANCHORS.hull.draft).toBe(FRIGATE.draft)
    expect(FRIGATE_ANCHORS.hull.length).toBeGreaterThanOrEqual(FRIGATE.length)
    expect(FRIGATE_ANCHORS.hull.height).toBeGreaterThan(MASTS[1].height)
  })
})

describe('frigate hull form', () => {
  it('keeps the hull inside the beam and the cell span', () => {
    for (let x = FRIGATE.xStern; x <= FRIGATE.xBow; x += 0.05) {
      for (let y = keelY(x); y <= railY(x); y += 0.05) {
        const hw = sectionHalfWidth(x, y)
        expect(hw).toBeGreaterThan(0)
        expect(hw).toBeLessThanOrEqual(FRIGATE.beam / 2 + 1e-6)
      }
    }
    expect(FRIGATE.xBow).toBeLessThanOrEqual(half)
    expect(FRIGATE.xStern).toBeGreaterThanOrEqual(-half)
  })

  it('has its widest point near midships and a sharp bow', () => {
    expect(halfBeamAtDeck(FRIGATE.xMid)).toBeGreaterThan(halfBeamAtDeck(0.8))
    expect(halfBeamAtDeck(FRIGATE.xMid)).toBeGreaterThan(halfBeamAtDeck(-1.2))
    expect(halfBeamAtDeck(FRIGATE.xBow)).toBeLessThan(0.03)
    expect(sectionHalfWidth(FRIGATE.xMid, 0.2)).toBeCloseTo(FRIGATE.beam / 2, 1)
  })

  it('keel is deepest midships and rises toward both ends', () => {
    expect(keelY(0)).toBeCloseTo(-(FRIGATE.draft - 0.04), 5)
    expect(keelY(FRIGATE.xBow)).toBeGreaterThan(keelY(0))
    expect(keelY(FRIGATE.xStern)).toBeGreaterThan(keelY(0))
    expect(keelY(FRIGATE.xBow)).toBeLessThan(0)
  })

  it('maps gun x positions to cells, two per cell, and keeps staggered guns in their cell', () => {
    const cells = GUN_X.map(gunCell)
    expect(cells).toEqual([0, 0, 1, 1, 2, 2])
    for (const gx of GUN_X) {
      for (const side of ['port', 'starboard'] as const) {
        expect(gunCell(gunX(gx, side))).toBe(gunCell(gx))
        // a gun (bore to breech ≈ 0.31 at scale 0.42) must fit inside the hull at its station
        expect(bulwarkHalfWidth(gunX(gx, side), deckY(gx) + 0.1) * 2).toBeGreaterThan(0.31 + 0.05)
      }
    }
  })
})
