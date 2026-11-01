import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { FLEET } from '../engine'
import { CAMERA_SHOTS, battleFraming } from '../scene/CameraRig'
import { BOARD_LAYOUT, cellToWorld } from '../scene/layout'
import { LOD_THRESHOLDS, lodForDistance, stepLod } from './lod'

const HULLS = FLEET.map((s) => s.length) // 5, 4, 3, 3, 2
const VIEWPORTS = [
  [1440, 900],
  [1280, 720],
  [1024, 700],
  [375, 812],
] as const

/** Camera→hull distances for every cell of both boards from a battle camera (the fixed part of `battleFraming`). */
function overviewDistances(view: 'battle' | 'battle-far'): number[] {
  const pos = CAMERA_SHOTS[view].position
  const out: number[] = []
  for (const board of [BOARD_LAYOUT.player, BOARD_LAYOUT.enemy]) {
    for (let x = 0; x < board.size; x++) {
      for (let y = 0; y < board.size; y++) {
        const [wx, wy, wz] = cellToWorld({ x, y }, board.origin, board.cellSize)
        out.push(pos.distanceTo(new THREE.Vector3(wx, wy, wz)))
      }
    }
  }
  return out
}

describe('lodForDistance', () => {
  it('picks finer levels when close and scales thresholds with hull length', () => {
    expect(lodForDistance(3, 3)).toBe(0)
    expect(lodForDistance(10, 3)).toBe(1)
    expect(lodForDistance(90, 3)).toBe(2)
    // a 5-cell man-o-war is bigger on screen, so it keeps detail further away
    expect(lodForDistance(10, 5)).toBe(0)
    expect(lodForDistance(80, 5)).toBe(1)
  })

  it('BUG-706: every ship on both boards is lod <= 1 at the default battle cameras, in every supported viewport', () => {
    for (const view of ['battle', 'battle-far'] as const) {
      const distances = overviewDistances(view)
      // battleFraming only moves the target / fov with the viewport: the camera position (and so the hull distance)
      // is the same for 1440x900 … 375x812, so one distance set covers every viewport.
      for (const [w, h] of VIEWPORTS) {
        const framing = battleFraming(w / h, w, { target: new THREE.Vector3(), fov: 0 }, view)
        expect(framing.fov).toBeGreaterThan(0)
      }
      for (const hull of HULLS) {
        for (const d of distances) expect(lodForDistance(d, hull), `${view} hull ${hull} at ${d.toFixed(1)}`).toBeLessThanOrEqual(1)
      }
      // and the band is not so wide that the hysteresis could pull a sloop at the far board back to lod 2
      const sloopFar = LOD_THRESHOLDS.far * (2 / 3)
      expect(Math.max(...distances)).toBeLessThan(sloopFar * (1 - LOD_THRESHOLDS.hysteresis))
    }
  })

  it('keeps lod 0 for the cinematic close-ups only (the overview never pays for live ships)', () => {
    const nearest = Math.min(...overviewDistances('battle'))
    for (const hull of HULLS) expect(lodForDistance(nearest, hull)).toBe(1)
    expect(lodForDistance(4, 2)).toBe(0) // broadside / sink orbit distance
    expect(lodForDistance(8, 5)).toBe(0)
  })

  it('still has a far silhouette for the zoomed-out orbit (OrbitControls maxDistance 48 + a board)', () => {
    expect(lodForDistance(60, 2)).toBe(2)
    expect(lodForDistance(140, 5)).toBe(2)
  })
})

describe('stepLod', () => {
  const t = LOD_THRESHOLDS
  it('switches to coarser levels immediately after the dwell', () => {
    const s0 = { lod: 0 as const, since: 0 }
    expect(stepLod(s0, 90, 3, 0.5)).toBe(s0) // within dwell: no change
    expect(stepLod(s0, 90, 3, 1.5)).toEqual({ lod: 2, since: 1.5 })
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
