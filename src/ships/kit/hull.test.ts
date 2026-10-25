import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { basicHullSections, loftHull, loftHullParts, mergeGeometries, splineSample } from './hull'

const finite = (g: THREE.BufferGeometry) => {
  const p = g.attributes.position.array
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) return false
  return true
}

/** Every edge of a watertight mesh is shared by exactly two triangles (after welding coincident vertices). */
function boundaryEdges(g: THREE.BufferGeometry): number {
  const p = g.attributes.position as THREE.BufferAttribute
  const key = new Map<string, number>()
  const weld = (i: number) => {
    const k = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`
    let id = key.get(k)
    if (id === undefined) {
      id = key.size
      key.set(k, id)
    }
    return id
  }
  const edges = new Map<string, number>()
  const ix = g.index!
  for (let t = 0; t < ix.count; t += 3) {
    const a = weld(ix.getX(t))
    const b = weld(ix.getX(t + 1))
    const c = weld(ix.getX(t + 2))
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      if (u === v) continue
      const e = u < v ? `${u}-${v}` : `${v}-${u}`
      edges.set(e, (edges.get(e) ?? 0) + 1)
    }
  }
  let open = 0
  for (const n of edges.values()) if (n !== 2) open++
  return open
}

describe('splineSample', () => {
  it('interpolates through the samples', () => {
    expect(splineSample([0, 1, 2, 3], 0)).toBeCloseTo(0)
    expect(splineSample([0, 1, 2, 3], 1)).toBeCloseTo(3)
    expect(splineSample([0, 1, 2, 3], 1 / 3)).toBeCloseTo(1)
    expect(splineSample([0, 2, 0], 0.5)).toBeCloseTo(2)
    expect(splineSample([5], 0.3)).toBe(5)
  })
})

describe('loftHull', () => {
  const sections = basicHullSections(4, 1.2, 0.5, 0.45)

  it('produces a finite, bounded geometry centred on the origin', () => {
    const g = loftHull(sections)
    expect(finite(g)).toBe(true)
    const b = g.boundingBox!
    expect(b.min.x).toBeCloseTo(-2, 0)
    expect(b.max.x).toBeCloseTo(2, 0)
    expect(b.max.z).toBeCloseTo(0.6, 1)
    expect(b.min.z).toBeCloseTo(-0.6, 1)
    expect(b.max.y).toBeGreaterThanOrEqual(0.45)
    expect(b.min.y).toBeLessThan(-0.5)
    expect(g.attributes.normal).toBeDefined()
    expect(g.attributes.uv).toBeDefined()
  })

  it('is watertight (sides + deck cap close the volume)', () => {
    const parts = loftHullParts(sections, { keel: false })
    const closed = mergeGeometries([parts.sides, parts.deck!])
    expect(boundaryEdges(closed)).toBe(0)
  })

  it('keeps the triangle count in budget and scales with resolution', () => {
    const lo = loftHullParts(sections, { rings: 6, segments: 16 })
    const hi = loftHullParts(sections, { rings: 12, segments: 48 })
    expect(lo.triangles).toBeLessThan(hi.triangles)
    expect(hi.triangles).toBeLessThan(6000)
    expect(lo.triangles).toBeLessThan(1200)
  })

  it('lays plank UVs with u along the hull and v from keel to rail', () => {
    const { sides } = loftHullParts(sections, { plankRepeat: 3 })
    const uv = sides.attributes.uv as THREE.BufferAttribute
    const pos = sides.attributes.position as THREE.BufferAttribute
    let minU = Infinity
    let maxU = -Infinity
    for (let i = 0; i < uv.count; i++) {
      minU = Math.min(minU, uv.getX(i))
      maxU = Math.max(maxU, uv.getX(i))
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0)
      expect(uv.getY(i)).toBeLessThanOrEqual(1)
    }
    expect(minU).toBe(0)
    expect(maxU).toBeCloseTo(3)
    // the keel vertex of the first ring sits at v = 0 and the rail at v = 1
    expect(uv.getY(0)).toBe(0)
    expect(pos.getY(0)).toBeLessThan(pos.getY(9))
    expect(uv.getY(9)).toBe(1)
  })

  it('outward normals point away from the centreline', () => {
    const { sides } = loftHullParts(sections)
    const n = sides.attributes.normal as THREE.BufferAttribute
    const p = sides.attributes.position as THREE.BufferAttribute
    let agree = 0
    let total = 0
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getZ(i)) < 0.05) continue
      total++
      if (Math.sign(n.getZ(i)) === Math.sign(p.getZ(i))) agree++
    }
    expect(agree / total).toBeGreaterThan(0.95)
  })

  it('applies sheer at the ends only', () => {
    const flat = loftHullParts(sections, { sheer: 0 })
    const sheered = loftHullParts(sections, { sheer: 0.3 })
    expect(sheered.railAt(0)).toBeCloseTo(flat.railAt(0), 2)
    expect(sheered.railAt(1.9)).toBeGreaterThan(flat.railAt(1.9) + 0.2)
    expect(sheered.railAt(-1.9)).toBeGreaterThan(flat.railAt(-1.9) + 0.2)
  })

  it('builds keel and wales as separate finite geometries', () => {
    const parts = loftHullParts(sections, { keel: { depth: 0.15, width: 0.1 }, wales: [{ y: 0.1, height: 0.08, depth: 0.05 }] })
    expect(parts.keel).not.toBeNull()
    expect(parts.wales).not.toBeNull()
    expect(finite(parts.keel!)).toBe(true)
    expect(finite(parts.wales!)).toBe(true)
    // keel sits below the hull bottom
    expect(parts.keel!.boundingBox!.min.y).toBeLessThan(parts.sides.boundingBox!.min.y - 0.1)
    // wales stand proud of the planking at their height
    const wb = parts.wales!.boundingBox!
    expect(wb.max.z).toBeGreaterThan(parts.surfaceAt(0, 0.14, 'starboard').position.z + 0.03)
    expect(wb.min.y).toBeCloseTo(0.1, 1)
  })

  it('places gun ports on the hull surface facing outward', () => {
    const parts = loftHullParts(sections, { gunPorts: [{ x: 0.5, y: 0.25, side: 'both' }] })
    expect(parts.gunPorts).toHaveLength(2)
    const [sb, pt] = parts.gunPorts
    expect(sb.side).toBe('starboard')
    expect(sb.position[2]).toBeGreaterThan(0.3)
    expect(pt.position[2]).toBeLessThan(-0.3)
    expect(sb.normal[2]).toBeGreaterThan(0.5)
    expect(pt.normal[2]).toBeLessThan(-0.5)
    expect(Math.abs(sb.rotationY)).toBeLessThan(0.5)
    expect(Math.abs(Math.abs(pt.rotationY) - Math.PI)).toBeLessThan(0.5)
    expect(sb.position[1]).toBeCloseTo(0.25, 1)
  })

  it('accepts the legacy ring-count argument', () => {
    const g = loftHull(sections, 6)
    expect(finite(g)).toBe(true)
    expect(g.index!.count / 3).toBeGreaterThan(100)
  })

  it('basicHullSections tapers to the bow and widens amidships', () => {
    const s = basicHullSections(5, 1.5, 0.5, 0.5)
    expect(s[0].x).toBe(-2.5)
    expect(s[s.length - 1].x).toBe(2.5)
    const mid = s[Math.floor(s.length / 2)]
    const max = (sec: (typeof s)[number]) => Math.max(...sec.halfWidths)
    expect(max(mid)).toBeCloseTo(0.75, 1)
    expect(max(s[s.length - 1])).toBeLessThan(0.1)
    expect(max(s[0])).toBeGreaterThan(0.4)
  })
})
