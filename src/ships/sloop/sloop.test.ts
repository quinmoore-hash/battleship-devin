import { describe, expect, it } from 'vitest'
import { SLOOP_ANCHORS } from './anchors'
import {
  BOW_CHASER,
  deckEdgeHalfWidth,
  deckOutline,
  deckY,
  gunPort,
  gunStation,
  HALF_LENGTH,
  hullHalfWidth,
  hullSections,
  keelY,
  SLOOP_DIMS,
  stations,
} from './hull'

const xs = stations(41)

describe('sloop hull maths', () => {
  it('keeps the keel under water and the deck above it along the whole length', () => {
    for (const x of xs) {
      expect(keelY(x)).toBeLessThan(0)
      expect(keelY(x)).toBeGreaterThanOrEqual(-SLOOP_DIMS.draft - 1e-9)
      expect(deckY(x)).toBeGreaterThanOrEqual(SLOOP_DIMS.deckHeight - 1e-9)
      expect(deckY(x)).toBeLessThan(0.4)
    }
  })

  it('never exceeds the beam and comes to a fine entry at the stem', () => {
    for (const x of xs) {
      for (let s = 0; s <= 1; s += 0.1) {
        const y = keelY(x) + (deckY(x) - keelY(x)) * s
        const w = hullHalfWidth(x, y)
        expect(w).toBeGreaterThan(0)
        expect(w).toBeLessThanOrEqual(SLOOP_DIMS.beam / 2 + 1e-9)
      }
    }
    expect(deckEdgeHalfWidth(HALF_LENGTH)).toBeLessThan(0.03)
    expect(deckEdgeHalfWidth(-HALF_LENGTH)).toBeGreaterThan(0.15)
    expect(Math.max(...xs.map(deckEdgeHalfWidth))).toBeGreaterThan(SLOOP_DIMS.beam / 2 - 0.03)
  })

  it('widens monotonically from keel to deck at every station', () => {
    for (const x of xs) {
      let prev = 0
      for (let s = 0; s <= 1.0001; s += 0.05) {
        const w = hullHalfWidth(x, keelY(x) + (deckY(x) - keelY(x)) * s)
        expect(w).toBeGreaterThanOrEqual(prev * 0.94 - 1e-6) // ≤ 6 % tumblehome allowed
        prev = w
      }
    }
  })

  it('produces loft sections that tile the hull without gaps between the two bands', () => {
    const below = hullSections('below')
    const above = hullSections('above')
    expect(below.length).toBe(above.length)
    below.forEach((b, i) => {
      const a = above[i]
      expect(a.x).toBe(b.x)
      expect(b.railY).toBe(0)
      expect(a.keelY).toBeLessThanOrEqual(0)
      expect(a.halfWidths[0]).toBeCloseTo(b.halfWidths[b.halfWidths.length - 1], 6)
      for (let k = 1; k < b.halfWidths.length; k++) expect(b.halfWidths[k]).toBeGreaterThanOrEqual(b.halfWidths[k - 1] - 1e-6)
    })
    const sorted = [...below].sort((p, q) => p.x - q.x)
    expect(sorted.map((s) => s.x)).toEqual(below.map((s) => s.x))
  })

  it('deck outline is a closed symmetric polygon inside the bounds', () => {
    const outline = deckOutline()
    expect(outline.length).toBeGreaterThan(20)
    for (const [x, z] of outline) {
      expect(Math.abs(x)).toBeLessThanOrEqual(HALF_LENGTH + 1e-9)
      expect(Math.abs(z)).toBeLessThanOrEqual(SLOOP_DIMS.beam / 2 + 1e-9)
    }
    const port = outline.filter(([, z]) => z < 0)
    const stbd = outline.filter(([, z]) => z > 0)
    expect(port.length).toBe(stbd.length)
  })

  it('gun ports sit inside their cell and clear the bulwark sill', () => {
    for (let cell = 0; cell < SLOOP_DIMS.length; cell++) {
      const p = gunPort(cell)
      const cellMin = HALF_LENGTH - (cell + 1)
      expect(p.x0).toBeGreaterThan(cellMin)
      expect(p.x1).toBeLessThan(cellMin + 1)
      expect(p.sillY).toBeGreaterThan(deckY(p.x0))
      expect(p.sillY + p.lidHeight).toBeLessThan(deckY(p.x0) + SLOOP_DIMS.bulwark)
      const [, , z] = gunStation(cell, 'starboard')
      expect(z).toBeGreaterThan(0)
      expect(z).toBeLessThan(deckEdgeHalfWidth(p.x0))
    }
    expect(BOW_CHASER[0]).toBeLessThan(HALF_LENGTH)
  })
})

describe('sloop anchors', () => {
  const a = SLOOP_ANCHORS
  const inHull = ([x, y, z]: readonly number[], slackZ = 0) => {
    expect(Math.abs(x)).toBeLessThanOrEqual(a.hull.length / 2 + 1e-9)
    expect(Math.abs(z)).toBeLessThanOrEqual(a.hull.beam / 2 + slackZ + 1e-9)
    expect(y).toBeGreaterThanOrEqual(-a.hull.draft - 1e-9)
    expect(y).toBeLessThanOrEqual(a.hull.height + 1e-9)
  }

  it('has one cannon per side for every cell, inside the hull bounds, firing outward', () => {
    expect(a.cannons.length).toBe(SLOOP_DIMS.length * 2)
    for (let cell = 0; cell < SLOOP_DIMS.length; cell++) {
      for (const side of ['port', 'starboard'] as const) {
        const list = a.cannons.filter((c) => c.cell === cell && c.side === side)
        expect(list.length).toBe(1)
        const c = list[0]
        inHull(c.muzzle, 0.05)
        const sign = side === 'starboard' ? 1 : -1
        expect(Math.sign(c.muzzle[2])).toBe(sign)
        expect(Math.sign(c.direction[2])).toBe(sign)
        expect(Math.hypot(...c.direction)).toBeCloseTo(1, 6)
        // the muzzle clears the bulwark so the flash is outside the hull
        expect(Math.abs(c.muzzle[2])).toBeGreaterThan(deckEdgeHalfWidth(c.muzzle[0]) - 0.03)
        expect(c.muzzle[1]).toBeGreaterThan(deckY(c.muzzle[0]))
        // and the muzzle is inside the cell it belongs to
        expect(c.muzzle[0]).toBeGreaterThan(HALF_LENGTH - (cell + 1))
        expect(c.muzzle[0]).toBeLessThan(HALF_LENGTH - cell)
      }
    }
  })

  it('places the single mast on the deck centreline and reports the hull envelope', () => {
    expect(a.masts.length).toBe(1)
    const m = a.masts[0]
    inHull(m.base)
    expect(m.base[2]).toBe(0)
    expect(m.base[1]).toBeCloseTo(deckY(m.base[0]), 6)
    expect(m.height).toBe(SLOOP_DIMS.mastHeight)
    expect(a.deckY).toBe(SLOOP_DIMS.deckHeight)
    expect(a.hull).toMatchObject({ length: 2, beam: 0.7, draft: 0.3 })
    expect(a.hull.height).toBeGreaterThan(m.base[1] + m.height)
  })

  it('impact points lie on the port hull surface near the waterline, one per cell', () => {
    expect(a.impactPoints.length).toBe(SLOOP_DIMS.length)
    a.impactPoints.forEach((p, cell) => {
      inHull(p)
      expect(p[2]).toBeLessThan(0)
      expect(p[1]).toBeGreaterThan(0)
      expect(p[1]).toBeLessThan(a.deckY)
      expect(Math.abs(p[2])).toBeCloseTo(hullHalfWidth(p[0], p[1]), 6)
      expect(p[0]).toBeGreaterThan(HALF_LENGTH - (cell + 1))
      expect(p[0]).toBeLessThan(HALF_LENGTH - cell)
    })
  })
})
