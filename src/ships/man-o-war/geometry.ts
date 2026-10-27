/**
 * Pure three.js geometry builders for the Man-o’-War. No React, no DOM: everything here can run under Vitest.
 */
import * as THREE from 'three'
import { ropeRadiusAtLod } from '../kit/Rope'
import type { Lod } from '../types'
import type { Vec3 } from '../../scene/layout'
import { seededRandom } from '../../vfx/random'
import type { HullSection } from '../kit'
import { hullHalfWidth, keelY, railY, X_BOW, X_STERN } from './spec'

export type Tri = [number, number, number]

const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const tmpC = new THREE.Vector3()
const tmpN = new THREE.Vector3()

export interface LoftOptions {
  /** Expected outward direction of the surface; winding is flipped when the first face disagrees. */
  outward?: Vec3 | ((p: Vec3) => Vec3)
  /** UV scale along (curve length, across curves). */
  uvScale?: [number, number]
  /** Close the surface across the first/last curve. */
  closeAcross?: boolean
}

/**
 * Connect consecutive polylines (all with the same vertex count) into a quad-strip surface.
 * UVs are arc-length based so plank/rope textures do not stretch.
 */
export function loftCurves(curves: Vec3[][], { outward, uvScale = [1, 1], closeAcross = false }: LoftOptions = {}): THREE.BufferGeometry {
  const n = curves[0].length
  const rows = closeAcross ? [...curves, curves[0]] : curves
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let vAcc = 0
  rows.forEach((curve, r) => {
    if (r > 0) {
      const prev = rows[r - 1]
      let d = 0
      for (let i = 0; i < n; i++) d += dist(prev[i], curve[i])
      vAcc += d / n
    }
    let uAcc = 0
    for (let i = 0; i < n; i++) {
      if (i > 0) uAcc += dist(curve[i - 1], curve[i])
      positions.push(curve[i][0], curve[i][1], curve[i][2])
      uvs.push(uAcc * uvScale[0], vAcc * uvScale[1])
    }
  })
  for (let r = 0; r < rows.length - 1; r++) {
    const a = r * n
    const b = (r + 1) * n
    for (let i = 0; i < n - 1; i++) {
      indices.push(a + i, b + i, a + i + 1, a + i + 1, b + i, b + i + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(indices)
  if (outward) orientOutward(g, outward)
  g.computeVertexNormals()
  return g
}

function dist(a: Vec3, b: Vec3) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** Flip the winding when the area-weighted normal disagrees with the hint. */
export function orientOutward(g: THREE.BufferGeometry, outward: Vec3 | ((p: Vec3) => Vec3)) {
  const idx = g.getIndex()!
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  let dot = 0
  for (let t = 0; t < idx.count; t += 3) {
    tmpA.fromBufferAttribute(pos, idx.getX(t))
    tmpB.fromBufferAttribute(pos, idx.getX(t + 1))
    tmpC.fromBufferAttribute(pos, idx.getX(t + 2))
    tmpN.subVectors(tmpB, tmpA).cross(tmpC.sub(tmpA))
    const hint = typeof outward === 'function' ? outward([(tmpA.x + tmpB.x) / 2, (tmpA.y + tmpB.y) / 2, (tmpA.z + tmpB.z) / 2]) : outward
    dot += tmpN.x * hint[0] + tmpN.y * hint[1] + tmpN.z * hint[2]
  }
  if (dot < 0) {
    for (let t = 0; t < idx.count; t += 3) {
      const b = idx.getX(t + 1)
      idx.setX(t + 1, idx.getX(t + 2))
      idx.setX(t + 2, b)
    }
    idx.needsUpdate = true
  }
}

/** Longitudinal stations, denser toward the ends where the hull curves most. */
export function stations(x0 = X_STERN, x1 = X_BOW, n = 26): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1)
    const e = 0.5 - 0.5 * Math.cos(t * Math.PI) // cosine spacing
    out.push(x0 + (x1 - x0) * (0.35 * t + 0.65 * e))
  }
  return out
}

/** Polyline along the hull skin at height `y` (or a per-x height) offset `off` outward on `side`. */
export function hullCurve(y: number | ((x: number) => number), side: 1 | -1, off = 0, xs = stations()): Vec3[] {
  return xs.map((x) => {
    const yy = typeof y === 'function' ? y(x) : y
    return [x, yy, side * (hullHalfWidth(x, yy) + off)] as Vec3
  })
}

/** Cross-sections for the kit lofter, split at the waterline so the topsides and the bottom get their own material. */
export function hullSections(part: 'above' | 'below', rings = 12): HullSection[] {
  return stations().map((x) => {
    const lo = part === 'below' ? keelY(x) : 0
    const hi = part === 'below' ? 0 : railY(x)
    const halfWidths: number[] = []
    for (let i = 0; i < rings; i++) {
      const y = lo + ((hi - lo) * i) / (rings - 1)
      halfWidths.push(hullHalfWidth(x, y))
    }
    return { x, keelY: lo, railY: hi, halfWidths }
  })
}

/**
 * Raised band (wale / stripe / rubbing strake) following the hull skin between heights y0..y1 on one side,
 * `thickness` proud of the planking, closed top and bottom so it reads as a solid timber.
 */
export function hullBand(y0: number | ((x: number) => number), y1: number | ((x: number) => number), side: 1 | -1, thickness: number, x0 = X_STERN, x1 = X_BOW, n = 24): THREE.BufferGeometry {
  const xs = stations(x0, x1, n)
  const inner0 = hullCurve(y0, side, 0.001, xs)
  const outer0 = hullCurve(y0, side, thickness, xs)
  const outer1 = hullCurve(y1, side, thickness, xs)
  const inner1 = hullCurve(y1, side, 0.001, xs)
  return loftCurves([inner0, outer0, outer1, inner1], { outward: (p) => [0, 0, Math.sign(p[2]) || side], uvScale: [1, 1] })
}

/** Outline of the deck at height `y` between x0..x1, inset from the skin; used for deck planking shapes. */
export function deckGeometry(x0: number, x1: number, y: number, inset = 0.035, n = 18): THREE.BufferGeometry {
  const xs = stations(x0, x1, n)
  const shape = new THREE.Shape()
  xs.forEach((x, i) => {
    const z = Math.max(0.01, hullHalfWidth(x, y) - inset)
    if (i === 0) shape.moveTo(x, z)
    else shape.lineTo(x, z)
  })
  for (let i = xs.length - 1; i >= 0; i--) {
    const x = xs[i]
    shape.lineTo(x, -Math.max(0.01, hullHalfWidth(x, y) - inset))
  }
  shape.closePath()
  const g = new THREE.ShapeGeometry(shape, 1)
  // Shape (x, s) -> ship (x, y, z = s); flip so the face points up.
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const s = pos.getY(i)
    pos.setXYZ(i, pos.getX(i), y, s)
  }
  orientOutward(g, [0, 1, 0])
  g.computeVertexNormals()
  return g
}

/** Flat transverse bulkhead at x between two deck levels (a castle "break"). */
export function bulkheadGeometry(x: number, y0: number, y1: number, inset = 0.03, facing: 1 | -1 = 1, n = 9): THREE.BufferGeometry {
  const rowAt = (y: number): Vec3[] => {
    const w = hullHalfWidth(x, y) - inset
    return Array.from({ length: n }, (_, i) => [x, y, -w + (2 * w * i) / (n - 1)] as Vec3)
  }
  const rows = 4
  const curves = Array.from({ length: rows }, (_, r) => rowAt(y0 + ((y1 - y0) * r) / (rows - 1)))
  return loftCurves(curves, { outward: [facing, 0, 0] })
}

export interface RopeSeg {
  a: Vec3
  b: Vec3
  r: number
}

/** All ropes of a rig as one geometry: thin open tubes, 4 or 5 facets, arc-length UVs for the twist texture. */
export function ropeTubes(segs: RopeSeg[], facets = 4, lod: Lod = 0): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const dir = new THREE.Vector3()
  const n1 = new THREE.Vector3()
  const n2 = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const alt = new THREE.Vector3(1, 0, 0)
  for (const s of segs) {
    dir.set(s.b[0] - s.a[0], s.b[1] - s.a[1], s.b[2] - s.a[2])
    const len = dir.length()
    if (len < 1e-5) continue
    dir.divideScalar(len)
    const r = ropeRadiusAtLod(s.r, lod)
    n1.crossVectors(dir, Math.abs(dir.y) > 0.9 ? alt : up).normalize()
    n2.crossVectors(dir, n1).normalize()
    const base = positions.length / 3
    for (let end = 0; end < 2; end++) {
      const p = end === 0 ? s.a : s.b
      for (let k = 0; k <= facets; k++) {
        const ang = (k / facets) * Math.PI * 2
        const nx = Math.cos(ang) * n1.x + Math.sin(ang) * n2.x
        const ny = Math.cos(ang) * n1.y + Math.sin(ang) * n2.y
        const nz = Math.cos(ang) * n1.z + Math.sin(ang) * n2.z
        positions.push(p[0] + nx * r, p[1] + ny * r, p[2] + nz * r)
        normals.push(nx, ny, nz)
        uvs.push(k / facets, end === 0 ? 0 : len / (s.r * 6))
      }
    }
    for (let k = 0; k < facets; k++) {
      const a = base + k
      const b = base + facets + 1 + k
      indices.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(indices)
  return g
}

/** Shroud pair + ratline rungs between a channel point and a mast head, for one side. */
export function shroudSegs(foot: Vec3[], head: Vec3, rungs: boolean, rungSpacing = 0.09, r = 0.009): RopeSeg[] {
  const segs: RopeSeg[] = foot.map((f) => ({ a: f, b: head, r }))
  if (rungs && foot.length > 1) {
    const first = foot[0]
    const last = foot[foot.length - 1]
    const len = dist(first, head)
    const count = Math.floor((len * 0.82) / rungSpacing)
    for (let i = 1; i <= count; i++) {
      const t = (i * rungSpacing) / len
      segs.push({
        a: [first[0] + (head[0] - first[0]) * t, first[1] + (head[1] - first[1]) * t, first[2] + (head[2] - first[2]) * t],
        b: [last[0] + (head[0] - last[0]) * t, last[1] + (head[1] - last[1]) * t, last[2] + (head[2] - last[2]) * t],
        r: r * 0.6,
      })
    }
  }
  return segs
}

export interface ClothOptions {
  /** head-left, head-right, foot-right, foot-left (a triangle when the last two coincide). */
  corners: [Vec3, Vec3, Vec3, Vec3]
  /** Direction the cloth bellies toward (unit). */
  dir: Vec3
  /** Belly depth at full set. */
  belly: number
  /** 0 furled … 1 full. */
  set: number
  /** 0 pristine … 1 gone. */
  torn: number
  seed: number
  segs?: [number, number]
  /** Keep the foot where it is when furling (gaff sails brail to the mast instead of the yard). */
  furlToHead?: boolean
}

/**
 * Billowing sail cloth. Static belly baked into the geometry (recomputed only when set/torn change) and a
 * per-vertex `aFlutter` attribute the shared sail material animates in the vertex shader.
 */
export function clothGeometry({ corners, dir, belly, set, torn, seed, segs = [10, 8], furlToHead = true }: ClothOptions): THREE.BufferGeometry {
  const [nu, nv] = segs
  const [a, b, c, d] = corners
  const rand = seededRandom(seed)
  const foot = furlToHead ? 0.07 + 0.93 * set : 1
  const positions: number[] = []
  const uvs: number[] = []
  const flutter: number[] = []
  const indices: number[] = []
  for (let j = 0; j <= nv; j++) {
    const v = (j / nv) * foot
    for (let i = 0; i <= nu; i++) {
      const u = i / nu
      const hx = a[0] + (b[0] - a[0]) * u
      const hy = a[1] + (b[1] - a[1]) * u
      const hz = a[2] + (b[2] - a[2]) * u
      const fx = d[0] + (c[0] - d[0]) * u
      const fy = d[1] + (c[1] - d[1]) * u
      const fz = d[2] + (c[2] - d[2]) * u
      const vv = j / nv
      const shape = Math.sin(Math.PI * u) * Math.pow(vv, 0.55) * Math.pow(1 - vv, 0.35) * 1.9
      const bulge = belly * set * shape
      positions.push(hx + (fx - hx) * v + dir[0] * bulge, hy + (fy - hy) * v + dir[1] * bulge, hz + (fz - hz) * v + dir[2] * bulge)
      uvs.push(u, vv)
      flutter.push(set * (0.3 + 0.7 * vv) * (0.6 + 0.4 * Math.sin(Math.PI * u)))
    }
  }
  // Ragged strips hang from the head: each column keeps a different length, the last quad of a strip keeps
  // only one triangle (a jagged tip), and heavier tearing punches triangular holes through the cloth.
  const stripCut = Array.from({ length: nu }, () => (torn <= 0 ? 0 : Math.min(1.05, torn * (0.45 + 0.9 * rand()))))
  // smooth value noise over the cloth so holes are coherent blobs rather than confetti
  const gn = 5
  const grid = Array.from({ length: (gn + 1) * (gn + 1) }, () => rand())
  const noise = (u: number, v: number) => {
    const x = u * gn
    const y = v * gn
    const x0 = Math.min(gn - 1, Math.floor(x))
    const y0 = Math.min(gn - 1, Math.floor(y))
    const fx = x - x0
    const fy = y - y0
    const g = (i: number, j: number) => grid[j * (gn + 1) + i]
    return (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy
  }
  const holeLevel = torn > 0.25 ? 0.12 + (torn - 0.25) * 0.5 : -1
  const tipFlip = Array.from({ length: nu }, () => rand() < 0.5)
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const vTop = j / nv
      const vBottom = (j + 1) / nv
      if (vTop > 1 - stripCut[i]) continue
      const tip = torn > 0 && vBottom > 1 - stripCut[i]
      const p = j * (nu + 1) + i
      if (noise((i + 0.5) / nu, (j + 0.5) / nv) < holeLevel) continue
      if (!tip || tipFlip[i]) indices.push(p, p + nu + 1, p + 1)
      if (!tip || !tipFlip[i]) indices.push(p + 1, p + nu + 1, p + nu + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setAttribute('aFlutter', new THREE.Float32BufferAttribute(flutter, 1))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

/**
 * The kit lofter closes its ring loop across the rail, which puts a skin over the deck at bulwark height.
 * Drop every triangle whose three vertices all lie on that top edge (y ≥ topY(x) − tol) so the hull is an open tub.
 */
export function dropTopSkin(g: THREE.BufferGeometry, topY: (x: number) => number, tol = 0.012): THREE.BufferGeometry {
  const idx = g.getIndex()
  if (!idx) return g
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const onTop = (i: number) => pos.getY(i) >= topY(pos.getX(i)) - tol
  const kept: number[] = []
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t)
    const b = idx.getX(t + 1)
    const c = idx.getX(t + 2)
    if (onTop(a) && onTop(b) && onTop(c)) continue
    kept.push(a, b, c)
  }
  g.setIndex(kept)
  g.computeVertexNormals()
  return g
}

/** Count triangles of a geometry (indexed or not). */
export function triangleCount(g: THREE.BufferGeometry): number {
  const idx = g.getIndex()
  return Math.floor((idx ? idx.count : g.getAttribute('position').count) / 3)
}

/** Jagged splinter burst around a hull breach: thin shards pointing outward, seeded. */
export function splinterTransforms(seed: number, count: number, outward: 1 | -1): { pos: Vec3; rot: Vec3; scale: Vec3 }[] {
  const rand = seededRandom(seed)
  return Array.from({ length: count }, () => {
    const ang = rand() * Math.PI * 2
    const rad = 0.06 + rand() * 0.12
    const len = 0.08 + rand() * 0.14
    return {
      pos: [Math.cos(ang) * rad, Math.sin(ang) * rad * 0.8, outward * (0.01 + rand() * 0.05)] as Vec3,
      rot: [(rand() - 0.5) * 1.2, (rand() - 0.5) * 1.4 + (outward > 0 ? 0 : Math.PI), ang + (rand() - 0.5) * 0.6] as Vec3,
      scale: [len, 0.012 + rand() * 0.012, 0.01] as Vec3,
    }
  })
}

/** Irregular scorch patch outline (radius jittered around a circle). */
export function scorchGeometry(seed: number, radius: number, n = 14): THREE.BufferGeometry {
  const rand = seededRandom(seed)
  const shape = new THREE.Shape()
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2
    const r = radius * (0.55 + 0.45 * rand())
    const x = Math.cos(ang) * r * 1.4
    const z = Math.sin(ang) * r
    if (i === 0) shape.moveTo(x, z)
    else shape.lineTo(x, z)
  }
  shape.closePath()
  const g = new THREE.ShapeGeometry(shape, 1)
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i), 0, pos.getY(i))
  orientOutward(g, [0, 1, 0])
  g.computeVertexNormals()
  return g
}
