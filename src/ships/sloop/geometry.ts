/**
 * Geometry builders unique to the Sloop (three.js, no DOM): surface-following bands (wales, bulwarks,
 * cap rails, waterline boot-top), the planked deck cap, rudder blade and simple sweeps for curved spars.
 */
import * as THREE from 'three'
import { deckOutline, hullHalfWidth, hullSlope } from './hull'

export interface PathPoint {
  p: THREE.Vector3
  /** Outward unit normal (horizontal). */
  n: THREE.Vector3
}

/** Points along the hull surface at height `y` on one side, with outward normals. */
export function hullPath(y: number | ((x: number) => number), side: 1 | -1, x0: number, x1: number, n = 24): PathPoint[] {
  const out: PathPoint[] = []
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / (n - 1)
    const yy = typeof y === 'function' ? y(x) : y
    const w = hullHalfWidth(x, yy)
    const slope = hullSlope(x, yy)
    const nrm = new THREE.Vector3(-slope, 0, side).normalize()
    out.push({ p: new THREE.Vector3(x, yy, side * w), n: nrm })
  }
  return out
}

/**
 * Sweeps a rectangular cross-section (`height` up, `thickness` inward along -n, optionally `outset`
 * outward) along a path. Faces are unwelded so the band keeps crisp edges. UV u runs along the path.
 */
export function sweepRect(path: PathPoint[], height: number, thickness: number, outset = 0, yOffset = 0): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const up = new THREE.Vector3(0, 1, 0)
  const corner = (pt: PathPoint, o: number, h: number) => new THREE.Vector3().copy(pt.p).addScaledVector(pt.n, o).addScaledVector(up, h + yOffset)
  // four faces, each a strip of quads: [outer, top, inner, bottom]
  const faces: [number, number, number, number][] = [
    [outset, 0, outset, height], // outer: bottom → top
    [outset, height, outset - thickness, height], // top: outer → inner
    [outset - thickness, height, outset - thickness, 0], // inner: top → bottom
    [outset - thickness, 0, outset, 0], // bottom: inner → outer
  ]
  let lengthAcc = 0
  const u: number[] = path.map((pt, i) => {
    if (i > 0) lengthAcc += pt.p.distanceTo(path[i - 1].p)
    return lengthAcc
  })
  for (const [oA, hA, oB, hB] of faces) {
    const base = pos.length / 3
    path.forEach((pt, i) => {
      const a = corner(pt, oA, hA)
      const b = corner(pt, oB, hB)
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z)
      uv.push(u[i], 0, u[i], 1)
    })
    for (let i = 0; i < path.length - 1; i++) {
      const a = base + i * 2
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  // end caps
  for (const end of [0, path.length - 1]) {
    const pt = path[end]
    const base = pos.length / 3
    const cs = [corner(pt, outset, 0), corner(pt, outset, height), corner(pt, outset - thickness, height), corner(pt, outset - thickness, 0)]
    for (const c of cs) {
      pos.push(c.x, c.y, c.z)
      uv.push(0, 0)
    }
    if (end === 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Merges several geometries that share a material into one draw call (positions, uvs, normals, index). */
export function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const nrm: number[] = []
  const idx: number[] = []
  for (const g of list) {
    const base = pos.length / 3
    const p = g.attributes.position as THREE.BufferAttribute
    const t = g.attributes.uv as THREE.BufferAttribute | undefined
    const n = g.attributes.normal as THREE.BufferAttribute | undefined
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i))
      uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0)
      nrm.push(n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0)
    }
    const index = g.index
    if (index) for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i))
    else for (let i = 0; i < p.count; i++) idx.push(base + i)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setIndex(idx)
  return g
}

/** Applies a matrix to a geometry and returns it (handy before merging). */
export function placed(g: THREE.BufferGeometry, position: [number, number, number], rotation?: [number, number, number], scale?: [number, number, number]): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rotation ?? [0, 0, 0]))),
    new THREE.Vector3(...(scale ?? [1, 1, 1])),
  )
  g.applyMatrix4(m)
  return g
}

/** Planked main deck: the deck outline capped flat at the local deck height, UVs in metres so planks run fore-aft. */
export function deckGeometry(deckYAt: (x: number) => number, inset = 0.0): THREE.BufferGeometry {
  const outline = deckOutline(36)
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z * (1 - inset))))
  const g = new THREE.ShapeGeometry(shape, 1)
  const p = g.attributes.position as THREE.BufferAttribute
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getY(i)
    p.setXYZ(i, x, deckYAt(x), z)
    uv.setXY(i, x, z)
  }
  g.computeVertexNormals()
  return g
}

/** Rudder blade hung on the raked sternpost: a 2D profile in the x/y plane extruded `thickness` across. */
export function rudderGeometry(thickness = 0.03): THREE.BufferGeometry {
  const s = new THREE.Shape()
  s.moveTo(-0.99, 0.42) // rudder head above the transom (tiller fits here)
  s.lineTo(-1.04, 0.42)
  s.lineTo(-1.1, 0.05)
  s.lineTo(-1.2, -0.12)
  s.lineTo(-1.18, -0.26)
  s.lineTo(-1.05, -0.3)
  s.lineTo(-0.95, -0.26)
  s.lineTo(-0.96, -0.05)
  s.lineTo(-0.99, 0.42)
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false })
  g.translate(0, 0, -thickness / 2)
  return g
}

/** Curved tiller / spar: a tube with a square-ish section along a Catmull-Rom path. */
export function sparAlong(points: [number, number, number][], radius: number, radial = 6, segments = 12): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)))
  return new THREE.TubeGeometry(curve, segments, radius, radial, false)
}

/** Open deck grating: two layers of thin bars, merged into one geometry. */
export function gratingGeometry(w: number, d: number, bars = 5, bar = 0.012, h = 0.015): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < bars; i++) {
    const t = -w / 2 + (w * (i + 0.5)) / bars
    parts.push(placed(new THREE.BoxGeometry(bar, h, d), [t, 0, 0]))
    const s = -d / 2 + (d * (i + 0.5)) / bars
    parts.push(placed(new THREE.BoxGeometry(w, h, bar), [0, h * 0.6, s]))
  }
  return mergeGeometries(parts)
}

/** A horn cleat: base + two tapered horns. */
export function cleatGeometry(size = 0.05): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(size * 0.35, size * 0.25, size * 0.25)
  const bar = placed(new THREE.CylinderGeometry(size * 0.08, size * 0.11, size, 6), [0, size * 0.28, 0], [0, 0, Math.PI / 2])
  return mergeGeometries([base, bar])
}

/** Rigging block: a rounded wooden shell with a sheave slot (box + two cylinders). */
export function blockGeometry(size = 0.045): THREE.BufferGeometry {
  const shell = new THREE.CylinderGeometry(size * 0.5, size * 0.5, size * 0.55, 8)
  shell.rotateX(Math.PI / 2)
  const body = new THREE.BoxGeometry(size * 0.7, size * 1.1, size * 0.4)
  return mergeGeometries([shell, body])
}

/** Deadeye: a disc with three holes implied by small dark cylinders. */
export function deadeyeGeometry(r = 0.028): THREE.BufferGeometry {
  const disc = new THREE.CylinderGeometry(r, r, r * 0.45, 12)
  disc.rotateX(Math.PI / 2)
  return disc
}

/** Charred, splintered planks sticking up around a hit: a fan of thin tilted slivers. */
export function splinterGeometry(seedList: number[], spread = 0.12): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  seedList.forEach((r, i) => {
    const a = (i / seedList.length) * Math.PI * 2 + r * 0.8
    const len = 0.05 + r * 0.09
    const g = new THREE.BoxGeometry(0.012 + r * 0.01, len, 0.025)
    g.translate(0, len / 2, 0)
    parts.push(placed(g, [Math.cos(a) * spread * (0.4 + r), 0, Math.sin(a) * spread * (0.4 + r)], [(r - 0.5) * 1.4, a, 0.5 + r * 0.9]))
  })
  return mergeGeometries(parts)
}
