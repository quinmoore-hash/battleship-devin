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
  /** How far inboard of the breech the gunner stands (horizontal, metres); clamped so the stand stays inside the walk polygon. */
  back?: number
  /** Barrel length from muzzle to breech (kit `Cannon`: 0.45 × its scale). */
  barrel?: number
  /** Deck obstacles: a stand is pushed along the rail / outboard until it clears every one by `STAND_CLEARANCE`. */
  obstacles?: DeckAnchors['obstacles']
  /** Top of the bulwark / cap rail (plus hammock netting where fitted) at `x`: what the manned eye must look over. */
  railYAt?: (x: number) => number
}

/** Minimum gap between a gunner stand and any obstacle edge (player radius 0.03 + margin), so the stand is always reachable. */
export const STAND_CLEARANCE = 0.06

/**
 * Gunner stations, one per `cannons[i]`: stand inboard of the muzzle on the nearest walkable level, facing the
 * gun's firing direction. `deckYAt(x)` says which level the gun is served from (lower gun decks are served from
 * the weather deck above them, so their stand is further from the muzzle vertically).
 */
export function gunStations(cannons: ShipAnchors['cannons'], walk: DeckAnchors['walk'], deckYAt: (x: number) => number, { back = 0.08, barrel = 0.2, obstacles = [], railYAt }: StationSpec = {}): DeckAnchors['stations'] {
  return cannons.map((c) => {
    const sign = c.side === 'starboard' ? 1 : -1
    const y = deckYAt(c.muzzle[0])
    const sameY = walk.filter((w) => Math.abs(w.y - y) < 1e-6)
    const level = sameY.find((w) => insideConvex(w.points, [c.muzzle[0], 0])) ?? sameY[0] ?? walk[0]
    // a gun right on a deck break: nudge the stand along x until it is over the polygon
    const cx = level.points.reduce((acc, p) => acc + p[0], 0) / level.points.length
    let x = c.muzzle[0]
    for (let i = 0; i < 20 && !insideConvex(level.points, [x, 0]); i++) x += Math.sign(cx - x) * 0.02
    // the breech stays on the gun's side of the centreline even where the hull is narrower than the barrel (bow guns)
    const breechZ = sign * Math.max(Math.abs(c.muzzle[2]) - barrel, 0.08)
    // never closer to the centreline than ~55 % of the muzzle's offset: that is where masts, hatches and the capstan live
    let z = sign * Math.max(Math.abs(breechZ) - back, 0.55 * Math.abs(c.muzzle[2]))
    // keep the stand inside the polygon, stepping inboard until it fits (never past the far rail)
    for (let i = 0; i < 30 && !insideConvex(level.points, [x, z]) && sign * z > -0.3; i++) z -= sign * 0.02
    // clear deck furniture: slide along the rail away from the obstacle, else step back toward the breech
    const blocked = (px: number, pz: number) => obstacles.find((o) => Math.hypot(o.center[0] - px, o.center[1] - pz) <= o.radius + STAND_CLEARANCE)
    for (let i = 0; i < 40; i++) {
      const o = blocked(x, z)
      if (!o) break
      // outboard first (the stand is only ever too far inboard), then along the rail away from the obstacle
      const nz = z + sign * 0.03
      const away = Math.sign(x - o.center[0]) || (x > cx ? 1 : -1)
      const nx = x + away * 0.05
      if (Math.abs(nz) <= Math.abs(breechZ) + 0.04 && insideConvex(level.points, [x, nz])) z = nz
      else if (insideConvex(level.points, [nx, z])) x = nx
      else break
    }
    const stand: Vec3 = [x, level.y, z]
    const breech: Vec3 = [c.muzzle[0], c.muzzle[1], breechZ]
    return { stand, yaw: Math.atan2(c.direction[0], c.direction[2]), breech, ...(railYAt ? { rail: railYAt(c.muzzle[0]) } : {}) }
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
    stations: d.stations.map((s) => ({ stand: p3(s.stand), yaw: s.yaw, ...(s.breech ? { breech: p3(s.breech) } : {}), ...(s.rail !== undefined ? { rail: s.rail * scale } : {}) })),
  }
}
