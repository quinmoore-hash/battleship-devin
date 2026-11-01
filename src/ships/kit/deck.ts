import type { DeckAnchors } from '../../deck/contract'
import type { Vec3 } from '../../scene/layout'
import type { ShipAnchors } from '../types'

export type Pt = [number, number]

/** Twice the signed area: > 0 when `pts` run counter-clockwise in the (x, z) plane. */
export function signedArea2(pts: readonly Pt[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i]
    const [x1, z1] = pts[(i + 1) % pts.length]
    a += x0 * z1 - x1 * z0
  }
  return a
}

export const isCCW = (pts: readonly Pt[]): boolean => signedArea2(pts) > 0

/** Every turn is a left turn (or straight): convex when CCW. */
export function isConvex(pts: readonly Pt[]): boolean {
  const n = pts.length
  if (n < 3) return false
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[(i + 1) % n]
    const [cx, cz] = pts[(i + 2) % n]
    if ((bx - ax) * (cz - bz) - (bz - az) * (cx - bx) < -1e-9) return false
  }
  return true
}

/** Point strictly inside or on the edge of a convex CCW polygon (`pad` > 0 shrinks the test region). */
export function insideConvex(pts: readonly Pt[], p: Pt, pad = 0): boolean {
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const [ax, az] = pts[i]
    const [bx, bz] = pts[(i + 1) % n]
    const ex = bx - ax
    const ez = bz - az
    const len = Math.hypot(ex, ez) || 1
    const cross = (ex * (p[1] - az) - ez * (p[0] - ax)) / len
    if (cross < pad - 1e-9) return false
  }
  return true
}

/** Andrew's monotone chain: convex hull of `pts`, CCW, no repeated points. */
export function convexHull(input: readonly Pt[]): Pt[] {
  const pts = [...input].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Pt[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

export interface DeckLevelSpec {
  /** Longitudinal extent of this deck level (ship x, bow = +x). */
  x0: number
  x1: number
  /** Planking height the player stands on. */
  y: number
  /** Half-breadth of the walkable planking at x (already inside the bulwark). */
  halfWidth: (x: number) => number
  /** Extra inset from the planking edge so the camera never clips the bulwark; default 0.08. */
  inset?: number
  steps?: number
}

/**
 * Walkable polygon for one deck level: the planking outline sampled along x on both sides, inset, then
 * convex-hulled so the result is guaranteed convex and CCW whatever the hull curve does.
 */
export function deckPolygon({ x0, x1, y, halfWidth, inset = 0.08, steps = 6 }: DeckLevelSpec): DeckAnchors['walk'][number] {
  const pts: Pt[] = []
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps
    const hw = Math.max(0.02, halfWidth(x) - inset)
    pts.push([x, hw], [x, -hw])
  }
  return { points: convexHull(pts), y }
}

export interface StationSpec {
  /** How far inboard of the muzzle the gunner stands (horizontal, metres); clamped so the stand stays inside the walk polygon. */
  back?: number
}

/**
 * Gunner stations, one per `cannons[i]`: stand inboard of the muzzle on the nearest walkable level, facing the
 * gun's firing direction. `deckYAt(x)` says which level the gun is served from (lower gun decks are served from
 * the weather deck above them, so their stand is further from the muzzle vertically).
 */
export function gunStations(cannons: ShipAnchors['cannons'], walk: DeckAnchors['walk'], deckYAt: (x: number) => number, { back = 0.08 }: StationSpec = {}): DeckAnchors['stations'] {
  return cannons.map((c) => {
    const sign = c.side === 'starboard' ? 1 : -1
    const y = deckYAt(c.muzzle[0])
    const sameY = walk.filter((w) => Math.abs(w.y - y) < 1e-6)
    const level = sameY.find((w) => insideConvex(w.points, [c.muzzle[0], 0])) ?? sameY[0] ?? walk[0]
    // a gun right on a deck break: nudge the stand along x until it is over the polygon
    const cx = level.points.reduce((acc, p) => acc + p[0], 0) / level.points.length
    let x = c.muzzle[0]
    for (let i = 0; i < 20 && !insideConvex(level.points, [x, 0]); i++) x += Math.sign(cx - x) * 0.02
    let z = c.muzzle[2] - sign * back
    // keep the stand inside the polygon, stepping inboard until it fits
    for (let i = 0; i < 20 && !insideConvex(level.points, [x, z]); i++) z -= sign * 0.02
    const stand: Vec3 = [x, level.y, z]
    return { stand, yaw: Math.atan2(c.direction[0], c.direction[2]) }
  })
}

/** Obstacle circles for masts from `ShipAnchors.masts` (radius = mast foot incl. the fife rail / bitts around it). */
export const mastObstacles = (masts: ShipAnchors['masts'], radius: number): DeckAnchors['obstacles'] => masts.map((m) => ({ center: [m.base[0], m.base[2]], radius }))

/** A ramp (ladder/stairs) across the deck break at `x`, `halfWidth` wide, between walk polygons `from` and `to`. */
export const breakRamp = (from: number, to: number, x: number, halfWidth: number, z = 0): DeckAnchors['ramps'][number] => ({ from, to, a: [x, z - halfWidth], b: [x, z + halfWidth] })

/** Scale/shift deck data the way `fitAnchors` scales the rest of the anchors. */
export function fitDeck(d: DeckAnchors, scale: number, dx: number): DeckAnchors {
  const p3 = (v: Vec3): Vec3 => [v[0] * scale + dx, v[1] * scale, v[2] * scale]
  const p2 = (v: Pt): Pt => [v[0] * scale + dx, v[1] * scale]
  return {
    spawn: p3(d.spawn),
    walk: d.walk.map((w) => ({ points: w.points.map(p2), y: w.y * scale })),
    ramps: d.ramps.map((r) => ({ ...r, a: p2(r.a), b: p2(r.b) })),
    obstacles: d.obstacles.map((o) => ({ center: p2(o.center), radius: o.radius * scale })),
    stations: d.stations.map((s) => ({ stand: p3(s.stand), yaw: s.yaw })),
  }
}
