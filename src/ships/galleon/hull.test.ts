import type * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { GALLEON, crossPlane, deckStrip, halfWidth, hullBand, keelLine, loftProfile, railY, stations, stemCurve, triangleCount, wale } from './hull'

const finite = (g: THREE.BufferGeometry) => Array.from(g.attributes.position.array as ArrayLike<number>).every(Number.isFinite)

describe('galleon lofting', () => {
  it('lofts a band with one vertex per station per profile point per side and outward normals', () => {
    const xs = stations(0.2)
    const g = hullBand(keelLine, railY, 5, { xs })
    expect(g.attributes.position.count).toBe(xs.length * 5 * 2)
    expect(finite(g)).toBe(true)
    expect(triangleCount(g)).toBe((xs.length - 1) * 4 * 2 * 2)
    // a starboard-side vertex at mid height should have a normal pointing to +z, port to -z
    const n = g.attributes.normal
    const half = g.attributes.position.count / 2
    const mid = Math.floor(xs.length / 2) * 5 + 2
    expect(n.getZ(mid)).toBeGreaterThan(0.5)
    expect(n.getZ(half + mid)).toBeLessThan(-0.5)
  })

  it('inward bands face the deck and flat lofts are non-indexed', () => {
    const xs = stations(0.2)
    const inner = loftProfile((x) => [{ y: 0.6, off: -0.04 }, { y: railY(x), off: -0.04 }], { xs, inward: true })
    const mid = Math.floor(xs.length / 2) * 2
    expect(inner.attributes.normal.getZ(mid)).toBeLessThan(-0.5)
    const w = wale(0.4, 0.46, 0.03, { xs })
    expect(w.index).toBeNull()
    expect(finite(w)).toBe(true)
    // the wale stands off the planking
    const pos = w.attributes.position
    let maxOff = 0
    for (let i = 0; i < pos.count; i++) maxOff = Math.max(maxOff, Math.abs(pos.getZ(i)) - halfWidth(pos.getX(i), pos.getY(i)))
    expect(maxOff).toBeCloseTo(0.03, 2)
  })

  it('decks stay inside the planking and bulkheads span the hull at their station', () => {
    const d = deckStrip(-1.8, 1.6, GALLEON.mainDeckY, GALLEON.plank)
    const pos = d.attributes.position
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeCloseTo(GALLEON.mainDeckY, 5)
      expect(Math.abs(pos.getZ(i))).toBeLessThanOrEqual(halfWidth(pos.getX(i), GALLEON.mainDeckY) - GALLEON.plank + 1e-6)
    }
    expect(d.attributes.normal.getY(0)).toBeCloseTo(1, 5)
    const b = crossPlane(GALLEON.quarterX, GALLEON.mainDeckY, GALLEON.quarterDeckY, 1, GALLEON.plank)
    expect(b.attributes.normal.getX(0)).toBeCloseTo(1, 5)
    const t = crossPlane(GALLEON.xStern, keelLine(GALLEON.xStern), railY(GALLEON.xStern), -1)
    expect(t.attributes.normal.getX(0)).toBeCloseTo(-1, 5)
  })

  it('stem curve runs from the forefoot up and forward past the stem head', () => {
    const c = stemCurve()
    for (let i = 1; i < c.length; i++) {
      expect(c[i].x).toBeGreaterThan(c[i - 1].x)
      expect(c[i].y).toBeGreaterThan(c[i - 1].y)
    }
    expect(c[0].y).toBeLessThan(0)
    expect(c[c.length - 1].x).toBeGreaterThan(GALLEON.xBow)
    expect(c[c.length - 1].x).toBeLessThan(GALLEON.length / 2 + 0.2)
  })
})
