import { describe, expect, it } from 'vitest'
import { GALLEON_ANCHORS, CANNON_X, MASTS, cannonPlacements, cellOfX, mastBase } from './anchors'
import { GALLEON, beamFactor, deckY, halfWidth, keelLine, railY, stations } from './hull'

const half = GALLEON.length / 2

describe('galleon hull surface', () => {
  it('is widest just forward of midships and tapers to a fine stem and a narrow transom', () => {
    expect(beamFactor(0.25)).toBeGreaterThan(0.98)
    expect(beamFactor(GALLEON.xStern)).toBeCloseTo(0.56, 2)
    expect(beamFactor(GALLEON.xBow)).toBeLessThan(0.06)
    expect(halfWidth(0.25, GALLEON.maxBeamY)).toBeCloseTo(GALLEON.beam / 2, 2)
  })
  it('has tumblehome: the rail is narrower than the maximum beam', () => {
    for (const x of [-1.5, -0.5, 0.3, 1.0]) {
      expect(halfWidth(x, railY(x))).toBeLessThan(halfWidth(x, GALLEON.maxBeamY))
      expect(halfWidth(x, railY(x))).toBeGreaterThan(0.7 * halfWidth(x, GALLEON.maxBeamY))
    }
  })
  it('is continuous across the maximum-beam height and never narrower than the keel width', () => {
    for (const x of stations()) {
      expect(halfWidth(x, GALLEON.maxBeamY - 1e-6)).toBeCloseTo(halfWidth(x, GALLEON.maxBeamY + 1e-6), 3)
      for (let y = keelLine(x); y <= railY(x); y += 0.05) expect(halfWidth(x, y)).toBeGreaterThanOrEqual(0.02)
    }
  })
  it('keel stays below the waterline and inside the draft; decks step up toward the stern', () => {
    for (const x of stations()) {
      expect(keelLine(x)).toBeLessThan(-0.15)
      expect(keelLine(x)).toBeGreaterThanOrEqual(GALLEON.keelY)
      expect(deckY(x)).toBeGreaterThanOrEqual(GALLEON.mainDeckY)
      expect(railY(x)).toBeGreaterThan(deckY(x))
    }
    expect(deckY(-1.5)).toBeGreaterThan(deckY(-0.8))
    expect(deckY(-0.8)).toBeGreaterThan(deckY(0))
    expect(deckY(1.5)).toBeGreaterThan(deckY(0))
  })
  it('stations include a vertical step at every castle edge and are strictly increasing', () => {
    const xs = stations()
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
    for (const edge of [GALLEON.forecastleX, GALLEON.quarterX, GALLEON.poopX]) {
      expect(xs.some((x) => x < edge && edge - x < 0.002)).toBe(true)
      expect(xs.some((x) => x > edge && x - edge < 0.002)).toBe(true)
    }
  })
})

describe('galleon anchors', () => {
  const a = GALLEON_ANCHORS

  it('has at least one cannon per side for every cell, in that cell, and two per side', () => {
    for (let cell = 0; cell < GALLEON.length; cell++) {
      for (const side of ['port', 'starboard'] as const) {
        const guns = a.cannons.filter((c) => c.cell === cell && c.side === side)
        expect(guns.length).toBe(2)
        for (const g of guns) {
          expect(cellOfX(g.muzzle[0])).toBe(cell)
          expect(Math.sign(g.muzzle[2])).toBe(side === 'starboard' ? 1 : -1)
          expect(Math.sign(g.direction[2])).toBe(side === 'starboard' ? 1 : -1)
        }
      }
    }
    expect(a.cannons.length).toBe(16)
  })

  it('places every muzzle just outboard of the planking and inside the hull bounds', () => {
    for (const c of a.cannons) {
      const hw = halfWidth(c.muzzle[0], c.muzzle[1])
      expect(Math.abs(c.muzzle[2])).toBeGreaterThan(hw)
      expect(Math.abs(c.muzzle[2])).toBeLessThan(hw + 0.1)
      expect(Math.abs(c.muzzle[2])).toBeLessThanOrEqual(GALLEON.beam / 2 + 0.1)
      expect(c.muzzle[0]).toBeGreaterThan(-half)
      expect(c.muzzle[0]).toBeLessThan(half)
      expect(c.muzzle[1]).toBeGreaterThan(GALLEON.mainDeckY)
      expect(c.muzzle[1]).toBeLessThan(railY(c.muzzle[0]))
    }
  })

  it('cannon pairs never overlap: two back-to-back guns fit inside the beam at their station', () => {
    const depth = 0.45 * 0.5 + 0.2 * 0.5
    for (const p of cannonPlacements()) expect(p.hw).toBeGreaterThan(depth * 0.9)
    for (const xs of CANNON_X) expect(Math.abs(xs[0] - xs[1])).toBeGreaterThan(0.2)
  })

  it('masts stand on their deck inside the hull, bow to stern, main tallest', () => {
    expect(a.masts.length).toBe(3)
    a.masts.forEach((m, i) => {
      expect(m.base[1]).toBeCloseTo(deckY(m.base[0]), 6)
      expect(m.base[2]).toBe(0)
      expect(Math.abs(m.base[0])).toBeLessThan(half)
      if (i > 0) expect(m.base[0]).toBeLessThan(a.masts[i - 1].base[0])
      expect(mastBase(MASTS[i])).toEqual(m.base)
    })
    expect(a.masts[1].height).toBeGreaterThan(a.masts[0].height)
    expect(a.masts[1].height).toBeGreaterThan(a.masts[2].height)
    expect(a.hull.height).toBeCloseTo(Math.max(...a.masts.map((m) => m.base[1] + m.height)), 6)
  })

  it('impact points sit on the port planking of each cell, between the waterline and the deck', () => {
    expect(a.impactPoints.length).toBe(GALLEON.length)
    a.impactPoints.forEach((p, i) => {
      expect(cellOfX(p[0])).toBe(i)
      expect(p[1]).toBeGreaterThan(0)
      expect(p[1]).toBeLessThan(a.deckY)
      expect(p[2]).toBeCloseTo(-halfWidth(p[0], p[1]), 6)
    })
  })

  it('reports the hull dims', () => {
    expect(a.hull.length).toBe(4)
    expect(a.hull.beam).toBeCloseTo(1.25)
    expect(a.hull.draft).toBeCloseTo(0.5)
    expect(a.deckY).toBeCloseTo(0.6)
  })
})
