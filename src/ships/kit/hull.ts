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

export interface WaleSpec {
  /** Bottom of the band, absolute y (waterline = 0). */
  y: number
  height: number
  /** How far the band stands proud of the planking. */
  depth?: number
}

export interface GunPortSpec {
  x: number
  /** Centre height, absolute y. */
  y: number
  width?: number
  height?: number
  side: 'port' | 'starboard' | 'both'
}

export interface GunPortPlacement {
  side: 'port' | 'starboard'
  position: [number, number, number]
  /** Outward unit normal of the hull at the port. */
  normal: [number, number, number]
  /** Rotation about y that points local +z along the horizontal part of `normal`. */
  rotationY: number
  width: number
  height: number
}

export interface LoftOptions {
  /** Vertical samples per side, keel → rail. */
  rings?: number
  /** Longitudinal samples over the whole hull (defaults to 6 per section). */
  segments?: number
  /** Extra rail rise at the bow and stern (metres); 0 at midships. */
  sheer?: number
  /** Build the flat deck cap at the rail (default true). */
  deck?: boolean
  /** Keel + stem/stern post box extrusion. `false` to skip. */
  keel?: { depth?: number; width?: number } | false
  /** Raised horizontal bands. */
  wales?: WaleSpec[]
  /** Gun-port positions; returns placements for `<GunPort>`. */
  gunPorts?: GunPortSpec[]
  /** Texture repeats of the plank texture along the whole length (default: one per 2 m). */
  plankRepeat?: number
}

export interface LoftedHull {
  /** Planked sides + bow/stern fans. Plank UVs: u along the hull, v keel → rail. */
  sides: THREE.BufferGeometry
  deck: THREE.BufferGeometry | null
  keel: THREE.BufferGeometry | null
  wales: THREE.BufferGeometry | null
  gunPorts: GunPortPlacement[]
  bounds: THREE.Box3
  /** Total triangles across every geometry. */
  triangles: number
  /** Hull surface point / outward normal at longitudinal `x`, absolute height `y` (clamped to keel…rail). */
  surfaceAt: (x: number, y: number, side: 'port' | 'starboard') => { position: THREE.Vector3; normal: THREE.Vector3 }
  /** Rail height at `x` (after sheer). */
  railAt: (x: number) => number
  keelAt: (x: number) => number
}

const V = THREE.Vector3
/** Deck cap subdivisions across the beam. */
const DECK_ACROSS = 4

/** Catmull-Rom through evenly spaced scalar samples, `t` in [0,1]. */
export function splineSample(values: number[], t: number): number {
  const n = values.length
  if (n === 1) return values[0]
  const k = Math.min(Math.max(t, 0), 1) * (n - 1)
  const i = Math.min(Math.floor(k), n - 2)
  const f = k - i
  const p0 = values[Math.max(i - 1, 0)]
  const p1 = values[i]
  const p2 = values[i + 1]
  const p3 = values[Math.min(i + 2, n - 1)]
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f)
}

function makeGeometry(positions: number[], uvs: number[], indices: number[], normals?: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(indices)
  if (normals) g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  else g.computeVertexNormals()
  g.computeBoundingBox()
  return g
}

/** Catmull-Rom smoothed loft of a planked hull. See `LoftOptions` for the optional deck / keel / wales / gun ports. */
export function loftHullParts(sectionsIn: HullSection[], opts: LoftOptions = {}): LoftedHull {
  const sorted = [...sectionsIn].sort((a, b) => a.x - b.x)
  const rings = Math.max(3, opts.rings ?? 10)
  const segments = Math.max(sorted.length - 1, opts.segments ?? (sorted.length - 1) * 6)
  const xMin = sorted[0].x
  const xMax = sorted[sorted.length - 1].x
  const length = xMax - xMin
  const sheer = opts.sheer ?? 0
  const sections = sorted.map((s) => {
    const u = length > 0 ? (s.x - xMin) / length : 0.5
    return { ...s, railY: s.railY + sheer * 4 * (u - 0.5) * (u - 0.5) }
  })

  // One Catmull-Rom curve per ring through the sections (x, y, halfWidth).
  const ringCurves: THREE.CatmullRomCurve3[] = []
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1)
    const pts = sections.map((s) => new V(s.x, s.keelY + (s.railY - s.keelY) * t, Math.max(0, splineSample(s.halfWidths, t))))
    ringCurves.push(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5))
  }
  // starboard samples: grid[j][i] (segment, ring)
  const grid: THREE.Vector3[][] = []
  for (let j = 0; j <= segments; j++) {
    const u = j / segments
    const row: THREE.Vector3[] = []
    for (let i = 0; i < rings; i++) {
      const p = ringCurves[i].getPoint(u)
      if (i === 0) p.z = 0
      row.push(p)
    }
    // keep the keel at the bottom even if the spline overshoots near the ends
    grid.push(row)
  }

  const plankRepeat = opts.plankRepeat ?? length / 2
  const loopLen = 2 * rings - 1
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let j = 0; j <= segments; j++) {
    const u = (j / segments) * plankRepeat
    const row = grid[j]
    for (let i = 0; i < rings; i++) {
      positions.push(row[i].x, row[i].y, row[i].z)
      uvs.push(u, i / (rings - 1))
    }
    for (let k = rings; k < loopLen; k++) {
      const i = loopLen - k // rings-1 … 1
      positions.push(row[i].x, row[i].y, -row[i].z)
      uvs.push(u, i / (rings - 1))
    }
  }
  const idx = (j: number, k: number) => j * loopLen + k
  for (let j = 0; j < segments; j++) {
    for (let k = 0; k < loopLen; k++) {
      if (k === rings - 1) continue // the open top between the two rail edges
      const k2 = (k + 1) % loopLen
      const a = idx(j, k)
      const b = idx(j + 1, k)
      const c = idx(j, k2)
      const d = idx(j + 1, k2)
      indices.push(a, c, b, c, d, b)
    }
  }
  // bow and stern fans
  const fan = (j: number, forward: boolean) => {
    const row = grid[j]
    const centre = positions.length / 3
    const cy = (row[0].y + row[rings - 1].y) / 2
    positions.push(row[0].x, cy, 0)
    uvs.push(forward ? plankRepeat : 0, 0.5)
    for (let k = 0; k < loopLen; k++) {
      const k2 = (k + 1) % loopLen
      if (k === rings - 1) continue
      if (forward) indices.push(centre, idx(j, k2), idx(j, k))
      else indices.push(centre, idx(j, k), idx(j, k2))
    }
    // close the top sliver of the fan along the deck edge (subdivided to match the deck cap)
    const rail = row[rings - 1]
    const first = positions.length / 3
    for (let a = 0; a <= DECK_ACROSS; a++) {
      positions.push(rail.x, rail.y, rail.z - (2 * rail.z * a) / DECK_ACROSS)
      uvs.push(forward ? plankRepeat : 0, 1)
    }
    for (let a = 0; a < DECK_ACROSS; a++) {
      if (forward) indices.push(centre, first + a, first + a + 1)
      else indices.push(centre, first + a + 1, first + a)
    }
  }
  fan(0, false)
  fan(segments, true)
  const sides = makeGeometry(positions, uvs, indices)
  // Flip winding if normals ended up inward (depends on section ordering).
  {
    const n = sides.attributes.normal as THREE.BufferAttribute
    const mid = idx(Math.floor(segments / 2), Math.floor(rings / 2))
    if (n.getZ(mid) < 0) {
      const ix = sides.index!
      for (let i = 0; i < ix.count; i += 3) {
        const t = ix.getX(i + 1)
        ix.setX(i + 1, ix.getX(i + 2))
        ix.setX(i + 2, t)
      }
      sides.computeVertexNormals()
    }
  }

  let triangles = indices.length / 3
  const bounds = new THREE.Box3().setFromBufferAttribute(sides.attributes.position as THREE.BufferAttribute)

  // deck cap
  let deck: THREE.BufferGeometry | null = null
  if (opts.deck !== false) {
    const dp: number[] = []
    const duv: number[] = []
    const di: number[] = []
    const dn: number[] = []
    const across = DECK_ACROSS
    for (let j = 0; j <= segments; j++) {
      const r = grid[j][rings - 1]
      for (let a = 0; a <= across; a++) {
        const z = r.z - (2 * r.z * a) / across
        dp.push(r.x, r.y, z)
        duv.push((r.x - xMin) / 2, z / 2 + 0.5)
        dn.push(0, 1, 0)
      }
    }
    for (let j = 0; j < segments; j++) {
      for (let a = 0; a < across; a++) {
        const p = j * (across + 1) + a
        const q = p + across + 1
        di.push(p, p + 1, q, p + 1, q + 1, q)
      }
    }
    deck = makeGeometry(dp, duv, di, dn)
    triangles += di.length / 3
  }

  const keelY = (j: number) => grid[j][0].y
  const railY = (j: number) => grid[j][rings - 1].y

  // keel + stem + stern post: rectangular tube along the centreline profile
  let keel: THREE.BufferGeometry | null = null
  if (opts.keel !== false) {
    const depth = opts.keel?.depth ?? 0.12
    const width = opts.keel?.width ?? 0.1
    const path: THREE.Vector2[] = []
    path.push(new THREE.Vector2(grid[0][0].x, railY(0) + 0.12))
    for (let i = rings - 1; i >= 1; i--) path.push(new THREE.Vector2(grid[0][i].x - 0.02 * (i / rings), grid[0][i].y))
    for (let j = 0; j <= segments; j++) path.push(new THREE.Vector2(grid[j][0].x, keelY(j)))
    for (let i = 1; i < rings; i++) path.push(new THREE.Vector2(grid[segments][i].x + 0.05 * (i / rings), grid[segments][i].y))
    path.push(new THREE.Vector2(grid[segments][0].x + 0.1, railY(segments) + 0.2))
    const kp: number[] = []
    const kuv: number[] = []
    const ki: number[] = []
    const tmp = new THREE.Vector2()
    let dist = 0
    for (let p = 0; p < path.length; p++) {
      const prev = path[Math.max(p - 1, 0)]
      const next = path[Math.min(p + 1, path.length - 1)]
      tmp.subVectors(next, prev).normalize()
      const nx = tmp.y
      const ny = -tmp.x
      if (p > 0) dist += path[p].distanceTo(path[p - 1])
      const inner = { x: path[p].x - nx * 0.04, y: path[p].y - ny * 0.04 }
      const outer = { x: path[p].x + nx * depth, y: path[p].y + ny * depth }
      // 4 corners: inner+z, outer+z, outer-z, inner-z
      kp.push(inner.x, inner.y, width / 2, outer.x, outer.y, width / 2, outer.x, outer.y, -width / 2, inner.x, inner.y, -width / 2)
      for (let c = 0; c < 4; c++) kuv.push(dist, c / 4)
      if (p > 0) {
        const a = (p - 1) * 4
        const b = p * 4
        for (let c = 0; c < 4; c++) {
          const c2 = (c + 1) % 4
          ki.push(a + c, b + c, a + c2, a + c2, b + c, b + c2)
        }
      }
    }
    // end caps
    const last = (path.length - 1) * 4
    ki.push(0, 2, 1, 0, 3, 2, last, last + 1, last + 2, last, last + 2, last + 3)
    keel = makeGeometry(kp, kuv, ki)
    triangles += ki.length / 3
  }

  // surface sampling helpers
  const segmentForX = (x: number) => {
    // rail-ring x is monotonic enough; binary search over segments
    let lo = 0
    let hi = segments
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (grid[mid][rings - 1].x < x) lo = mid
      else hi = mid
    }
    const x0 = grid[lo][rings - 1].x
    const x1 = grid[hi][rings - 1].x
    const f = x1 === x0 ? 0 : Math.min(1, Math.max(0, (x - x0) / (x1 - x0)))
    return { j: lo, f }
  }
  const rowAt = (j: number, f: number) => grid[j].map((p, i) => p.clone().lerp(grid[Math.min(j + 1, segments)][i], f))
  const surfaceOnRow = (row: THREE.Vector3[], y: number, side: 'port' | 'starboard') => {
    const sign = side === 'starboard' ? 1 : -1
    const yc = Math.min(Math.max(y, row[0].y), row[rings - 1].y)
    let i = 0
    while (i < rings - 2 && row[i + 1].y < yc) i++
    const a = row[i]
    const b = row[i + 1]
    const f = b.y === a.y ? 0 : (yc - a.y) / (b.y - a.y)
    const position = new V(a.x + (b.x - a.x) * f, yc, (a.z + (b.z - a.z) * f) * sign)
    // outward normal in the cross-section plane
    const dz = b.z - a.z
    const dy = b.y - a.y
    const normal = new V(0, -dz * sign, dy * sign).normalize()
    if (normal.z * sign < 0) normal.negate()
    return { position, normal }
  }
  const surfaceAt: LoftedHull['surfaceAt'] = (x, y, side) => {
    const { j, f } = segmentForX(x)
    return surfaceOnRow(rowAt(j, f), y, side)
  }
  const railAt = (x: number) => {
    const { j, f } = segmentForX(x)
    return railY(j) + (railY(Math.min(j + 1, segments)) - railY(j)) * f
  }
  const keelAt = (x: number) => {
    const { j, f } = segmentForX(x)
    return keelY(j) + (keelY(Math.min(j + 1, segments)) - keelY(j)) * f
  }

  // wales: raised bands following the surface
  let wales: THREE.BufferGeometry | null = null
  if (opts.wales && opts.wales.length) {
    const wp: number[] = []
    const wuv: number[] = []
    const wi: number[] = []
    for (const wale of opts.wales) {
      const depth = wale.depth ?? 0.04
      for (const side of ['starboard', 'port'] as const) {
        const base = wp.length / 3
        for (let j = 0; j <= segments; j++) {
          const row = grid[j]
          const lo = surfaceOnRow(row, wale.y, side)
          const hi = surfaceOnRow(row, wale.y + wale.height, side)
          const u = (j / segments) * plankRepeat
          const push = (p: THREE.Vector3, v: number) => {
            wp.push(p.x, p.y, p.z)
            wuv.push(u, v)
          }
          push(lo.position.clone().addScaledVector(lo.normal, -0.01), 0)
          push(lo.position.clone().addScaledVector(lo.normal, depth), 0.1)
          push(hi.position.clone().addScaledVector(hi.normal, depth), 0.9)
          push(hi.position.clone().addScaledVector(hi.normal, -0.01), 1)
        }
        for (let j = 0; j < segments; j++) {
          const a = base + j * 4
          const b = a + 4
          for (let c = 0; c < 3; c++) {
            if (side === 'starboard') wi.push(a + c, b + c, a + c + 1, a + c + 1, b + c, b + c + 1)
            else wi.push(a + c, a + c + 1, b + c, a + c + 1, b + c + 1, b + c)
          }
        }
      }
    }
    wales = makeGeometry(wp, wuv, wi)
    triangles += wi.length / 3
  }

  const gunPorts: GunPortPlacement[] = []
  for (const gp of opts.gunPorts ?? []) {
    const sides: ('port' | 'starboard')[] = gp.side === 'both' ? ['starboard', 'port'] : [gp.side]
    for (const side of sides) {
      const { position, normal } = surfaceAt(gp.x, gp.y, side)
      gunPorts.push({
        side,
        position: [position.x, position.y, position.z],
        normal: [normal.x, normal.y, normal.z],
        rotationY: Math.atan2(normal.x, normal.z),
        width: gp.width ?? 0.26,
        height: gp.height ?? 0.22,
      })
    }
  }

  for (const g of [deck, keel, wales]) if (g?.boundingBox) bounds.union(g.boundingBox)

  return { sides, deck, keel, wales, gunPorts, bounds, triangles, surfaceAt, railAt, keelAt }
}

/**
 * Lofts a closed hull from cross-sections and returns a single geometry (sides, bow/stern, deck cap, keel).
 * Pass a number for the vertical ring count (legacy) or a `LoftOptions` object. Use `loftHullParts` when the
 * hull, deck, keel and wales need different materials.
 */
export function loftHull(sections: HullSection[], ringsOrOptions: number | LoftOptions = {}): THREE.BufferGeometry {
  const opts = typeof ringsOrOptions === 'number' ? { rings: ringsOrOptions } : ringsOrOptions
  const parts = loftHullParts(sections, opts)
  const list = [parts.sides, parts.deck, parts.keel, parts.wales].filter((g): g is THREE.BufferGeometry => !!g)
  return mergeGeometries(list)
}

/** Concatenates indexed geometries that share position/uv/normal attributes. */
export function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  let offset = 0
  for (const g of list) {
    const p = g.attributes.position as THREE.BufferAttribute
    const n = g.attributes.normal as THREE.BufferAttribute
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i))
      normals.push(n.getX(i), n.getY(i), n.getZ(i))
      uvs.push(uv.getX(i), uv.getY(i))
    }
    const ix = g.index!
    for (let i = 0; i < ix.count; i++) indices.push(ix.getX(i) + offset)
    offset += p.count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  out.setIndex(indices)
  out.computeBoundingBox()
  out.computeBoundingSphere()
  return out
}

/**
 * Convenience: a symmetric hull for a ship of `length` cells with a fine entry, full midships and a
 * narrower, slightly raked transom stern. Returns sections stern(-x) → bow(+x).
 */
export function basicHullSections(length: number, beam: number, draft: number, freeboard: number): HullSection[] {
  const half = length / 2
  const n = 9
  const out: HullSection[] = []
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) // 0 stern .. 1 bow
    const x = -half + t * length
    let taper: number
    if (t < 0.45) taper = 0.62 + 0.38 * Math.sin((t / 0.45) * Math.PI * 0.5)
    else taper = Math.cos(((t - 0.45) / 0.55) * Math.PI * 0.5) * 0.97 + 0.03
    const w = (beam / 2) * taper
    const fullness = t < 0.45 ? 0.95 : 0.6 + 0.35 * taper
    out.push({
      x,
      keelY: -draft * (0.55 + 0.45 * Math.sin(Math.min(1, taper) * Math.PI * 0.5)),
      railY: freeboard,
      halfWidths: [0.02, w * 0.35 * fullness, w * 0.78 * fullness, w * 0.97, w, w * 0.99, w * 0.95],
    })
  }
  return out
}
