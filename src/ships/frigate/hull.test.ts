import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { FRIGATE, GUN_X, MASTS, deckY, gunX, halfBeamAtDeck, railY } from './form'
import { GUN_AXIS_Y } from './anchors'
import { buildFurniture } from './furniture'
import { breachGeometry, sailGeometry, triangleCount, wallStrip } from './geometry'
import { buildHullParts, capRailTop } from './hull'
import { buildBowsprit, buildMastGeoms, mastRigging, sailSet } from './rigging'

/** Geometry triangles of the whole model (excluding kit cannons/props and shadow passes). */
function modelTriangles(lod: 0 | 1 | 2) {
  let n = 0
  for (const g of Object.values(buildHullParts(lod))) n += triangleCount(g!)
  for (const g of Object.values(buildFurniture(lod))) n += triangleCount(g!)
  MASTS.forEach((m, i) => {
    const g = buildMastGeoms(m, lod, i === MASTS.length - 1)
    n += triangleCount(g.stump) + triangleCount(g.upperOak) + triangleCount(g.upperIron)
    n += g.sails.reduce((a, s) => a + triangleCount(s.geometry), 0) + (g.spanker ? triangleCount(g.spanker) : 0)
    n += mastRigging(i, lod).length * 10 // 5-sided open cylinder per rope
  })
  const b = buildBowsprit(lod)
  n += triangleCount(b.oak) + triangleCount(b.black) + b.jibs.reduce((a, s) => a + triangleCount(s.geometry), 0) + b.ropes.length * 10
  return n
}

describe('frigate geometry', () => {
  it('stays inside the triangle budget per LOD and shrinks with LOD', () => {
    const t = [modelTriangles(0), modelTriangles(1), modelTriangles(2)]
    expect(t[0]).toBeLessThan(40_000)
    expect(t[2]).toBeLessThan(8_000)
    expect(t[1]).toBeLessThan(t[0])
    expect(t[2]).toBeLessThan(t[1])
  })

  it('builds every hull part with positions, normals and uvs', () => {
    for (const lod of [0, 1, 2] as const) {
      const parts = buildHullParts(lod)
      expect(parts.hull).toBeDefined()
      expect(parts.copper).toBeDefined()
      expect(parts.deck).toBeDefined()
      for (const g of Object.values(parts)) {
        expect(g!.getAttribute('position').count).toBeGreaterThan(0)
        expect(g!.getAttribute('normal')).toBeDefined()
        expect(g!.getAttribute('uv')).toBeDefined()
        expect(g!.getIndex()).not.toBeNull()
      }
    }
  })

  it('keeps hull geometry inside the hull bounds', () => {
    const g = buildHullParts(0).hull!
    g.computeBoundingBox()
    const bb = g.boundingBox!
    expect(bb.min.x).toBeGreaterThanOrEqual(FRIGATE.xStern - 0.05)
    expect(bb.max.x).toBeLessThanOrEqual(FRIGATE.xBow + 0.05)
    expect(Math.max(-bb.min.z, bb.max.z)).toBeLessThanOrEqual(FRIGATE.beam / 2 + 0.03)
    expect(bb.min.y).toBeGreaterThanOrEqual(FRIGATE.copperTop - 1e-6)
    const copper = buildHullParts(0).copper!
    copper.computeBoundingBox()
    expect(copper.boundingBox!.max.y).toBeLessThanOrEqual(FRIGATE.copperTop + 1e-6)
    expect(copper.boundingBox!.min.y).toBeGreaterThanOrEqual(-FRIGATE.draft)
  })

  it('deck plates face up so they render from above', () => {
    for (const lod of [0, 2] as const) {
      const n = buildHullParts(lod).deck!.getAttribute('normal')
      for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeGreaterThan(0.99)
    }
  })

  it('wall strips follow the half-width function on the requested side', () => {
    const hw = (x: number) => 0.3 + 0.1 * x
    for (const side of [1, -1] as const) {
      const g = wallStrip({ x0: 0, x1: 1, yBottom: 0, yTop: 0.2, hw, thickness: 0.03, side, steps: 4 })
      const p = g.getAttribute('position')
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i)
        const z = p.getZ(i) * side
        expect(z).toBeGreaterThanOrEqual(hw(x) - 0.03 - 1e-6)
        expect(z).toBeLessThanOrEqual(hw(x) + 1e-6)
      }
    }
  })

  it('every gun port is a real opening through the bulwark (nothing blocks a ray along the bore)', () => {
    const parts = buildHullParts(0)
    const solid = (['hull', 'black', 'lidInside', 'stripe', 'deck'] as const).map((k) => new THREE.Mesh(parts[k]!, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })))
    for (const gx of GUN_X) {
      for (const side of ['port', 'starboard'] as const) {
        const x = gunX(gx, side)
        const sign = side === 'starboard' ? 1 : -1
        const ray = new THREE.Raycaster(new THREE.Vector3(x, deckY(x) + GUN_AXIS_Y, sign * 2), new THREE.Vector3(0, 0, -sign), 0, 2 - 0.1)
        const hits = ray.intersectObjects(solid).filter((h) => Math.sign(h.point.z) === sign)
        expect(hits.map((h) => h.point.z.toFixed(3)), `port at x=${x} ${side}`).toEqual([])
      }
    }
  })

  it('cap rail sits above every gun port and gun ports sit on a deck run', () => {
    for (const x of GUN_X) {
      expect(capRailTop(x)).toBeGreaterThan(railY(x) + 0.15)
      expect(halfBeamAtDeck(x)).toBeGreaterThan(0.15)
    }
  })

  it('sail geometry carries the attributes the cloth shader needs', () => {
    const quad = sailGeometry({ corners: [[0, 1, -1], [0, 1, 1], [0, 0, 1], [0, 0, -1]], segments: 4, belly: [1, 0, 0] })
    const tri = sailGeometry({ corners: [[0, 2, 0], [1, 0, 0], [-1, 0, 0]], segments: 4, belly: [0, 0, 1], furlTo: 'luff' })
    for (const g of [quad, tri]) {
      for (const name of ['position', 'uv', 'normal', 'aFurl', 'aTanU', 'aTanV']) expect(g.getAttribute(name), name).toBeDefined()
      expect(g.getAttribute('position').count).toBe(25)
      expect(triangleCount(g)).toBe(32)
    }
    // quad furls to its head (y = 1); triangle furls to its luff (x <= 0)
    const qf = quad.getAttribute('aFurl')
    for (let i = 0; i < qf.count; i++) expect(qf.getY(i)).toBeCloseTo(1, 6)
    const tf = tri.getAttribute('aFurl')
    for (let i = 0; i < tf.count; i++) expect(tf.getX(i)).toBeLessThanOrEqual(1e-6)
  })

  it('breach geometry is deterministic for a seed', () => {
    const a = breachGeometry(0.1, 0.1, 42).getAttribute('position')
    const b = breachGeometry(0.1, 0.1, 42).getAttribute('position')
    expect(Array.from(a.array)).toEqual(Array.from(b.array))
  })

  it('upper sails furl first as the sail setting drops', () => {
    expect(sailSet(1, 0, 4)).toBe(1)
    expect(sailSet(1, 3, 4)).toBe(1)
    expect(sailSet(0.5, 0, 4)).toBeCloseTo(0.5, 6)
    expect(sailSet(0.5, 3, 4)).toBe(0)
    expect(sailSet(0, 0, 4)).toBe(0)
    expect(sailSet(0.6, 1, 4)).toBeGreaterThan(sailSet(0.6, 2, 4))
  })

  it('rigging exists at lod 0/1 and is dropped at lod 2', () => {
    expect(mastRigging(0, 0).length).toBeGreaterThan(mastRigging(0, 1).length)
    expect(mastRigging(1, 2).length).toBe(0)
    for (const s of mastRigging(1, 0)) {
      expect(Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2])).toBeGreaterThan(0.005)
    }
  })
})
