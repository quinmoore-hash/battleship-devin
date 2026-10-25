/**
 * Geometry builders unique to the frigate (pure; no React). Everything returns a `THREE.BufferGeometry`
 * with positions, normals and uvs so the materials' plank / canvas textures map sensibly.
 */
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { FRIGATE, keelY } from './form'

type HW = (x: number, y: number) => number

export interface WallStripOptions {
  x0: number
  x1: number
  yBottom: number
  yTop: number
  /** Half-width function of the hull surface the strip sits on. */
  hw: HW
  /** Outward offset of the outer face from the hull surface. */
  outOffset?: number
  /** Thickness measured inboard from the outer face. */
  thickness: number
  side: 1 | -1
  steps?: number
  /** Texture repeats per unit along x and per unit along y. */
  uvScale?: [number, number]
}

/**
 * A planked strip that follows the hull's half-width curve: used for bulwark panels, wales, the painted
 * gun-stripe, cap rails and gun-port sills/lintels. Each face is a separate smooth strip (hard edges
 * between faces).
 */
export function wallStrip(o: WallStripOptions): THREE.BufferGeometry {
  const { x0, x1, yBottom, yTop, hw, thickness, side } = o
  const out = o.outOffset ?? 0
  const steps = o.steps ?? Math.max(2, Math.ceil(Math.abs(x1 - x0) / 0.06))
  const [su, sv] = o.uvScale ?? [1, 1]
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const corners = (x: number): [Vec3, Vec3, Vec3, Vec3] => {
    const zo0 = side * (hw(x, yBottom) + out)
    const zo1 = side * (hw(x, yTop) + out)
    return [
      [x, yBottom, zo0],
      [x, yTop, zo1],
      [x, yTop, zo1 - side * thickness],
      [x, yBottom, zo0 - side * thickness],
    ]
  }
  // four longitudinal faces: outer (0→1), top (1→2), inner (2→3), bottom (3→0)
  const faces: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ]
  for (const [ca, cb] of faces) {
    const base = pos.length / 3
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps
      const c = corners(x)
      pos.push(...c[ca], ...c[cb])
      const u = x * su
      uv.push(u, (c[ca][1] - yBottom) * sv, u, (c[cb][1] - yBottom) * sv)
    }
    for (let i = 0; i < steps; i++) {
      const a = base + i * 2
      if (side > 0) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
      else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  // end caps
  for (const [x, flip] of [
    [x0, side < 0],
    [x1, side > 0],
  ] as [number, boolean][]) {
    const base = pos.length / 3
    const c = corners(x)
    for (const p of c) {
      pos.push(...p)
      uv.push(p[2] * su, p[1] * sv)
    }
    if (flip) idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Both sides of a strip merged into one geometry. */
export function wallStripPair(o: Omit<WallStripOptions, 'side'>): THREE.BufferGeometry {
  return mergeGeometries([wallStrip({ ...o, side: 1 }), wallStrip({ ...o, side: -1 })])
}

/** Minimal merge for indexed geometries that share the position/uv/normal layout. */
export function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (const g of list) {
    const base = pos.length / 3
    const p = g.getAttribute('position')
    const n = g.getAttribute('normal')
    const t = g.getAttribute('uv')
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i))
      nor.push(n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0)
      uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0)
    }
    const index = g.getIndex()
    if (index) for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i))
    else for (let i = 0; i < p.count; i++) idx.push(base + i)
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  out.setIndex(idx)
  return out
}

/**
 * Re-projects a lofted hull's UVs so planks run along x and strakes stack along y regardless of how the
 * stations are spaced (the kit lofter uses station index for u).
 */
export function remapHullUvs(g: THREE.BufferGeometry, repeatX: number, repeatY: number, vOrigin = (x: number) => keelY(x)): THREE.BufferGeometry {
  const p = g.getAttribute('position')
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    uv[i * 2] = ((x - FRIGATE.xStern) / FRIGATE.length) * repeatX
    uv[i * 2 + 1] = (y - vOrigin(x)) * repeatY
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return g
}

/** Flat deck plate from a half outline (bow→stern, starboard side), mirrored to port. UVs in ship units. */
export function deckPlate(outline: [number, number][], y: number, uvScale = 1): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  outline.forEach(([x, z], i) => (i === 0 ? shape.moveTo(x, z) : shape.lineTo(x, z)))
  for (let i = outline.length - 1; i >= 0; i--) shape.lineTo(outline[i][0], -outline[i][1])
  shape.closePath()
  const g = new THREE.ShapeGeometry(shape, 1)
  // ShapeGeometry lies in the xy plane; rotate to xz with +y up and set uvs from x/z
  g.rotateX(Math.PI / 2)
  g.translate(0, y, 0)
  const p = g.getAttribute('position')
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) * uvScale
    uv[i * 2 + 1] = p.getZ(i) * uvScale
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.computeVertexNormals()
  return g
}

export interface SailGeometryOptions {
  /** 4 corners (head-left, head-right, foot-right, foot-left) for a quad, or 3 (head, clew, tack) for a triangle. */
  corners: Vec3[]
  segments?: number
  /** Direction the sail bellies toward (normalised inside). */
  belly: Vec3
  /** Which edge the cloth gathers to when furled: the head (yard/gaff) or the luff (stay / flag hoist). */
  furlTo?: 'head' | 'luff'
}

/**
 * Sail cloth mesh in the ship frame with the attributes the sail shader needs:
 * `uv` (u across, v up), `aFurl` (where the vertex collapses when furled), `aTanU`/`aTanV` (surface
 * tangents so the shader can rebuild the normal after displacing the cloth).
 */
export function sailGeometry({ corners, segments = 10, belly, furlTo = 'head' }: SailGeometryOptions): THREE.BufferGeometry {
  const n = segments
  const pos: number[] = []
  const uv: number[] = []
  const furl: number[] = []
  const tanU: number[] = []
  const tanV: number[] = []
  const idx: number[] = []
  const v3 = (a: Vec3) => new THREE.Vector3(...a)
  const push = (p: THREE.Vector3, u: number, v: number, f: THREE.Vector3, tu: THREE.Vector3, tv: THREE.Vector3) => {
    pos.push(p.x, p.y, p.z)
    uv.push(u, v)
    furl.push(f.x, f.y, f.z)
    tanU.push(tu.x, tu.y, tu.z)
    tanV.push(tv.x, tv.y, tv.z)
  }
  if (corners.length === 4) {
    const [hl, hr, fr, fl] = corners.map(v3)
    for (let j = 0; j <= n; j++) {
      const v = j / n // 0 foot … 1 head
      const left = fl.clone().lerp(hl, v)
      const right = fr.clone().lerp(hr, v)
      for (let i = 0; i <= n; i++) {
        const u = i / n
        const p = left.clone().lerp(right, u)
        const f = furlTo === 'head' ? hl.clone().lerp(hr, u) : left.clone()
        const tu = right.clone().sub(left)
        const tv = hl.clone().sub(fl).lerp(hr.clone().sub(fr), u)
        push(p, u, v, f, tu, tv)
      }
    }
  } else {
    const [head, clew, tack] = corners.map(v3)
    for (let j = 0; j <= n; j++) {
      const v = j / n
      const luff = tack.clone().lerp(head, v)
      const leech = clew.clone().lerp(head, v)
      for (let i = 0; i <= n; i++) {
        const u = i / n
        const p = luff.clone().lerp(leech, u)
        const tu = leech.clone().sub(luff)
        const tv = head.clone().sub(tack.clone().lerp(clew, u))
        push(p, u, v, luff, tu.lengthSq() < 1e-8 ? clew.clone().sub(tack) : tu, tv)
      }
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i
      const b = a + n + 1
      idx.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('aFurl', new THREE.Float32BufferAttribute(furl, 3))
  g.setAttribute('aTanU', new THREE.Float32BufferAttribute(tanU, 3))
  g.setAttribute('aTanV', new THREE.Float32BufferAttribute(tanV, 3))
  g.setIndex(idx)
  const b = v3(belly).normalize()
  const nor = new Float32Array(pos.length)
  for (let i = 0; i < pos.length; i += 3) {
    nor[i] = b.x
    nor[i + 1] = b.y
    nor[i + 2] = b.z
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  return g
}

/** Tapered spar (mast section, yard, bowsprit) along +y from 0 to `length`. */
export function spar(length: number, r0: number, r1: number, segments = 8): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, length, segments, 1)
  g.translate(0, length / 2, 0)
  return g
}

/** Rope-like tube through `points` (Catmull-Rom). */
export function tube(points: Vec3[], radius: number, tubular = 24, radial = 6, closed = false): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed)
  return new THREE.TubeGeometry(curve, tubular, radius, radial, closed)
}

/** Count triangles of a geometry (indexed or not). */
export function triangleCount(g: THREE.BufferGeometry): number {
  const index = g.getIndex()
  return index ? index.count / 3 : g.getAttribute('position').count / 3
}

/** Longitudinal ridge (keel, sternpost, rubbing strake) whose bottom/top follow functions of x. */
export function ridge(xs: number[], yBot: (x: number) => number, yTop: (x: number) => number, halfZ: number, uvScale = 1): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const faces: [(x: number) => Vec3, (x: number) => Vec3][] = [
    [(x) => [x, yBot(x), halfZ], (x) => [x, yTop(x), halfZ]], // starboard
    [(x) => [x, yTop(x), halfZ], (x) => [x, yTop(x), -halfZ]], // top
    [(x) => [x, yTop(x), -halfZ], (x) => [x, yBot(x), -halfZ]], // port
    [(x) => [x, yBot(x), -halfZ], (x) => [x, yBot(x), halfZ]], // bottom
  ]
  for (const [fa, fb] of faces) {
    const base = pos.length / 3
    xs.forEach((x) => {
      const a = fa(x)
      const b = fb(x)
      pos.push(...a, ...b)
      uv.push(x * uvScale, 0, x * uvScale, 1)
    })
    for (let i = 0; i < xs.length - 1; i++) {
      const a = base + i * 2
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  for (const [x, flip] of [
    [xs[0], true],
    [xs[xs.length - 1], false],
  ] as [number, boolean][]) {
    const base = pos.length / 3
    const c: Vec3[] = [
      [x, yBot(x), halfZ],
      [x, yTop(x), halfZ],
      [x, yTop(x), -halfZ],
      [x, yBot(x), -halfZ],
    ]
    for (const p of c) {
      pos.push(...p)
      uv.push(p[2] * uvScale, p[1] * uvScale)
    }
    if (flip) idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Box helper returning a translated/rotated BoxGeometry (for merging many small timbers into one mesh). */
export function box(w: number, h: number, d: number, at: Vec3, rotY = 0, rotX = 0, rotZ = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  if (rotX) g.rotateX(rotX)
  if (rotZ) g.rotateZ(rotZ)
  if (rotY) g.rotateY(rotY)
  g.translate(...at)
  return g
}

/** Cylinder along +y centred at `at` (optionally rotated), for merging. */
export function cyl(rTop: number, rBot: number, h: number, at: Vec3, seg = 8, rotX = 0, rotZ = 0): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1)
  if (rotX) g.rotateX(rotX)
  if (rotZ) g.rotateZ(rotZ)
  g.translate(...at)
  return g
}

/**
 * Jagged cannonball breach: a splintered disc on the hull surface plus a dark tube going inboard so the
 * hole reads as a hole from oblique angles. Faces +z; rotate π about y for the port side.
 */
export function breachGeometry(radius: number, depth: number, seed: number): THREE.BufferGeometry {
  let s = seed >>> 0
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  const shape = new THREE.Shape()
  const n = 14
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const r = radius * (0.62 + rnd() * 0.55)
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  const disc = new THREE.ShapeGeometry(shape, 1)
  const tubeG = new THREE.CylinderGeometry(radius * 0.72, radius * 0.5, depth, 10, 1, true)
  tubeG.rotateX(Math.PI / 2)
  tubeG.translate(0, 0, -depth / 2 + 0.002)
  // the tube is seen from inside: flip its winding so the inner faces render
  const idx = tubeG.getIndex()
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const t = idx.getX(i + 1)
      idx.setX(i + 1, idx.getX(i + 2))
      idx.setX(i + 2, t)
    }
  }
  tubeG.computeVertexNormals()
  return mergeGeometries([disc, tubeG])
}
