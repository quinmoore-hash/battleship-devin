import { describe, expect, it } from 'vitest'
import { LOD_THRESHOLDS, lodForDistance, stepLod } from './lod'

describe('lodForDistance', () => {
  it('picks finer levels when close and scales thresholds with hull length', () => {
    expect(lodForDistance(3, 3)).toBe(0)
    expect(lodForDistance(10, 3)).toBe(1)
    expect(lodForDistance(20, 3)).toBe(2)
    // a 5-cell man-o-war is bigger on screen, so it keeps detail further away
    expect(lodForDistance(10, 5)).toBe(0)
    expect(lodForDistance(20, 5)).toBe(1)
  })
})

describe('stepLod', () => {
  const t = LOD_THRESHOLDS
  it('switches to coarser levels immediately after the dwell', () => {
    const s0 = { lod: 0 as const, since: 0 }
    expect(stepLod(s0, 20, 3, 0.5)).toBe(s0) // within dwell: no change
    expect(stepLod(s0, 20, 3, 1.5)).toEqual({ lod: 2, since: 1.5 })
  })
  it('needs the camera to come back past the hysteresis band before refining', () => {
    const s = { lod: 1 as const, since: 0 }
    const edge = t.mid // threshold for a 3-cell hull
    expect(stepLod(s, edge - 0.1, 3, 5)).toBe(s) // just inside the threshold: still lod 1
    expect(stepLod(s, edge * (1 - t.hysteresis) - 0.01, 3, 5)).toEqual({ lod: 0, since: 5 })
  })
  it('never switches twice within the dwell time (no popping)', () => {
    let s = stepLod({ lod: 2 as const, since: -Infinity }, 1, 3, 0)
    expect(s.lod).toBe(0)
    s = stepLod(s, 100, 3, 0.9)
    expect(s.lod).toBe(0)
    s = stepLod(s, 100, 3, 1.01)
    expect(s.lod).toBe(2)
  })
  it('respects the tier cap', () => {
    expect(stepLod({ lod: 2, since: -Infinity }, 1, 3, 0, 1)).toEqual({ lod: 1, since: 0 })
    expect(stepLod({ lod: 1, since: 0 }, 1, 3, 5, 1)).toEqual({ lod: 1, since: 0 })
  })
})
