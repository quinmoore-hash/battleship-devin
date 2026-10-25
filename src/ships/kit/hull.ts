import * as THREE from 'three'

/**
 * A hull cross-section at longitudinal position `x` (bow = +x). `halfWidths` run from the keel (y = `keelY`)
 * up to the rail (y = `railY`), evenly spaced; the lofter interpolates between sections.
 */
export interface HullSection {
  x: number
  keelY: number
  railY: number
  /** Half-beam at evenly spaced heights from keel to rail (first value is usually ~0). */
  halfWidths: number[]
}

/**
 * Lofts a closed hull from cross-sections. PLACEHOLDER lofter: linear between sections, no UVs beyond
 * planar projection. The kit session replaces it with a Catmull-Rom loft, plank UVs and a deck cap.
 */
export function loftHull(sections: HullSection[], rings = 6): THREE.BufferGeometry {
  const sorted = [...sections].sort((a, b) => a.x - b.x)
  const positions: number[] = []
  const indices: number[] = []
  const uvs: number[] = []
  const ringVerts = rings * 2 // port + starboard
  const point = (s: HullSection, i: number, side: 1 | -1): [number, number, number] => {
    const t = i / (rings - 1)
    const y = s.keelY + (s.railY - s.keelY) * t
    const k = t * (s.halfWidths.length - 1)
    const lo = Math.floor(k)
    const hi = Math.min(lo + 1, s.halfWidths.length - 1)
    const w = s.halfWidths[lo] + (s.halfWidths[hi] - s.halfWidths[lo]) * (k - lo)
    return [s.x, y, side * w]
  }
  sorted.forEach((s, si) => {
    for (let i = 0; i < rings; i++) {
      const p = point(s, i, 1)
      positions.push(...p)
      uvs.push(si / (sorted.length - 1), i / (rings - 1))
    }
    for (let i = 0; i < rings; i++) {
      const p = point(s, rings - 1 - i, -1)
      positions.push(...p)
      uvs.push(si / (sorted.length - 1), 1 - i / (rings - 1))
    }
  })
  for (let si = 0; si < sorted.length - 1; si++) {
    const a = si * ringVerts
    const b = (si + 1) * ringVerts
    for (let i = 0; i < ringVerts; i++) {
      const j = (i + 1) % ringVerts
      indices.push(a + i, b + i, a + j, a + j, b + i, b + j)
    }
  }
  // cap bow and stern
  const capCenter = (s: HullSection) => [s.x, (s.keelY + s.railY) / 2, 0]
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const sternC = positions.length / 3
  positions.push(...capCenter(first))
  uvs.push(0, 0.5)
  for (let i = 0; i < ringVerts; i++) indices.push(sternC, i, (i + 1) % ringVerts)
  const bowC = positions.length / 3
  positions.push(...capCenter(last))
  uvs.push(1, 0.5)
  const base = (sorted.length - 1) * ringVerts
  for (let i = 0; i < ringVerts; i++) indices.push(bowC, base + ((i + 1) % ringVerts), base + i)

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

/** Convenience: a symmetric hull for a ship of `length` cells. Returns sections bow(+x) → stern(-x). */
export function basicHullSections(length: number, beam: number, draft: number, freeboard: number): HullSection[] {
  const half = length / 2
  const n = 7
  const out: HullSection[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) // 0 stern .. 1 bow
    const x = -half + t * length
    const taper = t < 0.5 ? 0.55 + 0.45 * Math.sin((t / 0.5) * Math.PI * 0.5) : Math.cos(((t - 0.5) / 0.5) * Math.PI * 0.5) * 0.98 + 0.02
    const w = (beam / 2) * taper
    out.push({ x, keelY: -draft * (0.6 + 0.4 * taper), railY: freeboard, halfWidths: [0.02, w * 0.55, w * 0.9, w, w * 0.98, w * 0.9] })
  }
  return out
}
