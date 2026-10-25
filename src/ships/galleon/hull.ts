/**
 * Galleon hull mathematics and geometry builders. Pure (no React); unit-tested.
 *
 * Frame: bow = +x, stern = -x, y = 0 waterline, one unit per grid cell (length 4 → x ∈ [-2, 2]).
 * The hull is defined analytically by `halfWidth(x, y)` so the anchors (`anchors.ts`) and every
 * lofted band (planking, wales, bulwarks, decks) are derived from the same surface and agree exactly.
 */
import * as THREE from 'three'

export const GALLEON = {
  length: 4,
  beam: 1.25,
  /** Transom plane. */
  xStern: -1.85,
  /** Stem head; the beakhead and bowsprit continue forward of this. */
  xBow: 1.72,
  keelY: -0.5,
  /** Height of maximum beam; the sides lean inward (tumblehome) above this. */
  maxBeamY: 0.15,
  mainDeckY: 0.6,
  waistRailY: 0.84,
  /** Forecastle: bulkhead at `forecastleX`, deck at `forecastleDeckY`. */
  forecastleX: 0.95,
  forecastleDeckY: 0.98,
  quarterX: -0.45,
  quarterDeckY: 1.02,
  poopX: -1.15,
  poopDeckY: 1.42,
  /** Castle sides rise this much above their deck before the baluster railing starts. */
  toeRail: 0.05,
  plank: 0.04,
} as const

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
export const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/** 0 at the transom … 1 at the stem head. */
export const stationT = (x: number) => (x - GALLEON.xStern) / (GALLEON.xBow - GALLEON.xStern)

/** Beam fraction along the length: fullest just forward of midships, narrow transom, fine entry. */
export function beamFactor(x: number): number {
  const s = clamp01(stationT(x))
  const sm = 0.58
  if (s <= sm) return 0.56 + 0.44 * Math.sin((s / sm) * Math.PI * 0.5)
  const t = (s - sm) / (1 - sm)
  return 0.04 + 0.96 * Math.cos(t * Math.PI * 0.5) ** 0.85
}

/** Bottom of the hull at `x`: deep midships, forefoot rising to the stem, run rising to the sternpost. */
export function keelLine(x: number): number {
  const s = clamp01(stationT(x))
  const bow = smoothstep(0.72, 1, s) ** 1.4
  const stern = (1 - smoothstep(0, 0.3, s)) ** 1.6
  return GALLEON.keelY + 0.26 * bow + 0.3 * stern
}

/** Top of the hull planking at `x` (waist bulwark, or castle deck + toe rail). */
export function railY(x: number): number {
  const g = GALLEON
  if (x >= g.forecastleX) return g.forecastleDeckY + g.toeRail
  if (x >= g.quarterX) return g.waistRailY
  if (x >= g.poopX) return g.quarterDeckY + g.toeRail
  return g.poopDeckY + g.toeRail
}

/** Height of the exposed (weather) deck at `x`. */
export function deckY(x: number): number {
  const g = GALLEON
  if (x >= g.forecastleX) return g.forecastleDeckY
  if (x >= g.quarterX) return g.mainDeckY
  if (x >= g.poopX) return g.quarterDeckY
  return g.poopDeckY
}

/**
 * Half-breadth of the hull surface at (`x`, `y`). Rounded bilge with flatter floors midships and a V entry/run,
 * maximum beam at `maxBeamY`, then a pronounced tumblehome (sides curve inward) up to the rail.
 */
export function halfWidth(x: number, y: number): number {
  const g = GALLEON
  const hwMax = (g.beam / 2) * beamFactor(x)
  const k = keelLine(x)
  if (y <= g.maxBeamY) {
    const s = clamp01(stationT(x))
    const u = clamp01((y - k) / (g.maxBeamY - k))
    const sharp = 0.55 + 0.9 * (Math.abs(s - 0.55) / 0.55) ** 2
    const bilge = Math.sin(u * Math.PI * 0.5) ** sharp
    const below = 1 - clamp01((y - k) / (0 - k))
    const run = 1 - 0.6 * (1 - smoothstep(0, 0.3, s)) * below
    return Math.max(hwMax * bilge * run, 0.02)
  }
  const t = y - g.maxBeamY
  return hwMax * (1 - 0.2 * smoothstep(0, 1.3, t))
}

/** Longitudinal sample positions, with a doubled station at each castle step so the steps stay vertical. */
export function stations(spacing = 0.06): number[] {
  const g = GALLEON
  const xs: number[] = []
  const n = Math.ceil((g.xBow - g.xStern) / spacing)
  for (let i = 0; i <= n; i++) xs.push(g.xStern + ((g.xBow - g.xStern) * i) / n)
  for (const edge of [g.forecastleX, g.quarterX, g.poopX]) xs.push(edge - 0.0015, edge + 0.0015)
  xs.sort((a, b) => a - b)
  return xs.filter((x, i) => i === 0 || x - xs[i - 1] > 0.001)
}

/** One point of a lofted profile at a station: height plus either an outward offset from the hull or an absolute z. */
export interface ProfilePoint {
  y: number
  /** Added to `halfWidth(x, y)` (positive = outboard). Ignored when `z` is given. */
  off?: number
  /** Absolute half-breadth instead of the hull surface. */
  z?: number
  /** Explicit texture v (defaults to the point's index fraction). */
  v?: number
}

export interface LoftOptions {
  xs?: number[]
  /** Build the profile mirrored on both sides (default) or only one side. */
  sides?: ('port' | 'starboard')[]
  /** Normals point into the hull (for inner bulwark faces). */
  inward?: boolean
  /** Flat-shaded (non-indexed) output, for crisp wale/rail edges. */
  flat?: boolean
  /** Texture scale: u along x, v along the profile. */
  uv?: [number, number]
}

/**
 * Lofts `profile(x)` (a list of ProfilePoints, constant length) along the stations into an open strip per side.
 * Winding puts the normal outboard (+z on starboard) unless `inward`.
 */
export function loftProfile(profile: (x: number) => ProfilePoint[], opts: LoftOptions = {}): THREE.BufferGeometry {
  const xs = opts.xs ?? stations()
  const sides = opts.sides ?? ['starboard', 'port']
  const [su, sv] = opts.uv ?? [1, 1]
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (const side of sides) {
    const sign = side === 'starboard' ? 1 : -1
    const base = positions.length / 3
    let count = 0
    for (let si = 0; si < xs.length; si++) {
      const x = xs[si]
      const pts = profile(x)
      count = pts.length
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k]
        const z = p.z !== undefined ? p.z : halfWidth(x, p.y) + (p.off ?? 0)
        positions.push(x, p.y, sign * z)
        uvs.push(x * su, (p.v ?? k / (pts.length - 1)) * sv)
      }
    }
    for (let si = 0; si < xs.length - 1; si++) {
      for (let k = 0; k < count - 1; k++) {
        const a = base + si * count + k
        const b = a + count
        // outward normal: for starboard (+z) the quad (x→+x, y→+y) viewed from +z is CCW as a,b,a+1
        const flip = (sign > 0) !== !!opts.inward
        if (flip) indices.push(a, b, a + 1, a + 1, b, b + 1)
        else indices.push(a, a + 1, b, a + 1, b + 1, b)
      }
    }
  }
  let g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(indices)
  if (opts.flat) g = g.toNonIndexed()
  g.computeVertexNormals()
  return g
}

/** Evenly spaced heights between two curves, inclusive. */
export const heightSamples = (yLo: number, yHi: number, n: number): number[] => Array.from({ length: n }, (_, i) => yLo + ((yHi - yLo) * i) / (n - 1))

/** Outer planking between two height curves. */
export function hullBand(yLo: (x: number) => number, yHi: (x: number) => number, segments: number, opts: LoftOptions = {}): THREE.BufferGeometry {
  return loftProfile(
    (x) => {
      const lo = yLo(x)
      const hi = yHi(x)
      return heightSamples(lo, hi, segments).map((y) => ({ y, v: (y - lo) / Math.max(1e-6, hi - lo) }))
    },
    opts,
  )
}

/** A wale / moulding: raised band standing `depth` off the planking with top and bottom lips. */
export function wale(yLo: number, yHi: number, depth: number, opts: LoftOptions = {}): THREE.BufferGeometry {
  return loftProfile(
    () => [
      { y: yLo, off: 0.001, v: 0 },
      { y: yLo, off: depth, v: 0.1 },
      { y: yHi, off: depth, v: 0.9 },
      { y: yHi, off: 0.001, v: 1 },
    ],
    { flat: true, ...opts },
  )
}

/** Deck planking between `x0` and `x1` at height `y`, inset from the hull side by `inset`. Normal +y. */
export function deckStrip(x0: number, x1: number, y: number, inset: number, uv: [number, number] = [1, 1], spacing = 0.08): THREE.BufferGeometry {
  const n = Math.max(2, Math.ceil((x1 - x0) / spacing) + 1)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / (n - 1)
    const w = Math.max(0.01, halfWidth(x, y) - inset)
    positions.push(x, y, -w, x, y, w)
    uvs.push(x * uv[0], -w * uv[1], x * uv[0], w * uv[1])
    if (i > 0) {
      const a = (i - 1) * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

/** Vertical plane across the hull at `x` between heights `y0..y1` (bulkheads, transom). Normal toward `facing` (±x). */
export function crossPlane(x: number, y0: number, y1: number, facing: 1 | -1, inset = 0, rows = 8): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 0; i < rows; i++) {
    const y = y0 + ((y1 - y0) * i) / (rows - 1)
    const w = Math.max(0.01, halfWidth(x, y) - inset)
    positions.push(x, y, -w, x, y, w)
    uvs.push(-w, y, w, y)
    if (i > 0) {
      const a = (i - 1) * 2
      if (facing > 0) indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
      else indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

/** Points of the curved stem: forefoot → stem head → beakhead tip. */
export function stemCurve(): THREE.Vector3[] {
  const g = GALLEON
  return [
    new THREE.Vector3(g.xBow - 0.42, keelLine(g.xBow - 0.42) + 0.01, 0),
    new THREE.Vector3(g.xBow - 0.12, -0.28, 0),
    new THREE.Vector3(g.xBow + 0.02, 0.05, 0),
    new THREE.Vector3(g.xBow + 0.08, 0.38, 0),
    new THREE.Vector3(g.xBow + 0.2, 0.62, 0),
    new THREE.Vector3(g.xBow + 0.36, 0.76, 0),
  ]
}

/** Approximate triangle count of a geometry (for LOD budgeting). */
export const triangleCount = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3
