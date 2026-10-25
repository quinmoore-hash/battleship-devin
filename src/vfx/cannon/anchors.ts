import type { Vec3 } from '../../scene/layout'
import type { ShipAnchors, Side } from '../../ships/types'

/** A placed ship's root transform (what `shipWorldTransform` returns). */
export interface ShipPose {
  position: Vec3
  rotationY: number
}

/** Model-space point -> world, for a ship rotated `rotationY` about y at `position`. */
export function localToWorld(local: Vec3, pose: ShipPose): Vec3 {
  const c = Math.cos(pose.rotationY)
  const s = Math.sin(pose.rotationY)
  return [pose.position[0] + local[0] * c + local[2] * s, pose.position[1] + local[1], pose.position[2] - local[0] * s + local[2] * c]
}

/** Model-space direction -> world (rotation only). */
export function directionToWorld(local: Vec3, rotationY: number): Vec3 {
  const c = Math.cos(rotationY)
  const s = Math.sin(rotationY)
  return [local[0] * c + local[2] * s, local[1], -local[0] * s + local[2] * c]
}

export interface WorldMuzzle {
  cell: number
  side: Side
  position: Vec3
  direction: Vec3
}

/** Every cannon of `side` in world space, bow to stern. What the director feeds to `<Broadside>`. */
export function batteryMuzzles(anchors: ShipAnchors, pose: ShipPose, side: Side, cells?: readonly number[]): WorldMuzzle[] {
  return anchors.cannons
    .filter((c) => c.side === side && (cells ? cells.includes(c.cell) : true))
    .map((c) => ({ cell: c.cell, side: c.side, position: localToWorld(c.muzzle, pose), direction: directionToWorld(c.direction, pose.rotationY) }))
}

/** World impact point on `side` of cell `cell` (anchors list the port side; starboard mirrors z). */
export function impactPointWorld(anchors: ShipAnchors, pose: ShipPose, cell: number, side: Side): Vec3 {
  const p = anchors.impactPoints[Math.min(cell, anchors.impactPoints.length - 1)]
  const local: Vec3 = side === 'port' ? p : [p[0], p[1], -p[2]]
  return localToWorld(local, pose)
}

/** Which side of a ship faces a world point. */
export function facingSide(pose: ShipPose, point: Vec3): Side {
  const dx = point[0] - pose.position[0]
  const dz = point[2] - pose.position[2]
  // local z of the target: starboard is +z in the model frame
  const localZ = dx * Math.sin(pose.rotationY) + dz * Math.cos(pose.rotationY)
  return localZ >= 0 ? 'starboard' : 'port'
}
