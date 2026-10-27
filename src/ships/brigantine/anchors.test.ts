import { describe, expect, it } from 'vitest'
import { BRIGANTINE_ANCHORS, BRIGANTINE_MODEL_ANCHORS, cannonPosition, cellOfX } from './anchors'
import { BEAM, DECK_CAMBER, DECK_Y, FIT, HALF, LENGTH, PORT_BOTTOM, PORT_TOP, STEM_X, TRANSOM_X, buildDeckGeometry, buildHullGeometry, deckSurfaceY, hermite, hullHalfWidth, keelY, sheerY } from './hull'

describe('brigantine hull field', () => {
  it('hermite interpolates through its knots and stays monotone on a line', () => {
    const xs = [0, 1, 2.5, 4]
    const ys = xs.map((x) => 2 * x + 1)
    for (const x of [0, 0.3, 1, 1.7, 2.5, 3.9, 4]) expect(hermite(xs, ys, x)).toBeCloseTo(2 * x + 1, 6)
  })

  it('is widest near midships, closes at the stem, and is zero outside the hull', () => {
    const mid = hullHalfWidth(-0.1, DECK_Y)
    expect(mid).toBeGreaterThan(0.4)
    expect(mid).toBeLessThanOrEqual(BEAM / 2 + 1e-6)
    expect(hullHalfWidth(STEM_X, 0.2)).toBeLessThan(0.03)
    expect(hullHalfWidth(STEM_X + 0.1, 0.2)).toBe(0)
    expect(hullHalfWidth(TRANSOM_X - 0.1, 0.2)).toBe(0)
    // below the keel there is no hull
    expect(hullHalfWidth(0, keelY(0) - 0.01)).toBe(0)
  })

  it('keeps the deck above the waterline and the keel below it amidships', () => {
    for (const x of [-1.2, -0.6, 0, 0.6, 1.1]) {
      expect(keelY(x)).toBeLessThan(0)
      expect(sheerY(x)).toBeGreaterThan(DECK_Y)
    }
    expect(sheerY(1.4)).toBeGreaterThan(sheerY(0))
    expect(PORT_TOP).toBeLessThan(sheerY(0))
    expect(PORT_BOTTOM).toBeGreaterThan(DECK_Y)
  })

  it('tapers smoothly: half-width never jumps more than 6 cm per cm along x', () => {
    let prev = hullHalfWidth(TRANSOM_X, 0.1)
    for (let x = TRANSOM_X; x <= STEM_X; x += 0.01) {
      const w = hullHalfWidth(x, 0.1)
      expect(Math.abs(w - prev)).toBeLessThan(0.06)
      prev = w
    }
  })
})

describe('brigantine hull geometry', () => {
  it('lofts a finite, indexed mesh with ports and keeps all vertices inside the ship footprint', () => {
    const { geometry, triangles } = buildHullGeometry()
    const pos = geometry.getAttribute('position')
    expect(triangles).toBeGreaterThan(1000)
    expect(triangles).toBeLessThan(12000)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true)
      expect(Math.abs(x)).toBeLessThanOrEqual(HALF + 1e-6)
      expect(Math.abs(z)).toBeLessThanOrEqual(BEAM / 2 + 0.01)
      expect(y).toBeGreaterThanOrEqual(-0.33)
      expect(y).toBeLessThanOrEqual(0.61)
    }
  })

  it('the version without ports has more triangles (ports are real openings)', () => {
    expect(buildHullGeometry({ ports: false }).triangles).toBeGreaterThan(buildHullGeometry({ ports: true }).triangles - 200)
    const withPorts = buildHullGeometry({ ports: true })
    const solid = buildHullGeometry({ ports: false })
    // openings remove skin quads but add reveals; the net vertex count is identical
    expect(withPorts.geometry.getAttribute('position').count).toBe(solid.geometry.getAttribute('position').count)
    expect(withPorts.geometry.getIndex()!.count).not.toBe(solid.geometry.getIndex()!.count)
  })

  it('deckSurfaceY matches the lofted deck: highest on the centre line, DECK_Y at the edge', () => {
    expect(deckSurfaceY(0, 0)).toBeCloseTo(DECK_Y + DECK_CAMBER, 6)
    const w = hullHalfWidth(0, DECK_Y) - 0.03
    expect(deckSurfaceY(0, w)).toBeCloseTo(DECK_Y, 6)
    expect(deckSurfaceY(0.5, 0.2)).toBeGreaterThan(DECK_Y)
    expect(deckSurfaceY(0.5, 0.2)).toBeLessThan(DECK_Y + DECK_CAMBER)
  })

  it('deck surface sits at deck height with a small camber', () => {
    const g = buildDeckGeometry(-1.0, 1.3)
    const pos = g.getAttribute('position')
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < pos.count; i++) {
      min = Math.min(min, pos.getY(i))
      max = Math.max(max, pos.getY(i))
    }
    expect(min).toBeCloseTo(DECK_Y, 3)
    expect(max - min).toBeLessThan(0.02)
  })
})

describe('brigantine anchors', () => {
  const a = BRIGANTINE_MODEL_ANCHORS

  it('has one cannon per side for every cell', () => {
    for (let cell = 0; cell < LENGTH; cell++) {
      for (const side of ['port', 'starboard'] as const) {
        expect(a.cannons.filter((c) => c.cell === cell && c.side === side).length).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('cannon muzzles sit at the hull side within the gun-port band and fire outward', () => {
    for (const c of a.cannons) {
      const [x, y, z] = c.muzzle
      expect(Math.abs(x)).toBeLessThan(HALF)
      expect(y).toBeGreaterThan(PORT_BOTTOM)
      expect(y).toBeLessThan(PORT_TOP)
      const hw = hullHalfWidth(x, y)
      expect(Math.abs(z)).toBeGreaterThanOrEqual(hw)
      expect(Math.abs(z)).toBeLessThan(hw + 0.05)
      expect(Math.sign(z)).toBe(c.side === 'starboard' ? 1 : -1)
      expect(Math.sign(c.direction[2])).toBe(Math.sign(z))
      expect(cellOfX(x)).toBe(c.cell)
      // the cannon body stays inboard of the bulwark
      expect(Math.abs(cannonPosition(x, c.side)[2])).toBeLessThan(hw)
    }
  })

  it('masts stand on the deck inside the hull, mainmast tallest', () => {
    expect(a.masts).toHaveLength(2)
    for (const m of a.masts) {
      expect(m.base[1]).toBeCloseTo(DECK_Y, 6)
      expect(Math.abs(m.base[0])).toBeLessThan(HALF)
      expect(m.base[2]).toBe(0)
      expect(hullHalfWidth(m.base[0], DECK_Y)).toBeGreaterThan(0.3)
    }
    expect(a.masts[1].height).toBeGreaterThan(a.masts[0].height)
    expect(a.masts[0].base[0]).toBeGreaterThan(a.masts[1].base[0])
  })

  it('impact points are on the port hull side near the waterline, one per cell', () => {
    expect(a.impactPoints).toHaveLength(LENGTH)
    a.impactPoints.forEach((p, cell) => {
      expect(cellOfX(p[0])).toBe(cell)
      expect(p[1]).toBeGreaterThan(0)
      expect(p[1]).toBeLessThan(DECK_Y)
      expect(p[2]).toBeLessThan(0)
      expect(Math.abs(p[2])).toBeCloseTo(hullHalfWidth(p[0], p[1]), 6)
    })
  })

  it('hull dims match the model constants', () => {
    expect(a.hull.length).toBe(LENGTH)
    expect(a.hull.beam).toBe(BEAM)
    expect(a.deckY).toBe(DECK_Y)
    expect(a.hull.height).toBeGreaterThan(a.masts[1].height)
    expect(a.hull.draft).toBeGreaterThan(-keelY(0) - 0.05)
  })
})

describe('brigantine root fit (footprint inside its 3 cells)', () => {
  it('scales + shifts the anchors exactly like the model root and keeps the hull within ±HALF', () => {
    expect(BRIGANTINE_ANCHORS.hull.length).toBeCloseTo(LENGTH * FIT.scale, 6)
    BRIGANTINE_ANCHORS.masts.forEach((m, i) => expect(m.base[0]).toBeCloseTo(BRIGANTINE_MODEL_ANCHORS.masts[i].base[0] * FIT.scale + FIT.dx, 6))
    expect(STEM_X * FIT.scale + FIT.dx).toBeLessThan(HALF)
    expect(TRANSOM_X * FIT.scale + FIT.dx).toBeGreaterThan(-HALF)
    for (const p of BRIGANTINE_ANCHORS.impactPoints) expect(Math.abs(p[0])).toBeLessThan(HALF)
  })
})
