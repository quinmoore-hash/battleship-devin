/**
 * Static frigate geometry, grouped by material key and merged into one geometry per key so a whole hull
 * is a handful of draw calls. Pure (no React); cached per LOD because it is livery-independent.
 */
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { loftHullParts } from '../kit/hull'
import type { Lod } from '../types'
import { FRIGATE, GUN_PORT_W, GUN_X, MASTS, bulwarkHalfWidth, deckOutline, deckY, gunX, halfBeamAtDeck, hullSections, hullStations, keelY, railY, sectionHalfWidth } from './form'
import { box, cyl, deckPlate, mergeGeometries, remapHullUvs, ridge, triangleCount, tube, wallStrip, wallStripPair } from './geometry'
import type { FrigateMaterials } from './materials'

export type PartKey = keyof FrigateMaterials
export type HullParts = Partial<Record<PartKey, THREE.BufferGeometry>>

const { xStern, xBow, qdBreakX, fcBreakX, bulwarkT, copperTop } = FRIGATE

/** Bulwark runs: [x0, x1, bulwark height]. */
export const BULWARK_RUNS: [number, number, number][] = [
  [xStern + 0.012, qdBreakX, 0.17],
  [qdBreakX, fcBreakX, FRIGATE.bulwarkH],
  [fcBreakX, xBow - 0.1, 0.17],
]
export const PORT_SILL = 0.045
export const PORT_LINTEL = 0.155

/** Height of the top of the cap rail above the deck at `x`. */
export function capRailTop(x: number): number {
  const run = BULWARK_RUNS.find(([a, b]) => x >= a && x <= b) ?? BULWARK_RUNS[1]
  return railY(x) + run[2] + 0.025
}

const cache = new Map<Lod, HullParts>()

export function buildHullParts(lod: Lod): HullParts {
  const hit = cache.get(lod)
  if (hit) return hit
  const parts: Partial<Record<PartKey, THREE.BufferGeometry[]>> = {}
  const add = (key: PartKey, g: THREE.BufferGeometry) => (parts[key] ??= []).push(g)
  const fine = lod === 0
  const detail = lod <= 1

  // ---- lofted hull: copper below the waterline, planks above
  // the kit lofter is a Catmull-Rom loft; we only want its planked sides (keel, wales, decks are authored below)
  const loft = { deck: false, keel: false as const, sheer: 0 }
  const stations = hullStations(lod === 2 ? 10 : 18)
  const lowerRings = lod === 2 ? 5 : 9
  const lower = loftHullParts(hullSections(stations, keelY, () => copperTop, lowerRings), { ...loft, rings: lowerRings, segments: lod === 2 ? 18 : 44 }).sides
  add('copper', remapHullUvs(lower, 1, 1, () => 0))
  const upperStations = hullStations(lod === 2 ? 10 : 18, [qdBreakX - 0.004, qdBreakX + 0.004, fcBreakX - 0.004, fcBreakX + 0.004])
  const upperRings = lod === 2 ? 4 : 7
  const upper = loftHullParts(hullSections(upperStations, () => copperTop, railY, upperRings), { ...loft, rings: upperRings, segments: lod === 2 ? 18 : 48 }).sides
  add('hull', remapHullUvs(upper, 1, 1, () => 0))

  // ---- waterline weed/barnacle band, wales, painted stripe, sheer moulding
  if (detail) {
    add('waterline', wallStripPair({ x0: xStern + 0.01, x1: xBow - 0.12, yBottom: -0.06, yTop: 0.06, hw: sectionHalfWidth, outOffset: 0.005, thickness: 0.02, steps: 40, uvScale: [1, 1 / 0.12] }))
    for (const [a, b] of [
      [0.17, 0.215],
      [0.3, 0.345],
    ]) {
      add('black', wallStripPair({ x0: xStern + 0.015, x1: xBow - 0.16, yBottom: a, yTop: b, hw: sectionHalfWidth, outOffset: 0.012, thickness: 0.03, steps: 36, uvScale: [1, 4] }))
    }
    add('stripe', wallStripPair({ x0: xStern + 0.015, x1: xBow - 0.16, yBottom: 0.215, yTop: 0.3, hw: sectionHalfWidth, outOffset: 0.005, thickness: 0.02, steps: 36, uvScale: [1, 4] }))
  }

  // ---- bulwarks with gun ports, sills, lintels and cap rails; decks; hammock netting
  for (const [x0, x1, h] of BULWARK_RUNS) {
    const rail = railY((x0 + x1) / 2)
    for (const side of [1, -1] as const) {
      const ports = GUN_X.map((gx) => gunX(gx, side > 0 ? 'starboard' : 'port')).filter((gx) => gx - GUN_PORT_W / 2 > x0 && gx + GUN_PORT_W / 2 < x1)
        .sort((a, b) => a - b)
      if (lod === 2) {
        add('hull', wallStrip({ x0, x1, yBottom: rail, yTop: rail + h, hw: bulwarkHalfWidth, thickness: bulwarkT, side, steps: 10, uvScale: [1, 4] }))
      } else {
        let cursor = x0
        const panels = [...ports.map((gx) => [gx - GUN_PORT_W / 2, gx + GUN_PORT_W / 2] as [number, number]), [x1, x1]]
        for (const [pa, pb] of panels) {
          if (pa - cursor > 0.005) {
            add('hull', wallStrip({ x0: cursor, x1: pa, yBottom: rail, yTop: rail + h, hw: bulwarkHalfWidth, thickness: bulwarkT, side, uvScale: [1, 4] }))
            // painted inboard face (red ochre) so the far bulwark reads through an open port
            add('lidInside', wallStrip({ x0: cursor + 0.002, x1: pa - 0.002, yBottom: rail + 0.002, yTop: rail + h - 0.03, hw: bulwarkHalfWidth, outOffset: -bulwarkT - 0.002, thickness: 0.004, side, uvScale: [1, 4] }))
          }
          if (pb > pa) {
            add('hull', wallStrip({ x0: pa, x1: pb, yBottom: rail, yTop: rail + PORT_SILL, hw: bulwarkHalfWidth, thickness: bulwarkT, side, steps: 2, uvScale: [1, 4] }))
            add('hull', wallStrip({ x0: pa, x1: pb, yBottom: rail + PORT_LINTEL, yTop: rail + h, hw: bulwarkHalfWidth, thickness: bulwarkT, side, steps: 2, uvScale: [1, 4] }))
          }
          cursor = pb
        }
      }
      add('black', wallStrip({ x0, x1, yBottom: rail + h, yTop: rail + h + 0.025, hw: bulwarkHalfWidth, outOffset: 0.014, thickness: bulwarkT + 0.028, side, uvScale: [1, 4] }))
      // sheer moulding at the deck edge
      if (detail) add('black', wallStrip({ x0, x1, yBottom: rail - 0.03, yTop: rail + 0.005, hw: bulwarkHalfWidth, outOffset: 0.012, thickness: 0.02, side, uvScale: [1, 4] }))
      // hammock netting rolls on the main deck + quarterdeck rails
      if (detail && h > 0.17) {
        const pts: Vec3[] = []
        for (let i = 0; i <= 10; i++) {
          const x = x0 + 0.03 + ((x1 - x0 - 0.06) * i) / 10
          pts.push([x, rail + h + 0.025 + 0.03, side * (bulwarkHalfWidth(x, rail + h) - 0.005)])
        }
        add('netting', tube(pts, 0.032, 20, 7))
      }
    }
    // deck planking
    const deckX0 = x0 === BULWARK_RUNS[0][0] ? xStern + 0.004 : x0
    const deckX1 = x1 === BULWARK_RUNS[2][1] ? xBow - 0.02 : x1
    add('deck', deckPlate(deckOutline(deckX0, deckX1, bulwarkT - 0.004), deckY((x0 + x1) / 2), 1))
  }

  // ---- deck breaks: bulkheads with doors
  const breakBulkhead = (x: number, yLow: number, yHigh: number, facing: 1 | -1, doors: number[]) => {
    const w = 2 * (halfBeamAtDeck(x) - bulwarkT)
    add('hull', box(0.03, yHigh - yLow, w, [x - facing * 0.015, (yLow + yHigh) / 2, 0]))
    add('black', box(0.012, 0.025, w, [x - facing * 0.015 + facing * 0.012, yHigh - 0.012, 0]))
    if (detail) {
      for (const z of doors) {
        add('black', box(0.01, (yHigh - yLow) * 0.75, 0.1, [x + facing * 0.004, yLow + (yHigh - yLow) * 0.375, z]))
        add('brass', box(0.012, 0.012, 0.012, [x + facing * 0.01, yLow + (yHigh - yLow) * 0.4, z + 0.035]))
      }
    }
  }
  breakBulkhead(qdBreakX, FRIGATE.deckY, FRIGATE.qdY, 1, [-0.22, 0.22])
  breakBulkhead(fcBreakX, FRIGATE.deckY, FRIGATE.fcY, -1, [0])

  // ---- keel, stem, sternpost, rudder
  const keelXs: number[] = []
  for (let x = -1.3; x <= 1.2; x += 0.1) keelXs.push(x)
  add('black', ridge(keelXs, (x) => keelY(x) - 0.045, (x) => keelY(x) + 0.02, 0.022))
  add('black', tube([[1.0, keelY(1.0) - 0.03, 0], [1.3, -0.12, 0], [1.44, 0.15, 0], [1.49, 0.42, 0], [1.53, 0.66, 0]], 0.03, 12, 7))
  const postA: Vec3 = [-1.3, -0.37, 0]
  const postB: Vec3 = [-1.44, -0.1, 0]
  const postAng = Math.atan2(postB[0] - postA[0], postB[1] - postA[1])
  const postLen = Math.hypot(postB[0] - postA[0], postB[1] - postA[1])
  add('black', box(0.05, postLen + 0.08, 0.045, [(postA[0] + postB[0]) / 2, (postA[1] + postB[1]) / 2, 0], 0, 0, -postAng))
  add('oak', box(0.09, postLen + 0.3, 0.028, [(postA[0] + postB[0]) / 2 - 0.065, (postA[1] + postB[1]) / 2 + 0.09, 0], 0, 0, -postAng))
  if (detail) {
    for (const t of [0.15, 0.5, 0.85]) {
      const px = postA[0] + (postB[0] - postA[0]) * t - 0.04
      const py = postA[1] + (postB[1] - postA[1]) * t + 0.03
      add('iron', box(0.12, 0.012, 0.05, [px, py, 0], 0, 0, -postAng))
    }
  }

  // ---- transom: stern windows, mouldings, quarter galleries
  const tz = sectionHalfWidth(xStern, 0.42)
  add('gilt', box(0.012, 0.02, 2 * halfBeamAtDeck(xStern) + 0.03, [xStern - 0.006, FRIGATE.qdY + 0.006, 0]))
  add('gilt', box(0.012, 0.016, 2 * sectionHalfWidth(xStern, 0.33) + 0.02, [xStern - 0.006, 0.335, 0]))
  if (detail) {
    const n = 5
    for (let i = 0; i < n; i++) {
      const z = -tz * 0.72 + (tz * 1.44 * i) / (n - 1)
      add('glass', box(0.006, 0.1, 0.07, [xStern - 0.004, 0.42, z]))
      add('gilt', box(0.01, 0.1, 0.008, [xStern - 0.008, 0.42, z - 0.035]))
      add('gilt', box(0.01, 0.1, 0.008, [xStern - 0.008, 0.42, z + 0.035]))
      add('gilt', box(0.01, 0.008, 0.07, [xStern - 0.008, 0.47, z]))
      add('gilt', box(0.01, 0.008, 0.07, [xStern - 0.008, 0.37, z]))
      if (fine) add('gilt', box(0.009, 0.1, 0.004, [xStern - 0.008, 0.42, z]))
    }
    add('trim', box(0.01, 0.045, 2 * tz * 0.8, [xStern - 0.005, 0.53, 0]))
    // quarter galleries
    for (const side of [1, -1] as const) {
      const gx = -1.3
      const gz = side * (sectionHalfWidth(gx, 0.42) + 0.028)
      add('hull', box(0.2, 0.2, 0.056, [gx, 0.43, gz]))
      add('gilt', box(0.22, 0.014, 0.07, [gx, 0.535, gz]))
      add('gilt', box(0.22, 0.014, 0.07, [gx, 0.325, gz]))
      add('glass', box(0.07, 0.08, 0.006, [gx, 0.44, gz + side * 0.028]))
      add('gilt', box(0.09, 0.008, 0.01, [gx, 0.485, gz + side * 0.03]))
      add('gilt', box(0.09, 0.008, 0.01, [gx, 0.395, gz + side * 0.03]))
    }
  }

  // ---- channels, deadeyes and chain plates at each mast
  if (detail) {
    for (const m of MASTS) {
      const y = deckY(m.x) + 0.15
      for (const side of [1, -1] as const) {
        const hw = bulwarkHalfWidth(m.x, y)
        add('black', box(0.36, 0.02, 0.07, [m.x - 0.02, y, side * (hw + 0.03)]))
        for (let i = 0; i < 4; i++) {
          const x = m.x - 0.14 + i * 0.08
          add('oak', cyl(0.016, 0.016, 0.014, [x, y + 0.017, side * (hw + 0.05)]))
          const top: Vec3 = [x, y - 0.01, side * (hw + 0.05)]
          const bot: Vec3 = [x, 0.35, side * (sectionHalfWidth(x, 0.35) + 0.012)]
          const len = Math.hypot(top[1] - bot[1], top[2] - bot[2])
          const ang = Math.atan2(top[2] - bot[2], top[1] - bot[1])
          add('iron', box(0.012, len, 0.008, [x, (top[1] + bot[1]) / 2, (top[2] + bot[2]) / 2], 0, -ang))
        }
      }
    }
  }

  // ---- catheads at the bow
  if (detail) {
    for (const side of [1, -1] as const) {
      const hw = bulwarkHalfWidth(1.22, FRIGATE.fcY + 0.1)
      add('black', box(0.06, 0.05, 0.24, [1.22, FRIGATE.fcY + 0.16, side * (hw + 0.02)]))
    }
  }

  // ---- figurehead (gilt sea-serpent) and trailboards
  if (detail) {
    const curve: Vec3[] = [
      [1.5, 0.46, 0],
      [1.56, 0.56, 0],
      [1.6, 0.66, 0],
      [1.62, 0.76, 0],
    ]
    curve.forEach((p, i) => add('gilt', new THREE.SphereGeometry(0.036 - i * 0.004, 10, 8).translate(...p)))
    add('gilt', new THREE.ConeGeometry(0.03, 0.1, 8).rotateX(Math.PI / 2).rotateY(0.5).translate(1.68, 0.8, 0))
    add('gilt', new THREE.SphereGeometry(0.03, 10, 8).translate(1.63, 0.8, 0))
    for (const side of [1, -1] as const) {
      add('gilt', box(0.3, 0.025, 0.012, [1.33, 0.5, side * (sectionHalfWidth(1.33, 0.5) + 0.01)], 0, 0, 0.35))
      add('gilt', new THREE.TorusGeometry(0.025, 0.006, 6, 10).translate(1.47, 0.56, side * 0.045))
    }
  }

  // ---- stern lanterns (brass cage + glass + lit core)
  if (detail) {
    for (const z of [-0.24, 0, 0.24]) {
      const x = xStern + 0.03
      const y = capRailTop(x) + (z === 0 ? 0.16 : 0.1)
      add('brass', cyl(0.007, 0.007, z === 0 ? 0.16 : 0.1, [x, y - (z === 0 ? 0.08 : 0.05), z]))
      add('brass', cyl(0.028, 0.028, 0.012, [x, y + 0.006, z]))
      add('glass', cyl(0.024, 0.02, 0.07, [x, y + 0.045, z]))
      add('lantern', new THREE.SphereGeometry(0.014, 8, 6).translate(x, y + 0.045, z))
      add('brass', new THREE.ConeGeometry(0.032, 0.03, 8).translate(x, y + 0.095, z))
    }
  }

  const out: HullParts = {}
  for (const key of Object.keys(parts) as PartKey[]) out[key] = mergeGeometries(parts[key]!)
  cache.set(lod, out)
  return out
}

export function hullTriangleCount(lod: Lod): number {
  return Object.values(buildHullParts(lod)).reduce((n, g) => n + (g ? triangleCount(g) : 0), 0)
}
