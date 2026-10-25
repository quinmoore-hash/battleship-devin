import { describe, expect, it } from 'vitest'
import {
  BEAM,
  DECK,
  DRAFT,
  GUNS,
  LENGTH,
  MAN_O_WAR_ANCHORS as A,
  MASTS,
  RAIL,
  X_BOW,
  X_STERN,
  cellOf,
  cellX,
  envelope,
  hullHalfWidth,
  keelY,
  railY,
} from './spec'

describe('man-o-war hull form', () => {
  it('is widest near midships and narrows to the stem', () => {
    expect(envelope(-0.3)).toBeCloseTo(BEAM / 2, 2)
    expect(envelope(X_BOW)).toBeLessThan(0.05)
    expect(envelope(X_STERN)).toBeGreaterThan(0.3)
    expect(envelope(X_STERN)).toBeLessThan(BEAM / 2)
  })

  it('keeps every half-width inside the beam and above the keel line', () => {
    for (let x = X_STERN; x <= X_BOW; x += 0.1) {
      for (let y = keelY(x); y <= railY(x); y += 0.05) {
        const w = hullHalfWidth(x, y)
        expect(w).toBeGreaterThan(0)
        expect(w).toBeLessThanOrEqual(BEAM / 2 + 1e-9)
      }
      expect(keelY(x)).toBeGreaterThanOrEqual(-DRAFT)
      expect(keelY(x)).toBeLessThan(0)
    }
  })

  it('tumbles home above the maximum beam', () => {
    expect(hullHalfWidth(0, RAIL.waist)).toBeLessThan(hullHalfWidth(0, 0.18))
    expect(hullHalfWidth(0, -0.4)).toBeLessThan(hullHalfWidth(0, 0))
  })

  it('has a higher rail at the castles than in the waist', () => {
    expect(railY(0.4)).toBeCloseTo(RAIL.waist, 1)
    expect(railY(-1.2)).toBeGreaterThan(RAIL.castle - 0.02)
    expect(railY(-2.2)).toBeGreaterThan(RAIL.poop - 0.02)
    expect(railY(2.0)).toBeGreaterThan(RAIL.castle - 0.02)
  })
})

describe('man-o-war anchors', () => {
  const half = LENGTH / 2

  it('maps x to cells bow-first', () => {
    expect(cellOf(2.4)).toBe(0)
    expect(cellOf(-2.4)).toBe(4)
    expect(cellOf(0)).toBe(2)
    expect(cellX(0)).toBe(2)
    expect(cellX(4)).toBe(-2)
  })

  it('has 2–4 cannons per side for every cell, all inside the hull bounds', () => {
    for (let cell = 0; cell < LENGTH; cell++) {
      for (const side of ['port', 'starboard'] as const) {
        const guns = A.cannons.filter((c) => c.cell === cell && c.side === side)
        expect(guns.length, `cell ${cell} ${side}`).toBeGreaterThanOrEqual(2)
        expect(guns.length).toBeLessThanOrEqual(4)
        for (const g of guns) {
          const [x, y, z] = g.muzzle
          expect(x).toBeGreaterThan(-half)
          expect(x).toBeLessThan(half)
          expect(x).toBeGreaterThanOrEqual(half - (cell + 1))
          expect(x).toBeLessThanOrEqual(half - cell)
          expect(y).toBeGreaterThan(0)
          expect(y).toBeLessThan(DECK.castle)
          expect(Math.sign(z)).toBe(side === 'starboard' ? 1 : -1)
          // muzzle pokes just outside the hull skin, never deep inside or far out
          const skin = hullHalfWidth(x, y)
          expect(Math.abs(z)).toBeGreaterThan(skin)
          expect(Math.abs(z)).toBeLessThan(skin + 0.25)
          expect(Math.sign(g.direction[2])).toBe(Math.sign(z))
        }
      }
    }
    expect(A.cannons).toHaveLength(GUNS.length * 2)
  })

  it('puts mast bases on a deck and inside the hull', () => {
    expect(A.masts).toHaveLength(3)
    A.masts.forEach((m, i) => {
      expect(m.base[0]).toBeCloseTo(MASTS[i].x)
      expect(m.base[2]).toBe(0)
      expect(Math.abs(m.base[0])).toBeLessThan(half)
      expect([DECK.main, DECK.castle]).toContain(m.base[1])
      expect(m.height).toBeGreaterThan(2)
    })
    expect(A.masts[1].height).toBeGreaterThan(A.masts[0].height)
    expect(A.masts[0].height).toBeGreaterThan(A.masts[2].height)
    expect(A.hull.height).toBeCloseTo(A.masts[1].base[1] + A.masts[1].height)
  })

  it('has one impact point per cell on the port hull skin', () => {
    expect(A.impactPoints).toHaveLength(LENGTH)
    A.impactPoints.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(cellX(i))
      expect(p[1]).toBeGreaterThan(0)
      expect(p[1]).toBeLessThan(DECK.main)
      expect(p[2]).toBeLessThan(0)
      expect(-p[2]).toBeCloseTo(hullHalfWidth(p[0], p[1]), 5)
    })
  })

  it('reports the hull envelope', () => {
    expect(A.hull).toMatchObject({ length: LENGTH, beam: BEAM, draft: DRAFT })
    expect(A.deckY).toBe(DECK.main)
  })
})
