import type { Coord, PlacedShip, Player, ShotResult } from '../engine'
import { BOARD_LAYOUT, cellToWorld, type Vec3 } from '../scene/layout'
import { SHIPS, shipWorldTransform } from '../ships'
import type { Side } from '../ships/types'
import { batteryMuzzles, facingSide, impactPointWorld, localToWorld, type ShipPose, type WorldMuzzle } from '../vfx/cannon/anchors'
import { impactPointFor } from '../vfx/damage/DamageLayer'
import type { Battery } from './types'

/** Board origin of the fleet owned by `player`, and of the waters that player fires into. */
export const ownBoardOrigin = (player: Player): Vec3 => (player === 'human' ? BOARD_LAYOUT.player.origin : BOARD_LAYOUT.enemy.origin)
export const targetBoardOrigin = (player: Player): Vec3 => ownBoardOrigin(player === 'human' ? 'enemy' : 'human')

export const isAfloat = (ship: PlacedShip): boolean => ship.hits.length < ship.spec.length

/** Guns per battery: a broadside from a big ship uses the three guns nearest the target, a sloop both of its own. */
export const MAX_GUNS = 3

/**
 * The battery that fires at `target`: the nearest afloat ship whose port or starboard side faces the
 * target cell, firing the (up to) `MAX_GUNS` cannons of that side closest to the target's bearing.
 * Returns null when the fleet has no afloat ship (the last ship has just sunk).
 */
export function pickBattery(ships: readonly PlacedShip[], target: Coord, ownOrigin: Vec3, targetOrigin: Vec3, maxGuns = MAX_GUNS): Battery | null {
  const to = cellToWorld(target, targetOrigin)
  let best: { ship: PlacedShip; pose: ShipPose; side: Side; dist: number } | null = null
  for (const ship of ships) {
    if (!isAfloat(ship)) continue
    const pose = shipWorldTransform(ship, ownOrigin)
    const side = facingSide(pose, to)
    const dist = Math.hypot(to[0] - pose.position[0], to[2] - pose.position[2])
    if (!best || dist < best.dist) best = { ship, pose, side, dist }
  }
  if (!best) return null
  const anchors = SHIPS[best.ship.spec.id].anchors
  const guns = anchors.cannons.filter((c) => c.side === best.side)
  const scored = guns
    .map((g) => {
      const w = localToWorld(g.muzzle, best.pose)
      return { cell: g.cell, d: Math.hypot(to[0] - w[0], to[2] - w[2]) }
    })
    .sort((a, b) => a.d - b.d)
  const cells = [...new Set(scored.slice(0, maxGuns).map((g) => g.cell))].sort((a, b) => a - b)
  return { shipId: best.ship.spec.id, uid: best.ship.uid, side: best.side, cells }
}

export interface ShotPlan {
  by: Player
  result: ShotResult
  battery: Battery | null
  /** The firing ship's root transform (null for the unseen Navy line). */
  shooter: ShipPose | null
  /** World-space muzzles that fire, bow to stern. */
  muzzles: WorldMuzzle[]
  /** World impact point (water for a miss, hull/deck for a hit). */
  impact: Vec3
  /** Outward normal at the impact (toward the shooter). */
  normal: Vec3
  /** The ship that was hit, if it is a known ship on the target board. */
  victim?: { ship: PlacedShip; pose: ShipPose; cellIndex: number; side: Side }
  /** Centre of the target cell on the water. */
  cellCenter: Vec3
}

/** Where the Royal Navy fires from when none of its ships is revealed: a gun line in the haze past the far edge of its waters. */
export function navyLineMuzzles(target: Coord, count = 3): WorldMuzzle[] {
  const o = BOARD_LAYOUT.enemy.origin
  const z = o[2] - 2.6
  const y = o[1] + 0.55
  const cx = o[0] + (target.x + 0.5) * BOARD_LAYOUT.enemy.cellSize
  return Array.from({ length: count }, (_, i) => {
    const x = cx + (i - (count - 1) / 2) * 1.1
    return { cell: i, side: 'starboard' as Side, position: [x, y, z] as Vec3, direction: [0, 0.08, 1] as Vec3 }
  })
}

export const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

/**
 * Everything the camera and VFX need for one shot. `shooters` is the firing player's fleet,
 * `targets` the fleet on the board being fired at (the hidden enemy fleet is still known to the engine, so a
 * hit on it lands on the real hull; the model itself stays hidden unless the ship is sunk).
 */
export function planShot(by: Player, result: ShotResult, shooters: readonly PlacedShip[], targets: readonly PlacedShip[], battery?: Battery, maxGuns = MAX_GUNS): ShotPlan {
  const ownOrigin = ownBoardOrigin(by)
  const tgtOrigin = targetBoardOrigin(by)
  const cellCenter = cellToWorld(result.coord, tgtOrigin)
  const chosen = battery ?? pickBattery(shooters, result.coord, ownOrigin, tgtOrigin, maxGuns)
  let shooter: ShipPose | null = null
  let muzzles: WorldMuzzle[] = []
  const firing = chosen ? shooters.find((s) => s.uid === chosen.uid) : undefined
  if (chosen && firing) {
    shooter = shipWorldTransform(firing, ownOrigin)
    muzzles = batteryMuzzles(SHIPS[firing.spec.id].anchors, shooter, chosen.side, chosen.cells).slice(0, maxGuns)
  }
  if (muzzles.length === 0 && by === 'enemy') muzzles = navyLineMuzzles(result.coord, maxGuns)
  const from: Vec3 = muzzles.length ? muzzles[Math.floor(muzzles.length / 2)].position : shooter?.position ?? [cellCenter[0], 2, cellCenter[2] + (by === 'human' ? 14 : -14)]

  let impact: Vec3 = cellCenter
  let normal: Vec3 = unit([from[0] - cellCenter[0], 0, from[2] - cellCenter[2]])
  let victim: ShotPlan['victim']
  if (result.outcome === 'lost') {
    impact = lostPoint(result.coord, cellCenter, normal)
  } else if (result.outcome !== 'miss') {
    const ship = targets.find((s) => s.cells.some((c) => c.x === result.coord.x && c.y === result.coord.y))
    if (ship) {
      const pose = shipWorldTransform(ship, tgtOrigin)
      const cellIndex = ship.cells.findIndex((c) => c.x === result.coord.x && c.y === result.coord.y)
      const side = facingSide(pose, from)
      const anchors = SHIPS[ship.spec.id].anchors
      const ip = impactPointFor(anchors.impactPoints, cellIndex, ship.spec.length)
      if (ip) {
        const local: Vec3 = [ip[0], ip[1] + 0.05, side === 'port' ? ip[2] : -ip[2]]
        // keep the hit on the target cell's slice of the hull
        const [cx, , cz] = cellCenter
        const w = localToWorld(local, pose)
        impact = ship.orientation === 'horizontal' ? [cx, w[1], w[2]] : [w[0], w[1], cz]
      } else impact = impactPointWorld(anchors, pose, cellIndex, side)
      normal = side === 'port' ? unit([Math.sin(pose.rotationY) * -1, 0, -Math.cos(pose.rotationY)]) : unit([Math.sin(pose.rotationY), 0, Math.cos(pose.rotationY)])
      victim = { ship, pose, cellIndex, side }
    } else {
      impact = [cellCenter[0], cellCenter[1] + 0.35, cellCenter[2]]
    }
  }
  return { by, result, battery: chosen, shooter, muzzles, impact, normal, victim, cellCenter }
}

/** Water point a miss lands on: the target cell, offset a little past centre along the flight so the splash reads as "short/long". */
export const missPoint = (plan: ShotPlan): Vec3 => plan.cellCenter

/** How far (in cells) a shot lost in the storm goes astray: it never comes down on the target cell. */
export const LOST_DRIFT = { along: 0.75, across: 0.45 } as const

/**
 * Where a shot lost in the storm comes down: blown long past the target cell (`normal` points back at the shooter) and
 * pushed sideways by a deterministic amount per cell, so the muted splash never sits on the square and reads as "astray".
 */
export function lostPoint(coord: Coord, cellCenter: Vec3, normal: Vec3): Vec3 {
  const side = ((coord.x * 7 + coord.y * 13) % 2 === 0 ? 1 : -1) * LOST_DRIFT.across
  return [cellCenter[0] - normal[0] * LOST_DRIFT.along - normal[2] * side, cellCenter[1], cellCenter[2] - normal[2] * LOST_DRIFT.along + normal[0] * side]
}
