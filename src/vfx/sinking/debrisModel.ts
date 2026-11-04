import type { Vec3 } from '../../scene/layout'
import { clamp01, easeOutCubic, lerp } from '../math'
import { seededRandom } from '../random'
import type { HullDims } from './pose'

export type DebrisKind = 'plank' | 'barrel' | 'crate' | 'hat' | 'spar' | 'wheel'

/** A piece of wreckage bobbing on the surface. World xz; rotation about y. */
export interface FlotsamPiece {
  kind: DebrisKind
  x: number
  z: number
  rotY: number
  scale: number
  /** Seconds offset so pieces don't bob in sync. */
  phase: number
}

/** A flotsam piece plus how it leaves the ship during the sink. */
export interface DebrisPiece extends FlotsamPiece {
  /** Progress at which it is torn loose, and how long (in progress units) it flies. */
  launchAt: number
  flight: number
  /** World launch point (hull side, deck height). */
  from: Vec3
  /** Metres above the chord the arc peaks. */
  apex: number
  /** Tumble speed (radians per unit of flight) about each axis. */
  spin: Vec3
}

export interface DebrisState {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
  scale: number
  /** false while the piece is still part of the ship. */
  visible: boolean
  /** 0..1 flight progress (1 once it has landed). */
  flight: number
}

/** World centres of the cells a ship covers, from its placed transform (bow = +x in the ship frame). */
export function footprintCenters(position: Vec3, rotationY: number, length: number): Vec3[] {
  const dx = Math.cos(rotationY)
  const dz = -Math.sin(rotationY)
  return Array.from({ length }, (_, i) => {
    const s = length / 2 - (i + 0.5)
    return [position[0] + dx * s, position[1], position[2] + dz * s] as Vec3
  })
}

const KINDS: DebrisKind[] = ['plank', 'plank', 'plank', 'barrel', 'crate', 'spar', 'plank', 'barrel']

/**
 * Deterministic wreckage for a set of cells: a few planks per cell, the odd barrel/crate/spar, and at
 * most one hat and one ship's wheel per ship. Same seed => same layout, so `<Debris>` can hand over
 * to `<Flotsam>` without anything moving.
 */
export function flotsamLayout(centers: readonly Vec3[], seed: number): FlotsamPiece[] {
  const rnd = seededRandom(seed)
  const pieces: FlotsamPiece[] = []
  let hat = false
  let wheel = false
  centers.forEach((c, ci) => {
    const n = 2 + (rnd() < 0.5 ? 1 : 0)
    for (let j = 0; j < n; j++) {
      let kind: DebrisKind = KINDS[Math.floor(rnd() * KINDS.length)]
      if (!hat && rnd() < 0.18) {
        kind = 'hat'
        hat = true
      } else if (!wheel && ci === centers.length - 1 && rnd() < 0.5) {
        kind = 'wheel'
        wheel = true
      }
      pieces.push({
        kind,
        x: c[0] + (rnd() - 0.5) * 0.78,
        z: c[2] + (rnd() - 0.5) * 0.78,
        rotY: rnd() * Math.PI * 2,
        scale: 0.85 + rnd() * 0.3,
        phase: rnd() * 10,
      })
    }
  })
  return pieces
}

export interface DebrisLaunch {
  position: Vec3
  rotationY: number
  hull: HullDims
  deckY: number
  /** +1 launches off the starboard (+z) side, -1 off port. */
  side: 1 | -1
}

/** Flotsam layout plus launch parameters so each piece is flung off the listing side and lands where it will float. */
export function debrisPieces(centers: readonly Vec3[], seed: number, launch: DebrisLaunch): DebrisPiece[] {
  const rnd = seededRandom(seed ^ 0x9e3779b9)
  const dx = Math.cos(launch.rotationY)
  const dz = -Math.sin(launch.rotationY)
  // ship-frame +z in world
  const sx = Math.sin(launch.rotationY)
  const sz = Math.cos(launch.rotationY)
  return flotsamLayout(centers, seed).map((piece) => {
    // project the rest position onto the keel to find where along the hull it breaks away
    const rx = piece.x - launch.position[0]
    const rz = piece.z - launch.position[2]
    const along = Math.max(-launch.hull.length / 2, Math.min(launch.hull.length / 2, rx * dx + rz * dz))
    const off = (launch.hull.beam / 2) * launch.side
    const from: Vec3 = [
      launch.position[0] + dx * along + sx * off,
      launch.position[1] + launch.deckY,
      launch.position[2] + dz * along + sz * off,
    ]
    const heavy = piece.kind === 'barrel' || piece.kind === 'crate' || piece.kind === 'wheel'
    return {
      ...piece,
      launchAt: 0.28 + rnd() * 0.42,
      flight: 0.08 + rnd() * 0.07,
      from,
      apex: (heavy ? 0.25 : 0.45) + rnd() * 0.4,
      spin: [(rnd() - 0.5) * 9, (rnd() - 0.5) * 6, (rnd() - 0.5) * 9],
    }
  })
}

/** Bobbing offset for a floating piece (metres and radians) at scene time `t`. */
export function bobAt(t: number, phase: number) {
  const a = t * 1.3 + phase
  return { y: Math.sin(a) * 0.012 + Math.sin(a * 0.57 + 1.3) * 0.008, rx: Math.sin(a * 0.8) * 0.05, rz: Math.cos(a * 0.65 + 0.7) * 0.06 }
}

/**
 * Where a piece is at sink `progress`, scene time `t`, with the live water level `waterY` at its rest point.
 * Pure. `instant` (reduced motion) skips the flight and places the piece straight on the water.
 */
export function debrisState(piece: DebrisPiece, progress: number, t: number, waterY: number, instant = false): DebrisState {
  const bob = bobAt(t, piece.phase)
  if (progress < piece.launchAt) {
    return { x: piece.x, y: waterY, z: piece.z, rx: 0, ry: piece.rotY, rz: 0, scale: 0, visible: false, flight: 0 }
  }
  const k = instant ? 1 : clamp01((progress - piece.launchAt) / piece.flight)
  if (k >= 1) {
    return {
      x: piece.x,
      y: waterY + bob.y,
      z: piece.z,
      rx: bob.rx,
      ry: piece.rotY,
      rz: bob.rz,
      scale: piece.scale,
      visible: true,
      flight: 1,
    }
  }
  const e = easeOutCubic(k)
  const x = lerp(piece.from[0], piece.x, e)
  const z = lerp(piece.from[2], piece.z, e)
  const y = lerp(piece.from[1], waterY, k) + piece.apex * 4 * k * (1 - k)
  return {
    x,
    y,
    z,
    rx: piece.spin[0] * k,
    ry: piece.rotY + piece.spin[1] * k,
    rz: piece.spin[2] * k,
    scale: piece.scale * (0.6 + 0.4 * Math.min(1, k * 4)),
    visible: true,
    flight: k,
  }
}
