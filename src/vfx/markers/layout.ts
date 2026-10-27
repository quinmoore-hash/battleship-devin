import type { ShotResult } from '../../engine'
import { coordKey } from '../../engine'
import { cellToWorld, type Vec3 } from '../../scene/layout'
import { hashString, seededRandom } from '../random'

export type MarkerKind = 'miss' | 'hit' | 'sunk'

export interface MarkerPlacement {
  key: string
  kind: MarkerKind
  /** Cell centre on the water surface (board origin y). */
  position: Vec3
  /** Deterministic per-cell seed for shard scatter / bob phase. */
  seed: number
  /** Index in the shot order, 0 = oldest. */
  index: number
  /** True for the most recent shot: it gets the pop + ripple intro. */
  newest: boolean
}

/**
 * One marker per shot. When a ship sinks every earlier `hit` on it is upgraded to `sunk`
 * (the engine only flags the final shot), so wreck markers turn into debris as a group.
 */
export function layoutMarkers(shots: readonly ShotResult[], boardOrigin: Vec3, cellSize = 1): MarkerPlacement[] {
  const sunkShips = new Set<string>()
  for (const s of shots) if (s.outcome === 'sunk' && s.shipId) sunkShips.add(s.shipUid ?? s.shipId)
  const seen = new Set<string>()
  const out: MarkerPlacement[] = []
  shots.forEach((s, index) => {
    const key = coordKey(s.coord)
    if (seen.has(key)) return
    seen.add(key)
    const kind: MarkerKind = s.outcome === 'miss' ? 'miss' : s.shipId && sunkShips.has(s.shipUid ?? s.shipId) ? 'sunk' : 'hit'
    out.push({
      key,
      kind,
      position: cellToWorld(s.coord, boardOrigin, cellSize),
      seed: hashString(key),
      index,
      newest: index === shots.length - 1,
    })
  })
  return out
}

/** Scatter of floating wreck pieces inside one cell, deterministic by seed. */
export interface WreckPiece {
  x: number
  z: number
  rotY: number
  /** Plank length / width / thickness. */
  size: [number, number, number]
  /** 0 = fresh wood … 1 = charred black. */
  char: number
  /** Bob phase offset. */
  phase: number
}

export function wreckScatter(seed: number, count: number, cellSize = 1, charred = 0.5): WreckPiece[] {
  const rnd = seededRandom(seed)
  const r = cellSize * 0.32
  return Array.from({ length: count }, () => {
    const a = rnd() * Math.PI * 2
    const d = Math.sqrt(rnd()) * r
    return {
      x: Math.cos(a) * d,
      z: Math.sin(a) * d,
      rotY: rnd() * Math.PI,
      size: [cellSize * (0.18 + rnd() * 0.3), cellSize * (0.04 + rnd() * 0.05), cellSize * (0.015 + rnd() * 0.015)],
      char: Math.min(1, Math.max(0, charred + (rnd() - 0.5) * 0.7)),
      phase: rnd() * Math.PI * 2,
    }
  })
}

/** Scale multiplier for the newest marker `age` seconds after it appeared: overshoot pop, settling to 1. */
export function popScale(age: number, duration = 0.55): number {
  if (age <= 0) return 0
  if (age >= duration) return 1
  const t = age / duration
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/** Expanding ripple ring: `[radius, opacity]`; opacity 0 once finished. */
export function rippleAt(age: number, maxRadius: number, duration = 1.4): [number, number] {
  if (age <= 0 || age >= duration) return [0, 0]
  const t = age / duration
  const ease = 1 - Math.pow(1 - t, 2)
  return [maxRadius * (0.15 + 0.85 * ease), (1 - t) * (1 - t)]
}

/* ---------- grid buoys ---------- */

export interface GridBuoyLayout {
  /** Four large corner buoys. */
  corners: Vec3[]
  /** Small cork floats at every interior line intersection and along the edges. */
  floats: Vec3[]
  /** Rope polylines (each a list of points incl. sag) for the outer perimeter and inner lines. */
  ropes: { points: Vec3[]; outer: boolean }[]
}

/**
 * A themed grid: a rope perimeter strung between four buoys with cork floats along every
 * grid line. Points are in world space at the given surface height; the renderer bobs them.
 */
export function layoutGridBuoys(origin: Vec3, size = 10, cellSize = 1, sag = 0.06, segments = 4): GridBuoyLayout {
  const [ox, oy, oz] = origin
  const extent = size * cellSize
  const corners: Vec3[] = [
    [ox, oy, oz],
    [ox + extent, oy, oz],
    [ox + extent, oy, oz + extent],
    [ox, oy, oz + extent],
  ]
  const floats: Vec3[] = []
  for (let i = 0; i <= size; i++) {
    for (let j = 0; j <= size; j++) {
      const corner = (i === 0 || i === size) && (j === 0 || j === size)
      if (corner) continue
      floats.push([ox + i * cellSize, oy, oz + j * cellSize])
    }
  }
  const ropes: GridBuoyLayout['ropes'] = []
  const span = (a: Vec3, b: Vec3, outer: boolean) => {
    // one sagging span per cell so the rope dips between floats
    const n = Math.round(Math.hypot(b[0] - a[0], b[2] - a[2]) / cellSize)
    const points: Vec3[] = []
    for (let c = 0; c < n; c++) {
      for (let s = 0; s <= segments; s++) {
        if (c > 0 && s === 0) continue
        const t = (c + s / segments) / n
        const k = s / segments
        const dip = -sag * 4 * k * (1 - k)
        points.push([a[0] + (b[0] - a[0]) * t, a[1] + dip, a[2] + (b[2] - a[2]) * t])
      }
    }
    ropes.push({ points, outer })
  }
  for (let i = 0; i <= size; i++) {
    const outer = i === 0 || i === size
    span([ox + i * cellSize, oy, oz], [ox + i * cellSize, oy, oz + extent], outer)
    span([ox, oy, oz + i * cellSize], [ox + extent, oy, oz + i * cellSize], outer)
  }
  return { corners, floats, ropes }
}
