import { describe, expect, it } from 'vitest'
import type { CellDamage } from '../../ships/types'
import { cellX, sectionSurfaceY, sinkBias, sinkPose, submersion, wreckDepth, type HullDims } from './pose'
import { DEFAULT_SLOW_MO, sinkProgressAt, sinkRateAt, sinkTimeAt, sinkTimeline } from './timeline'

const hull: HullDims = { length: 4, beam: 1.1, height: 2.9, draft: 0.4 }
const steps = Array.from({ length: 101 }, (_, i) => i / 100)

describe('sinkBias', () => {
  it('is deterministic and bow-first when the bow is hit', () => {
    const d: CellDamage[] = ['burning', 'hit', 'intact', 'intact']
    expect(sinkBias(1, d)).toEqual(sinkBias(1, d))
    expect(sinkBias(1, d).fore).toBeGreaterThan(0.3)
    expect(sinkBias(1, ['intact', 'intact', 'hit', 'burning']).fore).toBeLessThan(-0.3)
  })
  it('lets the killing blow dominate when every section is hit', () => {
    const all: CellDamage[] = ['hit', 'hit', 'hit', 'hit']
    expect(sinkBias(3, all, 0).fore).toBeGreaterThan(0.2)
    expect(sinkBias(3, all, 3).fore).toBeLessThan(-0.2)
  })
  it('falls back to a seeded direction when damage is symmetric', () => {
    const sym: CellDamage[] = ['hit', 'intact', 'intact', 'hit']
    const fores = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => sinkBias(s, sym).fore)
    for (const f of fores) expect(Math.abs(f)).toBeGreaterThanOrEqual(0.3)
    expect(new Set(fores.map(Math.sign)).size).toBe(2)
  })
})

describe('sinkPose', () => {
  const damage: CellDamage[] = ['burning', 'hit', 'intact', 'hit']
  it('is identity at 0 and a wreck below the surface at 1', () => {
    expect(sinkPose(0, { seed: 7, hull, damage })).toEqual({ depth: 0, roll: 0, pitch: 0, yaw: 0 })
    const end = sinkPose(1, { seed: 7, hull, damage })
    expect(end.depth).toBeCloseTo(wreckDepth(hull), 5)
    expect(end.depth).toBeGreaterThan(hull.draft + 1)
  })
  it('is deterministic for a seed and differs across seeds', () => {
    expect(sinkPose(0.5, { seed: 9, hull, damage })).toEqual(sinkPose(0.5, { seed: 9, hull, damage }))
    expect(sinkPose(0.5, { seed: 9, hull, damage })).not.toEqual(sinkPose(0.5, { seed: 10, hull, damage }))
  })
  it('has monotonic depth and bounded angles for many seeds', () => {
    for (let seed = 0; seed < 25; seed++) {
      let last = -1
      for (const p of steps) {
        const pose = sinkPose(p, { seed, hull, damage })
        expect(pose.depth).toBeGreaterThanOrEqual(last - 1e-9)
        last = pose.depth
        expect(Math.abs(pose.roll)).toBeLessThan(1.0)
        expect(Math.abs(pose.pitch)).toBeLessThan(0.6)
        expect(Math.abs(pose.yaw)).toBeLessThan(0.3)
        expect(Number.isFinite(pose.depth + pose.roll + pose.pitch + pose.yaw)).toBe(true)
      }
    }
  })
  it('dips the damaged end first', () => {
    const bow = sinkPose(0.55, { seed: 2, hull, damage: ['burning', 'burning', 'intact', 'intact'] })
    const stern = sinkPose(0.55, { seed: 2, hull, damage: ['intact', 'intact', 'burning', 'burning'] })
    expect(bow.pitch).toBeLessThan(-0.15)
    expect(stern.pitch).toBeGreaterThan(0.15)
  })
  it('hangs: depth barely changes between the list and the slide', () => {
    const a = sinkPose(0.3, { seed: 4, hull, damage })
    const b = sinkPose(0.44, { seed: 4, hull, damage })
    expect(b.depth - a.depth).toBeLessThan(0.05)
    expect(sinkPose(0.8, { seed: 4, hull, damage }).depth).toBeGreaterThan(b.depth + 1)
  })
  it('clamps progress outside [0, 1]', () => {
    expect(sinkPose(-1, { seed: 1, hull, damage })).toEqual(sinkPose(0, { seed: 1, hull, damage }))
    expect(sinkPose(2, { seed: 1, hull, damage })).toEqual(sinkPose(1, { seed: 1, hull, damage }))
  })
})

describe('sectionSurfaceY / submersion', () => {
  it('puts a bow-down bow section lower than the stern', () => {
    const pose = { depth: 0.2, roll: 0, pitch: -0.3, yaw: 0 }
    expect(sectionSurfaceY(pose, cellX(0, 4), 0.4)).toBeLessThan(sectionSurfaceY(pose, cellX(3, 4), 0.4))
  })
  it('submersion ramps from 0 above to 1 below', () => {
    expect(submersion(1)).toBe(0)
    expect(submersion(-1)).toBe(1)
    expect(submersion(0)).toBeCloseTo(0.5)
  })
})

describe('sink timeline', () => {
  const tl = sinkTimeline('full')
  it('covers the whole sequence in exactly `duration` seconds', () => {
    expect(sinkProgressAt(0, tl)).toBe(0)
    expect(sinkProgressAt(tl.duration, tl)).toBeCloseTo(1)
    expect(sinkProgressAt(tl.duration + 5, tl)).toBe(1)
  })
  it('is monotonic and slower inside the slow-mo window', () => {
    let last = 0
    for (let t = 0; t <= tl.duration; t += 0.01) {
      const p = sinkProgressAt(t, tl)
      expect(p).toBeGreaterThanOrEqual(last)
      last = p
    }
    const mid = (DEFAULT_SLOW_MO.from + DEFAULT_SLOW_MO.to) / 2
    expect(sinkRateAt(mid, tl)).toBeCloseTo(sinkRateAt(0.1, tl) * DEFAULT_SLOW_MO.scale)
  })
  it('sinkTimeAt inverts sinkProgressAt', () => {
    for (const p of [0, 0.2, 0.38, 0.5, 0.7, 0.9, 1]) expect(sinkProgressAt(sinkTimeAt(p, tl), tl)).toBeCloseTo(p, 6)
  })
  it('fast level is linear with no slow-mo', () => {
    const fast = sinkTimeline('fast')
    expect(fast.slowMo).toBeUndefined()
    expect(sinkProgressAt(1, fast)).toBeCloseTo(0.5)
  })
})
