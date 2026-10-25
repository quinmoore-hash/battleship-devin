import { seededRandom } from '../vfx/random'
import type { Vec3 } from './layout'

/**
 * Layout of the Caribbean cove. Everything that needs to agree on where land is — the water
 * shader's depth tint, the island terrain meshes, prop scatter, landmark placement — reads
 * the same `terrainHeight(x, z)` field defined here, so the shoreline, the turquoise shallows
 * and the beaches always line up. All randomness is seeded.
 *
 * World: the two boards sit at x in [-5, 5], z in [-13, 11] (see `layout.ts`). Islands flank
 * them east and west; the cove opens to the sea toward -z (where the sun sets); a distant
 * island closes the horizon behind the camera (+z).
 */
export interface Island {
  id: string
  /** Centre of the elliptical footprint. */
  cx: number
  cz: number
  /** Footprint radii at the waterline. */
  rx: number
  rz: number
  /** Height of the summit above the water. */
  peak: number
  /** Coastline irregularity, 0 = perfect ellipse. */
  rough: number
  seed: number
}

export const ISLANDS: readonly Island[] = [
  { id: 'west', cx: -52, cz: -14, rx: 25, rz: 36, peak: 9.5, rough: 0.22, seed: 11 },
  { id: 'west-point', cx: -36, cz: -44, rx: 8, rz: 7, peak: 3.2, rough: 0.2, seed: 12 },
  { id: 'east', cx: 53, cz: -1, rx: 23, rz: 31, peak: 7.5, rough: 0.22, seed: 21 },
  { id: 'east-headland', cx: 33, cz: -30, rx: 8.5, rz: 7.5, peak: 4.6, rough: 0.12, seed: 22 },
  { id: 'reef', cx: -22, cz: -37, rx: 5, rz: 3.5, peak: -0.35, rough: 0.3, seed: 31 },
  { id: 'south', cx: 18, cz: 96, rx: 34, rz: 20, peak: 9, rough: 0.25, seed: 41 },
]

/** Seabed level of the open cove (metres below the surface, negative). */
export const COVE_FLOOR = -14
/** Water depth below which the water reads as turquoise shallows. */
export const SHALLOW_DEPTH = 5.5

// ---- deterministic value noise -----------------------------------------------------------
function hash2(x: number, y: number): number {
  let h = Math.imul((x | 0) * 374761393 + (y | 0) * 668265263, 1274126177)
  h = (h ^ (h >>> 13)) >>> 0
  return (h % 65536) / 65536
}
const fade = (t: number) => t * t * (3 - 2 * t)
/** Smooth 2D value noise in [0, 1]. */
export function noise2(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = fade(x - ix)
  const fy = fade(y - iy)
  const a = hash2(ix, iy)
  const b = hash2(ix + 1, iy)
  const c = hash2(ix, iy + 1)
  const d = hash2(ix + 1, iy + 1)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}
export function fbm2(x: number, y: number, octaves = 3): number {
  let v = 0
  let amp = 0.5
  let sum = 0
  for (let i = 0; i < octaves; i++) {
    v += amp * noise2(x, y)
    sum += amp
    x = x * 2.03 + 17.1
    y = y * 1.97 + 9.3
    amp *= 0.5
  }
  return v / sum
}

const smoothMax = (a: number, b: number, k: number) => {
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (b - a)) / k))
  return a + (b - a) * h + k * h * (1 - h)
}

/** Height of one island at (x, z): positive above water, falling to a shelf below. */
export function islandHeight(isl: Island, x: number, z: number): number {
  const dx = (x - isl.cx) / isl.rx
  const dz = (z - isl.cz) / isl.rz
  const base = Math.hypot(dx, dz)
  const angle = Math.atan2(dz, dx)
  // wobble the coastline with low-frequency noise around the rim
  const wob = (fbm2(Math.cos(angle) * 2.3 + isl.seed * 7.1, Math.sin(angle) * 2.3 + isl.seed * 3.7, 2) - 0.5) * 2
  const d = base * (1 + isl.rough * wob)
  if (d >= 1) {
    // seabed shelf sloping down from the beach
    return -(d - 1) * Math.max(isl.peak, 2.5) * 2.2
  }
  const dome = Math.pow(1 - d * d, 1.35)
  // ridges & hummocks on the land, fading out on the beach
  const detail = (fbm2(x * 0.09 + isl.seed, z * 0.09 - isl.seed, 3) - 0.5) * 2
  return isl.peak * dome + detail * Math.min(2.2, isl.peak * 0.3) * Math.min(1, dome * 3)
}

/** The cove's terrain field: land above 0, seabed below. Smooth union of islands over the cove floor. */
export function terrainHeight(x: number, z: number): number {
  let h = COVE_FLOOR + (fbm2(x * 0.03 + 3.3, z * 0.03 - 5.1, 2) - 0.5) * 7
  for (const isl of ISLANDS) {
    h = smoothMax(h, islandHeight(isl, x, z), 1.5)
  }
  return h
}

export const isLand = (x: number, z: number) => terrainHeight(x, z) > 0
/** Water depth in metres (0 on land). */
export const waterDepth = (x: number, z: number) => Math.max(0, -terrainHeight(x, z))

/** Surface normal of the terrain (unit). */
export function terrainNormal(x: number, z: number, eps = 0.5): Vec3 {
  const hx = terrainHeight(x + eps, z) - terrainHeight(x - eps, z)
  const hz = terrainHeight(x, z + eps) - terrainHeight(x, z - eps)
  const n: Vec3 = [-hx / (2 * eps), 1, -hz / (2 * eps)]
  const l = Math.hypot(...n)
  return [n[0] / l, n[1] / l, n[2] / l]
}

/** Nothing solid may be placed where the boards float (plus a margin for ships and the camera). */
export const BOARD_ZONE = { minX: -11, maxX: 11, minZ: -19, maxZ: 17 }
export const inBoardZone = (x: number, z: number) =>
  x > BOARD_ZONE.minX && x < BOARD_ZONE.maxX && z > BOARD_ZONE.minZ && z < BOARD_ZONE.maxZ

/** Fixed landmark positions (x, z); y is read from the terrain at mount time. */
export const LANDMARKS = {
  fort: { x: 33, z: -30, rotationY: -0.35 },
  lighthouse: { x: -36, z: -44 },
  dock: { x: 30.5, z: 7, rotationY: Math.PI / 2 },
  tavern: { x: 37, z: 7.5, rotationY: Math.PI / 2 },
  wreck: { x: -22.5, z: -37, rotationY: 0.7 },
} as const

export interface ScatterOptions {
  seed: number
  count: number
  /** Only these islands (by id); default all. */
  islands?: readonly string[]
  minHeight: number
  maxHeight: number
  /** Max slope as |dh| per metre. */
  maxSlope?: number
  /** Keep this far from every landmark. */
  landmarkClearance?: number
  /** Minimum spacing between accepted points. */
  spacing?: number
}

export interface ScatterPoint {
  position: Vec3
  rotation: number
  scale: number
  /** Which island the point landed on. */
  island: string
}

/**
 * Deterministically scatters props on the islands. Candidates are drawn uniformly in each
 * island's footprint and kept when the terrain height / slope match and they are clear of
 * the boards, the landmarks and each other.
 */
export function scatterOnLand(opts: ScatterOptions): ScatterPoint[] {
  const rnd = seededRandom(opts.seed)
  const islands = ISLANDS.filter((i) => i.peak > 0 && (!opts.islands || opts.islands.includes(i.id)))
  const out: ScatterPoint[] = []
  const clearance = opts.landmarkClearance ?? 6
  const spacing = opts.spacing ?? 1.5
  const marks = Object.values(LANDMARKS)
  let tries = 0
  while (out.length < opts.count && tries < opts.count * 60) {
    tries++
    const isl = islands[Math.floor(rnd() * islands.length)]
    const x = isl.cx + (rnd() * 2 - 1) * isl.rx * 1.05
    const z = isl.cz + (rnd() * 2 - 1) * isl.rz * 1.05
    const rot = rnd() * Math.PI * 2
    const scale = 0.75 + rnd() * 0.5
    if (inBoardZone(x, z)) continue
    const h = terrainHeight(x, z)
    if (h < opts.minHeight || h > opts.maxHeight) continue
    if (opts.maxSlope !== undefined) {
      const n = terrainNormal(x, z)
      const slope = Math.hypot(n[0], n[2]) / n[1]
      if (slope > opts.maxSlope) continue
    }
    if (marks.some((m) => Math.hypot(m.x - x, m.z - z) < clearance)) continue
    if (out.some((p) => Math.hypot(p.position[0] - x, p.position[2] - z) < spacing)) continue
    out.push({ position: [x, h, z], rotation: rot, scale, island: isl.id })
  }
  return out
}

/** Extent (half-size) of the depth lookup texture in world units; it is centred on the origin. */
export const DEPTH_MAP_EXTENT = 170

/**
 * Samples `terrainHeight` into a square grid for the water shader. Values are the terrain
 * height (metres, signed) so the shader can derive depth, shore distance and beach foam.
 */
export function buildHeightMap(size: number, extent = DEPTH_MAP_EXTENT): Float32Array {
  const data = new Float32Array(size * size)
  for (let j = 0; j < size; j++) {
    const z = -extent + ((j + 0.5) / size) * extent * 2
    for (let i = 0; i < size; i++) {
      const x = -extent + ((i + 0.5) / size) * extent * 2
      data[j * size + i] = terrainHeight(x, z)
    }
  }
  return data
}
