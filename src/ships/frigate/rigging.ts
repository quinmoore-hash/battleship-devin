/**
 * Pure rig maths and geometry for the frigate: mast points, standing rigging segments, mast/yard/sail
 * geometry per LOD, and the bowsprit with its jibs. No React here so it is unit-testable.
 */
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import type { Lod } from '../types'
import { BOWSPRIT, MASTS, bulwarkHalfWidth, deckY, type MastSpec } from './form'
import { box, cyl, mergeGeometries, sailGeometry, spar } from './geometry'

export interface Segment {
  a: Vec3
  b: Vec3
  r?: number
}

/** Point `h` up a raked mast, in the ship frame. */
export function mastPoint(m: MastSpec, h: number, dz = 0): Vec3 {
  return [m.x - Math.sin(m.rake) * h, deckY(m.x) + Math.cos(m.rake) * h, dz]
}

/** Point along the bowsprit `t` units from its root. */
export function bowspritPoint(t: number, dy = 0): Vec3 {
  return [BOWSPRIT.root[0] + Math.cos(BOWSPRIT.angle) * t, BOWSPRIT.root[1] + Math.sin(BOWSPRIT.angle) * t + dy, 0]
}

export const BREAK_FRAC = 0.3

export interface MastGeoms {
  stump: THREE.BufferGeometry
  upperOak: THREE.BufferGeometry
  upperIron: THREE.BufferGeometry
  sails: { geometry: THREE.BufferGeometry; width: number; index: number }[]
  spanker?: THREE.BufferGeometry
}

const mastGeomCache = new Map<string, MastGeoms>()

export function buildMastGeoms(m: MastSpec, lod: Lod, spanker: boolean): MastGeoms {
  const key = `${m.x}:${lod}:${spanker}`
  const hit = mastGeomCache.get(key)
  if (hit) return hit
  const h = m.height
  const seg = lod === 2 ? 6 : 10
  const breakY = h * BREAK_FRAC
  const stump = spar(breakY, 0.05, 0.046, seg)
  const oak: THREE.BufferGeometry[] = []
  const iron: THREE.BufferGeometry[] = []
  // upper geometry is authored relative to the break point
  const rel = (g: THREE.BufferGeometry, y: number) => g.translate(0, y - breakY, 0)
  oak.push(rel(spar(h * 0.57 - breakY, 0.046, 0.036, seg), breakY))
  oak.push(rel(spar(h * 0.84 - h * 0.5, 0.032, 0.024, seg), h * 0.5).translate(0.045, 0, 0))
  oak.push(rel(spar(h - h * 0.8, 0.018, 0.01, seg), h * 0.8).translate(0.07, 0, 0))
  oak.push(new THREE.SphereGeometry(0.022, 8, 6).translate(0.07, h - breakY, 0))
  if (lod < 2) {
    // top platform with rail, crosstrees, caps
    oak.push(cyl(0.1, 0.1, 0.018, [0.02, h * 0.55 - breakY, 0], 12))
    oak.push(cyl(0.028, 0.028, 0.04, [0.02, h * 0.55 - breakY + 0.03, 0], 8))
    iron.push(box(0.09, 0.03, 0.06, [0.022, h * 0.57 - breakY, 0]))
    iron.push(box(0.07, 0.025, 0.05, [0.06, h * 0.84 - breakY, 0]))
    oak.push(box(0.03, 0.014, 0.2, [0.045, h * 0.82 - breakY, 0]))
    oak.push(box(0.03, 0.014, 0.2, [0.075, h * 0.82 - breakY, 0]))
    if (lod === 0) {
      for (const z of [-0.09, 0.09]) oak.push(box(0.16, 0.012, 0.012, [0.02, h * 0.55 - breakY + 0.05, z]))
      for (const [x, z] of [
        [-0.06, -0.09],
        [0.1, -0.09],
        [-0.06, 0.09],
        [0.1, 0.09],
      ]) {
        oak.push(cyl(0.005, 0.005, 0.05, [0.02 + x, h * 0.55 - breakY + 0.03, z], 5))
      }
    }
  }
  const sails: MastGeoms['sails'] = []
  m.yards.forEach(([w, y, sailH], i) => {
    const xo = i < 2 ? 0.035 + i * 0.045 : 0.07 + 0.02
    const yardR = 0.02 - i * 0.003
    oak.push(cyl(yardR, yardR, w, [xo, y - breakY, 0], seg, Math.PI / 2))
    if (lod < 2) {
      iron.push(cyl(yardR + 0.006, yardR + 0.006, 0.03, [xo, y - breakY, 0], 8, Math.PI / 2))
      oak.push(cyl(yardR * 0.6, yardR * 0.6, 0.06, [xo, y - breakY, -w / 2 - 0.02], 6, Math.PI / 2))
      oak.push(cyl(yardR * 0.6, yardR * 0.6, 0.06, [xo, y - breakY, w / 2 + 0.02], 6, Math.PI / 2))
    }
    const top = y - breakY - 0.012
    const hw = (w / 2) * 0.97
    const fw = (w / 2) * 0.88
    const g = sailGeometry({
      corners: [
        [xo + 0.01, top, -hw],
        [xo + 0.01, top, hw],
        [xo + 0.01, top - sailH, fw],
        [xo + 0.01, top - sailH, -fw],
      ],
      segments: lod === 2 ? 4 : lod === 1 ? 7 : 10,
      belly: [1, 0, 0],
    })
    sails.push({ geometry: g, width: w, index: i })
  })
  let spankerGeom: THREE.BufferGeometry | undefined
  if (spanker) {
    const gaffY = h * 0.68
    const gaffLen = 0.62
    const gaffEnd: Vec3 = [-gaffLen * Math.cos(0.6), gaffY + gaffLen * Math.sin(0.6), 0]
    const boomY = 0.2
    const boomLen = 0.78
    oak.push(cyl(0.014, 0.018, gaffLen, [gaffEnd[0] / 2, (gaffY + gaffEnd[1]) / 2 - breakY, 0], 7, 0, Math.PI / 2 + 0.6))
    oak.push(cyl(0.016, 0.02, boomLen, [-boomLen / 2, boomY - breakY, 0], 7, 0, Math.PI / 2))
    spankerGeom = sailGeometry({
      corners: [
        [-0.03, gaffY - breakY - 0.01, 0],
        [gaffEnd[0] + 0.02, gaffEnd[1] - breakY - 0.02, 0],
        [-boomLen + 0.05, boomY - breakY + 0.02, 0],
        [-0.03, boomY - breakY + 0.02, 0],
      ],
      segments: lod === 2 ? 4 : 10,
      belly: [0, 0, 1],
    })
  }
  const out: MastGeoms = { stump, upperOak: mergeGeometries(oak), upperIron: mergeGeometries(iron), sails, spanker: spankerGeom }
  mastGeomCache.set(key, out)
  return out
}

const rigCache = new Map<string, Segment[]>()

/** Standing rigging of mast `index` in the ship frame: shrouds + ratlines, topmast shrouds, stays, backstays, lifts. */
export function mastRigging(index: number, lod: Lod): Segment[] {
  const key = `${index}:${lod}`
  const hit = rigCache.get(key)
  if (hit) return hit
  const m = MASTS[index]
  const h = m.height
  const segs: Segment[] = []
  if (lod === 2) return segs
  const chanY = deckY(m.x) + 0.15
  const hounds = mastPoint(m, h * 0.52)
  const rungStep = lod === 0 ? 0.045 : 0.11
  for (const side of [1, -1] as const) {
    const hw = bulwarkHalfWidth(m.x, chanY)
    const dead: Vec3[] = []
    for (let i = 0; i < 4; i++) dead.push([m.x - 0.14 + i * 0.08, chanY + 0.03, side * (hw + 0.05)])
    const top: Vec3 = [hounds[0], hounds[1], side * 0.04]
    for (const d of dead) segs.push({ a: d, b: top, r: 0.009 })
    const at = (d: Vec3, t: number): Vec3 => [d[0] + (top[0] - d[0]) * t, d[1] + (top[1] - d[1]) * t, d[2] + (top[2] - d[2]) * t]
    for (let t = 0.1; t < 0.84; t += rungStep) {
      for (let i = 0; i < 3; i++) segs.push({ a: at(dead[i], t), b: at(dead[i + 1], t), r: 0.004 })
    }
    // topmast shrouds from the top platform to the crosstrees
    const platform = mastPoint(m, h * 0.55)
    const xtrees = mastPoint(m, h * 0.82)
    for (let i = 0; i < 3; i++) {
      const a: Vec3 = [platform[0] - 0.05 + i * 0.05, platform[1] + 0.02, side * 0.09]
      const b: Vec3 = [xtrees[0] + 0.045, xtrees[1], side * 0.02]
      segs.push({ a, b, r: 0.006 })
      if (lod === 0 && i < 2) {
        const a2: Vec3 = [platform[0] - 0.05 + (i + 1) * 0.05, platform[1] + 0.02, side * 0.09]
        for (let t = 0.15; t < 0.75; t += 0.12) {
          segs.push({ a: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], b: [a2[0] + (b[0] - a2[0]) * t, a2[1] + (b[1] - a2[1]) * t, a2[2] + (b[2] - a2[2]) * t], r: 0.003 })
        }
      }
    }
    // backstays
    const railAft: Vec3 = [m.x - 0.42, deckY(m.x - 0.42) + 0.2, side * (bulwarkHalfWidth(m.x - 0.42, deckY(m.x - 0.42) + 0.2) + 0.02)]
    segs.push({ a: railAft, b: mastPoint(m, h * 0.84, side * 0.02), r: 0.007 })
    segs.push({ a: [railAft[0] - 0.06, railAft[1], railAft[2]], b: mastPoint(m, h * 0.99, side * 0.012), r: 0.006 })
    // lifts: yard ends up to the mast
    for (const [w, y] of m.yards) {
      const xo = 0.05
      segs.push({ a: [m.x - Math.sin(m.rake) * y + xo, deckY(m.x) + Math.cos(m.rake) * y, side * (w / 2)], b: mastPoint(m, Math.min(h * 0.99, y + 0.2), side * 0.015), r: 0.004 })
    }
    // braces of the lowest yard to the rail aft
    const [w0, y0] = m.yards[0]
    segs.push({ a: [m.x - Math.sin(m.rake) * y0 + 0.05, deckY(m.x) + Math.cos(m.rake) * y0, side * (w0 / 2)], b: [m.x - 0.55, deckY(m.x - 0.55) + 0.22, side * (bulwarkHalfWidth(m.x - 0.55, 0.6) - 0.02)], r: 0.004 })
  }
  // stays forward
  if (index === 0) {
    segs.push({ a: mastPoint(m, h * 0.55), b: bowspritPoint(0.5), r: 0.011 })
    segs.push({ a: mastPoint(m, h * 0.84), b: bowspritPoint(0.95), r: 0.008 })
    segs.push({ a: mastPoint(m, h * 0.98), b: bowspritPoint(1.3), r: 0.006 })
  } else {
    const fwd = MASTS[index - 1]
    segs.push({ a: mastPoint(m, h * 0.55), b: [fwd.x - 0.12, deckY(fwd.x) + 0.3, 0], r: 0.011 })
    segs.push({ a: mastPoint(m, h * 0.84), b: mastPoint(fwd, fwd.height * 0.56), r: 0.008 })
    segs.push({ a: mastPoint(m, h * 0.98), b: mastPoint(fwd, fwd.height * 0.84), r: 0.006 })
  }
  rigCache.set(key, segs)
  return segs
}

export interface BowspritGeoms {
  oak: THREE.BufferGeometry
  black: THREE.BufferGeometry
  jibs: { geometry: THREE.BufferGeometry; index: number }[]
  ropes: Segment[]
}

const bowspritCache = new Map<Lod, BowspritGeoms>()

export function buildBowsprit(lod: Lod): BowspritGeoms {
  const hit = bowspritCache.get(lod)
  if (hit) return hit
  const fore = MASTS[0]
  const oak: THREE.BufferGeometry[] = []
  const black: THREE.BufferGeometry[] = []
  const ropes: Segment[] = []
  const rot = -(Math.PI / 2 - BOWSPRIT.angle)
  const mid = (t0: number, t1: number): Vec3 => {
    const a = bowspritPoint(t0)
    const b = bowspritPoint(t1)
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0]
  }
  oak.push(cyl(0.028, 0.038, BOWSPRIT.length, mid(0, BOWSPRIT.length), 8, 0, rot))
  oak.push(cyl(0.011, 0.02, BOWSPRIT.jibboom + 0.25, mid(BOWSPRIT.length - 0.25, BOWSPRIT.length + BOWSPRIT.jibboom), 7, 0, rot))
  const cap = bowspritPoint(BOWSPRIT.length)
  black.push(box(0.05, 0.08, 0.06, cap, 0, 0, BOWSPRIT.angle))
  black.push(cyl(0.008, 0.012, 0.2, [cap[0], cap[1] - 0.1, 0], 6))
  if (lod < 2) {
    ropes.push({ a: [cap[0], cap[1] - 0.2, 0], b: [1.47, 0.03, 0], r: 0.01 })
    for (const side of [1, -1] as const) {
      ropes.push({ a: cap, b: [1.26, 0.48, side * 0.2], r: 0.007 })
      ropes.push({ a: bowspritPoint(BOWSPRIT.length + BOWSPRIT.jibboom - 0.05), b: [cap[0], cap[1] - 0.2, 0], r: 0.005 })
    }
    // gammoning at the stem
    for (let i = 0; i < 4; i++) {
      const t = 0.12 + i * 0.03
      const p = bowspritPoint(t)
      ropes.push({ a: [p[0], p[1] + 0.045, 0], b: [p[0] + 0.02, p[1] - 0.3, 0], r: 0.006 })
    }
  }
  const stays: [Vec3, Vec3][] = [
    [bowspritPoint(0.5), mastPoint(fore, fore.height * 0.55)],
    [bowspritPoint(0.95), mastPoint(fore, fore.height * 0.84)],
    [bowspritPoint(1.3), mastPoint(fore, fore.height * 0.98)],
  ]
  const jibs: BowspritGeoms['jibs'] = []
  stays.forEach(([T, H], i) => {
    const lerp = (t: number): Vec3 => [T[0] + (H[0] - T[0]) * t, T[1] + (H[1] - T[1]) * t, 0.012 * i]
    const head = lerp(0.78 - i * 0.04)
    const tack = lerp(0.08)
    const clew: Vec3 = [T[0] + (H[0] - T[0]) * 0.58 - 0.04, T[1] + (H[1] - T[1]) * 0.2, 0.012 * i]
    jibs.push({ geometry: sailGeometry({ corners: [head, clew, tack], segments: lod === 2 ? 4 : 9, belly: [0, 0, 1], furlTo: 'luff' }), index: i })
  })
  const out = { oak: mergeGeometries(oak), black: mergeGeometries(black), jibs, ropes }
  bowspritCache.set(lod, out)
  return out
}

/** Per-sail set: upper sails come in first as `sails` falls. */
export function sailSet(sails: number, index: number, count: number): number {
  const stagger = (index / count) * 0.75
  return Math.min(1, Math.max(0, (sails - stagger) / (1 - stagger)))
}

