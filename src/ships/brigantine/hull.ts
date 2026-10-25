/**
 * Brigantine hull: pure geometry. Everything here is deterministic and free of React/DOM so it can be
 * unit-tested; `index.tsx` turns these builders into meshes.
 *
 * Frame: bow = +x, stern = -x, y = 0 waterline, one unit per grid cell (length 3 → x ∈ [-1.5, 1.5]).
 *
 * The hull is defined by a smooth half-width field `hullHalfWidth(x, y)` (Hermite-interpolated through
 * hand-authored cross-sections) and a sheer line `sheerY(x)`. `buildHullGeometry` lofts that field into a
 * closed outer skin, an inner bulwark skin above the deck (so the bulwark has thickness) and *real* gun-port
 * openings with reveals, which the shared kit `loftHull` cannot do (see PR notes).
 */
import * as THREE from 'three'

export const LENGTH = 3
export const HALF = LENGTH / 2
export const BEAM = 0.85
export const DECK_Y = 0.35
export const DRAFT = 0.32
export const BULWARK_THICKNESS = 0.035
export const STEM_X = 1.46
export const TRANSOM_X = -1.42
/** Gun ports: all at the same height band above the deck, one per cannon. */
export const PORT_BOTTOM = DECK_Y + 0.04
export const PORT_TOP = DECK_Y + 0.15
export const PORT_WIDTH = 0.12
/** Cannon stations along x (bow → stern). Two per cell. */
export const CANNON_X = [1.0, 0.62, 0.22, -0.2, -0.6, -0.98] as const
export const FOREMAST_X = 0.75
export const MAINMAST_X = -0.4
export const FOREMAST_HEIGHT = 1.65
export const MAINMAST_HEIGHT = 1.9
/** Raised quarterdeck / aft cabin top. */
export const CABIN_FRONT_X = -1.08
export const CABIN_TOP_Y = DECK_Y + 0.15

export interface Section {
  x: number
  keelY: number
  /** Half-widths at 7 evenly spaced heights from keelY (t=0) to DECK_Y (t=1). */
  hw: number[]
}

/** Hand-authored cross-sections, stern → bow. Half-beam 0.425 just aft of midships, fine entry, flat run aft. */
export const SECTIONS: Section[] = [
  { x: TRANSOM_X, keelY: -0.09, hw: [0.0, 0.06, 0.14, 0.21, 0.26, 0.29, 0.3] },
  { x: -1.3, keelY: -0.16, hw: [0.0, 0.09, 0.19, 0.27, 0.32, 0.345, 0.355] },
  { x: -1.05, keelY: -0.25, hw: [0.0, 0.13, 0.25, 0.33, 0.375, 0.395, 0.405] },
  { x: -0.7, keelY: -0.31, hw: [0.0, 0.17, 0.3, 0.37, 0.405, 0.42, 0.425] },
  { x: -0.25, keelY: -0.32, hw: [0.0, 0.18, 0.31, 0.38, 0.41, 0.422, 0.425] },
  { x: 0.2, keelY: -0.315, hw: [0.0, 0.17, 0.3, 0.37, 0.4, 0.415, 0.42] },
  { x: 0.6, keelY: -0.3, hw: [0.0, 0.14, 0.26, 0.33, 0.37, 0.39, 0.4] },
  { x: 0.95, keelY: -0.27, hw: [0.0, 0.1, 0.2, 0.27, 0.31, 0.335, 0.35] },
  { x: 1.2, keelY: -0.2, hw: [0.0, 0.06, 0.13, 0.19, 0.23, 0.26, 0.28] },
  { x: 1.36, keelY: -0.06, hw: [0.0, 0.03, 0.07, 0.11, 0.145, 0.175, 0.2] },
  { x: STEM_X, keelY: 0.14, hw: [0.0, 0.0, 0.005, 0.01, 0.02, 0.035, 0.05] },
]

/** Cubic Hermite through non-uniform knots (finite-difference tangents). `xs` ascending. */
export function hermite(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length
  if (x <= xs[0]) return ys[0]
  if (x >= xs[n - 1]) return ys[n - 1]
  let i = 0
  while (i < n - 2 && x > xs[i + 1]) i++
  const h = xs[i + 1] - xs[i]
  const t = (x - xs[i]) / h
  const slope = (a: number) => {
    if (a === 0) return (ys[1] - ys[0]) / (xs[1] - xs[0])
    if (a === n - 1) return (ys[n - 1] - ys[n - 2]) / (xs[n - 1] - xs[n - 2])
    return (ys[a + 1] - ys[a - 1]) / (xs[a + 1] - xs[a - 1])
  }
  const m0 = slope(i) * h
  const m1 = slope(i + 1) * h
  const t2 = t * t
  const t3 = t2 * t
  return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * m1
}

const SECTION_X = SECTIONS.map((s) => s.x)
const KEEL_Y = SECTIONS.map((s) => s.keelY)
const LEVELS = SECTIONS[0].hw.length
const LEVEL_T = Array.from({ length: LEVELS }, (_, i) => i / (LEVELS - 1))
const HW_BY_LEVEL = LEVEL_T.map((_, li) => SECTIONS.map((s) => s.hw[li]))

/** Keel (bottom of hull) height at x. Rises toward the raked stem and the stern post. */
export function keelY(x: number): number {
  return hermite(SECTION_X, KEEL_Y, x)
}

/** Rail height at x: gentle sheer, higher at bow than stern. */
export function sheerY(x: number): number {
  const u = x / HALF
  return 0.52 + 0.045 * u * u + (u > 0 ? 0.035 * u * u * u : 0.0)
}

/**
 * Half-width of the hull at (x, y). Below the deck it follows the sections; above it the bulwark has a
 * slight tumblehome. 0 outside the hull's x range.
 */
export function hullHalfWidth(x: number, y: number): number {
  if (x < TRANSOM_X - 1e-6 || x > STEM_X + 1e-6) return 0
  const k = keelY(x)
  if (y < k) return 0
  const yDeck = Math.min(y, DECK_Y)
  const t = Math.min(1, Math.max(0, (yDeck - k) / (DECK_Y - k)))
  const levelHw = HW_BY_LEVEL.map((row) => hermite(SECTION_X, row, x))
  let w = hermite(LEVEL_T, levelHw, t)
  if (y > DECK_Y) w -= (y - DECK_Y) * 0.22
  return Math.max(0, w)
}

export interface HullBuild {
  geometry: THREE.BufferGeometry
  /** Approximate triangle count, for the PR report. */
  triangles: number
}

interface Column {
  x: number
  /** Index into the port list when this column is a port edge (both edges share the id). */
  port: number
}

function uniq(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.filter((v, i) => i === 0 || Math.abs(v - sorted[i - 1]) > 1e-5)
}

/** x positions sampled along the hull: a smooth distribution plus the exact gun-port edges. */
export function hullColumns(steps = 44): Column[] {
  const xs: number[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    // denser near the ends where curvature is high
    const e = 0.5 - 0.5 * Math.cos(t * Math.PI)
    xs.push(TRANSOM_X + (STEM_X - TRANSOM_X) * e)
  }
  const edges: number[] = []
  CANNON_X.forEach((cx) => edges.push(cx - PORT_WIDTH / 2, cx + PORT_WIDTH / 2))
  const all = uniq([...xs.filter((x) => !edges.some((e) => Math.abs(e - x) < 0.015)), ...edges])
  return all.map((x) => {
    const p = CANNON_X.findIndex((cx) => Math.abs(Math.abs(x - cx) - PORT_WIDTH / 2) < 1e-6)
    return { x, port: p }
  })
}

/** Whether the band between columns ca/cb at height band [y0,y1] is inside a gun-port opening. */
function inPort(xa: number, xb: number, y0: number, y1: number): boolean {
  if (y0 < PORT_BOTTOM - 1e-6 || y1 > PORT_TOP + 1e-6) return false
  const mid = (xa + xb) / 2
  return CANNON_X.some((cx) => Math.abs(mid - cx) < PORT_WIDTH / 2 - 1e-6)
}

/**
 * Lofts the full hull: outer skin keel→sheer, inner bulwark skin deck→sheer, cap rail strip, port reveals,
 * transom cap and stem. UVs are in metres (u along x, v up the girth) so a plank texture repeats evenly.
 */
export function buildHullGeometry(opts: { belowRings?: number; columns?: number; ports?: boolean } = {}): HullBuild {
  const belowRings = opts.belowRings ?? 9
  const cols = hullColumns(opts.columns ?? 44)
  const withPorts = opts.ports ?? true
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []

  const push = (p: THREE.Vector3, n: THREE.Vector3, u: number, v: number) => {
    pos.push(p.x, p.y, p.z)
    nor.push(n.x, n.y, n.z)
    uv.push(u, v)
    return pos.length / 3 - 1
  }

  // y levels per column: below-deck rings (keel→deck), then exact bulwark levels.
  const levelsAt = (x: number): number[] => {
    const k = keelY(x)
    const ys: number[] = []
    for (let i = 0; i < belowRings; i++) {
      const t = i / belowRings
      // squash toward the keel so the turn of the bilge is well resolved
      const s = Math.pow(t, 0.8)
      ys.push(k + (DECK_Y - k) * s)
    }
    ys.push(DECK_Y, PORT_BOTTOM, PORT_TOP, sheerY(x))
    return ys
  }
  const nLevels = belowRings + 4
  const deckLevel = belowRings
  const sheerLevel = nLevels - 1

  // surface normal by finite differences of the half-width field
  const tmpN = new THREE.Vector3()
  const normalAt = (x: number, y: number, side: 1 | -1, inner: boolean): THREE.Vector3 => {
    const d = 0.01
    const w = hullHalfWidth(x, y)
    const dwdx = (hullHalfWidth(Math.min(STEM_X, x + d), y) - hullHalfWidth(Math.max(TRANSOM_X, x - d), y)) / (2 * d)
    const yUp = Math.min(y + d, sheerY(x))
    const yDn = Math.max(y - d, keelY(x) + 1e-4)
    const dwdy = yUp > yDn ? (hullHalfWidth(x, yUp) - hullHalfWidth(x, yDn)) / (yUp - yDn) : 0
    // surface z = side * w(x,y): normal ∝ (-side*dwdx, -side*dwdy, 1) * side
    tmpN.set(-dwdx, -dwdy, side).normalize()
    if (w < 0.03) tmpN.lerp(new THREE.Vector3(1, 0, 0), 0.5).normalize()
    if (inner) tmpN.multiplyScalar(-1)
    return tmpN
  }

  const p = new THREE.Vector3()
  // ---- outer skin ----
  const outer: number[][][] = [[], []] // [sideIdx][col][level]
  const sides: (1 | -1)[] = [1, -1]
  sides.forEach((side, si) => {
    cols.forEach((c) => {
      const ys = levelsAt(c.x)
      const ring: number[] = []
      let v = 0
      ys.forEach((y, li) => {
        const w = hullHalfWidth(c.x, y)
        p.set(c.x, y, side * w)
        if (li > 0) v += Math.hypot(y - ys[li - 1], w - hullHalfWidth(c.x, ys[li - 1]))
        ring.push(push(p, normalAt(c.x, y, side, false), c.x, v))
      })
      outer[si].push(ring)
    })
  })
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (flip) idx.push(a, c, b, b, c, d)
    else idx.push(a, b, c, b, d, c)
  }
  sides.forEach((side, si) => {
    for (let ci = 0; ci < cols.length - 1; ci++) {
      const xa = cols[ci].x
      const xb = cols[ci + 1].x
      const ya = levelsAt(xa)
      const yb = levelsAt(xb)
      for (let li = 0; li < nLevels - 1; li++) {
        if (withPorts && inPort(xa, xb, Math.min(ya[li], yb[li]), Math.max(ya[li + 1], yb[li + 1]))) continue
        // a=(ci,li) b=(ci+1,li) c=(ci,li+1) d=(ci+1,li+1); winding so normals face +z on starboard
        quad(outer[si][ci][li], outer[si][ci + 1][li], outer[si][ci][li + 1], outer[si][ci + 1][li + 1], side === -1)
      }
    }
  })

  const groupStarts: number[] = [0]
  // ---- inner bulwark skin (deck → sheer), only where the bulwark exists ----
  groupStarts.push(idx.length)
  const inner: number[][][] = [[], []]
  const innerLevels = [deckLevel, deckLevel + 1, deckLevel + 2, sheerLevel]
  sides.forEach((side, si) => {
    cols.forEach((c) => {
      const ys = levelsAt(c.x)
      const ring: number[] = []
      innerLevels.forEach((li) => {
        const y = ys[li]
        const w = Math.max(0, hullHalfWidth(c.x, y) - BULWARK_THICKNESS)
        p.set(c.x, y, side * w)
        ring.push(push(p, normalAt(c.x, y, side, true), c.x, y - DECK_Y))
      })
      inner[si].push(ring)
    })
  })
  sides.forEach((side, si) => {
    for (let ci = 0; ci < cols.length - 1; ci++) {
      const xa = cols[ci].x
      const xb = cols[ci + 1].x
      const ya = levelsAt(xa)
      const yb = levelsAt(xb)
      for (let k = 0; k < innerLevels.length - 1; k++) {
        const li = innerLevels[k]
        if (withPorts && inPort(xa, xb, Math.min(ya[li], yb[li]), Math.max(ya[li + 1], yb[li + 1]))) continue
        quad(inner[si][ci][k], inner[si][ci + 1][k], inner[si][ci][k + 1], inner[si][ci + 1][k + 1], side === 1)
      }
    }
  })

  // ---- gun-port reveals: 4 quads per port linking outer and inner skins ----
  if (withPorts) {
    sides.forEach((side, si) => {
      CANNON_X.forEach((cx) => {
        const left = cols.findIndex((c) => Math.abs(c.x - (cx - PORT_WIDTH / 2)) < 1e-6)
        const right = cols.findIndex((c) => Math.abs(c.x - (cx + PORT_WIDTH / 2)) < 1e-6)
        if (left < 0 || right < 0) return
        const lb = deckLevel + 1
        const lt = deckLevel + 2
        const oLB = outer[si][left][lb]
        const oLT = outer[si][left][lt]
        const oRB = outer[si][right][lb]
        const oRT = outer[si][right][lt]
        const iLB = inner[si][left][1]
        const iLT = inner[si][left][2]
        const iRB = inner[si][right][1]
        const iRT = inner[si][right][2]
        // sill (bottom), lintel (top), two jambs
        quad(oLB, oRB, iLB, iRB, side === -1)
        quad(oLT, oRT, iLT, iRT, side === 1)
        quad(oLB, oLT, iLB, iLT, side === 1)
        quad(oRB, oRT, iRB, iRT, side === -1)
      })
    })
  }

  // ---- cap rail strip joining outer and inner skins at the sheer ----
  groupStarts.push(idx.length)
  const up = new THREE.Vector3(0, 1, 0)
  sides.forEach((side) => {
    const ringO: number[] = []
    const ringI: number[] = []
    cols.forEach((c) => {
      const y = sheerY(c.x)
      const w = hullHalfWidth(c.x, y)
      ringO.push(push(p.set(c.x, y, side * w), up, c.x, 0))
      ringI.push(push(p.set(c.x, y, side * Math.max(0, w - BULWARK_THICKNESS)), up, c.x, BULWARK_THICKNESS))
    })
    for (let ci = 0; ci < cols.length - 1; ci++) quad(ringO[ci], ringO[ci + 1], ringI[ci], ringI[ci + 1], side === -1)
  })

  // ---- transom cap (flat stern) ----
  groupStarts.push(idx.length)
  const transomStart = idx.length
  {
    const c0 = 0
    const ys = levelsAt(cols[c0].x)
    const n = new THREE.Vector3(-1, 0, 0)
    const centre = push(p.set(cols[c0].x, (ys[0] + ys[sheerLevel]) / 2, 0), n, 0, 0)
    const ringS: number[] = []
    const ringP: number[] = []
    ys.forEach((y) => {
      const w = hullHalfWidth(cols[c0].x, y)
      ringS.push(push(p.set(cols[c0].x, y, w), n, w, y))
      ringP.push(push(p.set(cols[c0].x, y, -w), n, -w, y))
    })
    for (let li = 0; li < nLevels - 1; li++) {
      idx.push(centre, ringS[li], ringS[li + 1])
      idx.push(centre, ringP[li + 1], ringP[li])
    }
    idx.push(centre, ringP[0], ringS[0])
    idx.push(centre, ringS[sheerLevel], ringP[sheerLevel])
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  // material groups: 0 = outer planking (+ transom), 1 = painted inner bulwark + port reveals, 2 = cap rail
  g.addGroup(groupStarts[0], groupStarts[1] - groupStarts[0], 0)
  g.addGroup(groupStarts[1], groupStarts[2] - groupStarts[1], 1)
  g.addGroup(groupStarts[2], groupStarts[3] - groupStarts[2], 2)
  g.addGroup(transomStart, idx.length - transomStart, 0)
  g.computeBoundingSphere()
  return { geometry: g, triangles: idx.length / 3 }
}

/**
 * Deck planking surface: the deck outline at DECK_Y inset by the bulwark thickness, with a slight camber.
 * Covers x ∈ [x0, x1]; `y` is the top surface height.
 */
export const DECK_CAMBER = 0.012
export const CABIN_CAMBER = 0.008

/** Height of the cambered deck surface at (x, z): `y` at the edges, `y + camber` on the centre line. */
export function deckSurfaceY(x: number, z: number, y = DECK_Y, camber = DECK_CAMBER): number {
  const w = Math.max(0.002, hullHalfWidth(x, DECK_Y) - BULWARK_THICKNESS + 0.005)
  return y + camber * Math.max(0, 1 - (z / w) ** 2)
}

export function buildDeckGeometry(x0: number, x1: number, y = DECK_Y, camber = DECK_CAMBER, steps = 40): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const across = 8
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps
    const w = Math.max(0.002, hullHalfWidth(x, DECK_Y) - BULWARK_THICKNESS + 0.005)
    for (let j = 0; j <= across; j++) {
      const s = j / across
      const z = -w + 2 * w * s
      pos.push(x, deckSurfaceY(x, z, y, camber), z)
      uv.push(x, z)
    }
  }
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * (across + 1) + j
      const b = a + across + 1
      idx.push(a, a + 1, b, a + 1, b + 1, b)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** Keel as one extruded band in the xy plane following the hull bottom, `thickness` across z. */
export function buildKeelGeometry(thickness = 0.05, depth = 0.045): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  const n = 30
  const pts: [number, number][] = []
  for (let i = 0; i <= n; i++) {
    const x = TRANSOM_X + ((STEM_X - 0.1 - TRANSOM_X) * i) / n
    pts.push([x, keelY(x)])
  }
  shape.moveTo(pts[0][0], pts[0][1] - depth)
  pts.forEach(([x, y]) => shape.lineTo(x, y - depth))
  for (let i = n; i >= 0; i--) shape.lineTo(pts[i][0], pts[i][1] + 0.03)
  shape.closePath()
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
  g.translate(0, 0, -thickness / 2)
  g.computeVertexNormals()
  return g
}

/** Points of a wale (raised strake) running along the hull side at height `y`, offset outward by `out`. */
export function walePath(y: number, side: 1 | -1, out = 0.012, from = TRANSOM_X + 0.01, to = STEM_X - 0.04, steps = 36): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= steps; i++) {
    const x = from + ((to - from) * i) / steps
    const yy = y + (sheerY(x) - sheerY(0)) * 0.8 // wales follow the sheer
    pts.push(new THREE.Vector3(x, yy, side * (hullHalfWidth(x, yy) + out)))
  }
  return pts
}

/** Wale as a flattened tube (rectangular section) along `walePath`. */
export function buildWaleGeometry(y: number, side: 1 | -1, height = 0.035, out = 0.012): THREE.BufferGeometry {
  const path = walePath(y, side, out)
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), 48, height / 2, 6, false)
  return g
}

/** Centre-line of the cap rail on one side. */
export function railPath(side: 1 | -1, steps = 40): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= steps; i++) {
    const x = TRANSOM_X + ((STEM_X - 0.02 - TRANSOM_X) * i) / steps
    const y = sheerY(x)
    pts.push(new THREE.Vector3(x, y + 0.012, side * (hullHalfWidth(x, y) - BULWARK_THICKNESS / 2)))
  }
  return pts
}
