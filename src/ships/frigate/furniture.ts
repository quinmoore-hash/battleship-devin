/**
 * Deck furniture built as merged static geometry per material: hatches with gratings, capstan, bitts and
 * fife rails, pin rails with belaying pins, ladders at the deck breaks, skid beams with two ship's boats,
 * binnacle, belfry, galley stovepipe, cleats. Pure; cached per LOD.
 */
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { basicHullSections, loftHull } from '../kit/hull'
import type { Lod } from '../types'
import { FRIGATE, MASTS, bulwarkHalfWidth, deckY, halfBeamAtDeck } from './form'
import { box, cyl, mergeGeometries } from './geometry'
import type { HullParts, PartKey } from './hull'

const cache = new Map<Lod, HullParts>()

/** Where the two ship's boats sit (used by the model to skip furniture under them). */
export const BOAT_SPOTS: { x: number; z: number; length: number }[] = [
  { x: 0.3, z: 0.17, length: 0.52 },
  { x: 0.3, z: -0.17, length: 0.46 },
]

export function buildFurniture(lod: Lod): HullParts {
  const hit = cache.get(lod)
  if (hit) return hit
  const parts: Partial<Record<PartKey, THREE.BufferGeometry[]>> = {}
  const add = (key: PartKey, g: THREE.BufferGeometry) => (parts[key] ??= []).push(g)
  const dY = FRIGATE.deckY
  const fine = lod === 0

  if (lod < 2) {
    // ---- hatches: coaming frame + grating
    const hatch = (x: number, y: number, size: number) => {
      const t = 0.03
      const h = 0.045
      add('oak', box(size, h, t, [x, y + h / 2, size / 2 - t / 2]))
      add('oak', box(size, h, t, [x, y + h / 2, -size / 2 + t / 2]))
      add('oak', box(t, h, size - 2 * t, [x + size / 2 - t / 2, y + h / 2, 0]))
      add('oak', box(t, h, size - 2 * t, [x - size / 2 + t / 2, y + h / 2, 0]))
      const g = new THREE.PlaneGeometry(size - 2 * t, size - 2 * t).rotateX(-Math.PI / 2).translate(x, y + h - 0.004, 0)
      add('grating', g)
    }
    hatch(-0.5, dY, 0.26)
    hatch(0.88, dY, 0.18)
    hatch(-1.25, FRIGATE.qdY, 0.14)

    // ---- capstan
    const cx = -0.3
    add('oak', cyl(0.055, 0.06, 0.17, [cx, dY + 0.085, 0], 12))
    add('oak', cyl(0.085, 0.075, 0.045, [cx, dY + 0.19, 0], 12))
    add('iron', cyl(0.03, 0.03, 0.02, [cx, dY + 0.222, 0], 8))
    if (fine) {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        add('oak', box(0.025, 0.14, 0.02, [cx + Math.cos(a) * 0.065, dY + 0.075, Math.sin(a) * 0.065], -a))
        add('black', box(0.018, 0.018, 0.012, [cx + Math.cos(a + 0.5) * 0.085, dY + 0.195, Math.sin(a + 0.5) * 0.085], -(a + 0.5)))
      }
    }

    // ---- bitts and fife rails at the fore and main masts, pin rails inside the bulwarks
    for (const m of MASTS.slice(0, 2)) {
      const y = deckY(m.x)
      for (const z of [-0.13, 0.13]) add('oak', box(0.04, 0.24, 0.04, [m.x - 0.11, y + 0.12, z]))
      add('oak', box(0.035, 0.03, 0.3, [m.x - 0.11, y + 0.235, 0]))
      add('oak', box(0.09, 0.04, 0.3, [m.x + 0.12, y + 0.02, 0]))
      if (fine) {
        for (const z of [-0.1, 0, 0.1]) add('oak', cyl(0.006, 0.006, 0.05, [m.x - 0.11, y + 0.21, z], 6, Math.PI / 2))
      }
    }
    for (const m of MASTS) {
      const y = deckY(m.x) + 0.13
      for (const side of [1, -1] as const) {
        const z = side * (bulwarkHalfWidth(m.x, y) - FRIGATE.bulwarkT - 0.02)
        add('oak', box(0.34, 0.016, 0.04, [m.x, y, z]))
        if (fine) for (let i = 0; i < 6; i++) add('oak', cyl(0.004, 0.004, 0.05, [m.x - 0.13 + i * 0.052, y + 0.01, z], 5))
      }
    }

    // ---- ladders at the deck breaks
    const ladder = (x: number, z: number, yLow: number, yHigh: number, facing: 1 | -1, width = 0.12) => {
      const run = 0.16
      const rise = yHigh - yLow
      const ang = Math.atan2(run, rise)
      const len = Math.hypot(run, rise)
      for (const dz of [-width / 2, width / 2]) add('oak', box(0.03, len, 0.02, [x + (facing * run) / 2, yLow + rise / 2, z + dz], 0, 0, -facing * ang))
      const steps = 4
      for (let i = 1; i <= steps; i++) {
        const t = i / (steps + 1)
        add('oak', box(0.05, 0.012, width, [x + facing * run * (1 - t), yLow + rise * t, z]))
      }
    }
    ladder(FRIGATE.qdBreakX, -0.24, dY, FRIGATE.qdY, 1)
    ladder(FRIGATE.qdBreakX, 0.24, dY, FRIGATE.qdY, 1)
    ladder(FRIGATE.fcBreakX, 0.16, dY, FRIGATE.fcY, -1, 0.1)

    // ---- skid beams across the waist and two ship's boats
    const beamY = dY + 0.235
    for (const bx of [0.08, 0.52]) {
      const w = 2 * (halfBeamAtDeck(bx) - FRIGATE.bulwarkT) + 0.02
      add('oak', box(0.05, 0.035, w, [bx, beamY, 0]))
    }
    for (const b of BOAT_SPOTS) {
      const sections = basicHullSections(b.length, b.length * 0.34, 0.07, 0.07)
      const g = loftHull(sections, 5)
      g.translate(b.x, beamY + 0.08, b.z)
      add('oak', g)
      const inner = loftHull(basicHullSections(b.length * 0.92, b.length * 0.3, 0.05, 0.065), 4)
      inner.scale(1, 1, 1)
      inner.translate(b.x, beamY + 0.082, b.z)
      add('black', inner)
      if (fine) {
        for (const t of [-0.3, 0, 0.3]) add('oak', box(0.03, 0.012, b.length * 0.3, [b.x + t * b.length, beamY + 0.13, b.z]))
        add('oak', box(b.length * 0.8, 0.008, 0.012, [b.x, beamY + 0.12, b.z + b.length * 0.1]))
        add('oak', box(b.length * 0.7, 0.008, 0.012, [b.x, beamY + 0.12, b.z - b.length * 0.1]))
      }
    }

    // ---- binnacle before the wheel, companion skylight on the quarterdeck
    add('oak', box(0.07, 0.14, 0.09, [-1.1, FRIGATE.qdY + 0.07, 0]))
    add('brass', box(0.075, 0.012, 0.095, [-1.1, FRIGATE.qdY + 0.146, 0]))
    add('glass', box(0.03, 0.03, 0.03, [-1.1, FRIGATE.qdY + 0.165, 0]))
    add('oak', box(0.16, 0.06, 0.14, [-0.95, FRIGATE.qdY + 0.03, 0.2]))
    add('glass', box(0.12, 0.012, 0.1, [-0.95, FRIGATE.qdY + 0.064, 0.2]))

    // ---- belfry at the forecastle break, galley stovepipe
    add('oak', box(0.03, 0.2, 0.03, [1.1, FRIGATE.fcY + 0.1, -0.06]))
    add('oak', box(0.03, 0.2, 0.03, [1.1, FRIGATE.fcY + 0.1, 0.06]))
    add('oak', box(0.05, 0.03, 0.15, [1.1, FRIGATE.fcY + 0.215, 0]))
    add('brass', new THREE.CylinderGeometry(0.03, 0.045, 0.05, 10).translate(1.1, FRIGATE.fcY + 0.17, 0))
    add('black', cyl(0.02, 0.022, 0.16, [0.72, dY + 0.08, 0.17], 8))
    add('black', cyl(0.03, 0.03, 0.012, [0.72, dY + 0.165, 0.17], 8))

    // ---- cleats on the quarterdeck and forecastle rails
    if (fine) {
      for (const [x, side] of [
        [-1.0, 1],
        [-1.0, -1],
        [-1.3, 1],
        [-1.3, -1],
        [1.2, 1],
        [1.2, -1],
      ] as [number, 1 | -1][]) {
        const y = deckY(x) + 0.08
        const z = side * (bulwarkHalfWidth(x, y) - FRIGATE.bulwarkT - 0.02)
        add('oak', box(0.07, 0.014, 0.02, [x, y, z]))
        add('oak', box(0.02, 0.03, 0.02, [x, y - 0.015, z]))
      }
    }
  }

  const out: HullParts = {}
  for (const key of Object.keys(parts) as PartKey[]) out[key] = mergeGeometries(parts[key]!)
  cache.set(lod, out)
  return out
}

/** Positions for the kit props placed by the model (barrels, crates, coils) — kept here so they're deterministic. */
export const PROP_SPOTS: { kind: 'barrel' | 'crate' | 'coil'; at: Vec3; scale?: number }[] = [
  { kind: 'barrel', at: [-0.7, FRIGATE.deckY, 0.3], scale: 0.55 },
  { kind: 'barrel', at: [-0.7, FRIGATE.deckY, 0.38], scale: 0.5 },
  { kind: 'crate', at: [0.62, FRIGATE.deckY, -0.32] },
  { kind: 'crate', at: [0.62, FRIGATE.deckY, -0.2], scale: 0.8 },
  { kind: 'coil', at: [0.55, FRIGATE.deckY, 0.33] },
  { kind: 'coil', at: [-0.15, FRIGATE.deckY, -0.36] },
  { kind: 'coil', at: [-1.2, FRIGATE.qdY, -0.2] },
  { kind: 'coil', at: [1.25, FRIGATE.fcY, 0.08] },
  { kind: 'barrel', at: [-1.33, FRIGATE.qdY, 0.18], scale: 0.45 },
]
