/** Merged rope / spar geometry helpers for the Sloop rigging (one draw call per rope set). */
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { mergeGeometries } from './geometry'
import { ropeRadiusAtLod } from '../kit/Rope'

export type RopeSeg = [from: Vec3, to: Vec3, radius?: number]

const UP = new THREE.Vector3(0, 1, 0)

/** One cylinder per segment, oriented from → to, merged. Slight catenary sag for long horizontal runs. */
export function ropesGeometry(segments: RopeSeg[], radial = 5, sag = 0, lod = 0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (const [from, to, gauge = 0.009] of segments) {
    const radius = ropeRadiusAtLod(gauge, lod)
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    if (sag > 0 && Math.abs(a.y - b.y) < 0.4 * a.distanceTo(b)) {
      // split into two pieces through a sagging midpoint
      const mid = a.clone().add(b).multiplyScalar(0.5)
      mid.y -= sag * a.distanceTo(b)
      parts.push(cyl(a, mid, radius, radial), cyl(mid, b, radius, radial))
    } else {
      parts.push(cyl(a, b, radius, radial))
    }
  }
  return mergeGeometries(parts)
}

function cyl(a: THREE.Vector3, b: THREE.Vector3, radius: number, radial: number): THREE.BufferGeometry {
  const dir = b.clone().sub(a)
  const len = dir.length()
  const g = new THREE.CylinderGeometry(radius, radius, len, radial, 1, true)
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize())
  g.applyQuaternion(q)
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  return g
}

/** Ratline rungs between consecutive shrouds, every `step` in height from yStart to yEnd. */
export function ratlineSegments(shrouds: [Vec3, Vec3][], yStart: number, yEnd: number, step: number): RopeSeg[] {
  const out: RopeSeg[] = []
  const at = ([from, to]: [Vec3, Vec3], y: number): Vec3 => {
    const t = (y - from[1]) / (to[1] - from[1])
    return [from[0] + (to[0] - from[0]) * t, y, from[2] + (to[2] - from[2]) * t]
  }
  for (let y = yStart; y <= yEnd + 1e-6; y += step) {
    for (let i = 0; i < shrouds.length - 1; i++) out.push([at(shrouds[i], y), at(shrouds[i + 1], y), 0.0055])
  }
  return out
}

/** Lerp helper for points along a rope. */
export const along = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
