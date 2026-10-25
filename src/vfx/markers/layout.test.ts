import { describe, expect, it } from 'vitest'
import type { ShotResult } from '../../engine'
import { layoutGridBuoys, layoutMarkers, popScale, rippleAt, wreckScatter } from './layout'

const origin: [number, number, number] = [-5, 0.2, -13]

describe('layoutMarkers', () => {
  const shots: ShotResult[] = [
    { coord: { x: 0, y: 0 }, outcome: 'miss' },
    { coord: { x: 3, y: 4 }, outcome: 'hit', shipId: 'sloop' },
    { coord: { x: 4, y: 4 }, outcome: 'sunk', shipId: 'sloop' },
    { coord: { x: 7, y: 1 }, outcome: 'hit', shipId: 'galleon' },
  ]
  it('places one marker per shot at the cell centre', () => {
    const m = layoutMarkers(shots, origin)
    expect(m).toHaveLength(4)
    expect(m[0].position).toEqual([-4.5, 0.2, -12.5])
    expect(m[3].position).toEqual([2.5, 0.2, -11.5])
  })
  it('upgrades earlier hits on a sunk ship to debris', () => {
    const kinds = layoutMarkers(shots, origin).map((m) => m.kind)
    expect(kinds).toEqual(['miss', 'sunk', 'sunk', 'hit'])
  })
  it('flags only the last shot as newest and is deterministic', () => {
    const m = layoutMarkers(shots, origin)
    expect(m.filter((x) => x.newest).map((x) => x.key)).toEqual(['7,1'])
    expect(m).toEqual(layoutMarkers(shots, origin))
    expect(m[1].seed).not.toBe(m[2].seed)
  })
  it('dedupes a repeated coordinate', () => {
    expect(layoutMarkers([shots[0], shots[0]], origin)).toHaveLength(1)
  })
})

describe('wreckScatter', () => {
  it('stays inside the cell and is deterministic', () => {
    const a = wreckScatter(42, 8)
    expect(a).toEqual(wreckScatter(42, 8))
    expect(a).not.toEqual(wreckScatter(43, 8))
    for (const p of a) {
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(0.32 + 1e-9)
      expect(p.char).toBeGreaterThanOrEqual(0)
      expect(p.char).toBeLessThanOrEqual(1)
    }
  })
})

describe('popScale / rippleAt', () => {
  it('pops from 0, overshoots and settles at 1', () => {
    expect(popScale(0)).toBe(0)
    expect(popScale(0.3)).toBeGreaterThan(1)
    expect(popScale(1)).toBe(1)
  })
  it('ripple grows and fades out', () => {
    const [r1, o1] = rippleAt(0.2, 1)
    const [r2, o2] = rippleAt(0.9, 1)
    expect(r2).toBeGreaterThan(r1)
    expect(o2).toBeLessThan(o1)
    expect(rippleAt(2, 1)).toEqual([0, 0])
  })
})

describe('layoutGridBuoys', () => {
  const g = layoutGridBuoys(origin, 10, 1)
  it('puts a buoy on each corner', () => {
    expect(g.corners).toEqual([
      [-5, 0.2, -13],
      [5, 0.2, -13],
      [5, 0.2, -3],
      [-5, 0.2, -3],
    ])
  })
  it('has a float at every other intersection', () => {
    expect(g.floats).toHaveLength(11 * 11 - 4)
  })
  it('has 22 ropes, 4 of them outer, that sag between floats', () => {
    expect(g.ropes).toHaveLength(22)
    expect(g.ropes.filter((r) => r.outer)).toHaveLength(4)
    const r = g.ropes[0]
    expect(r.points[0]).toEqual([-5, 0.2, -13])
    expect(r.points[r.points.length - 1]).toEqual([-5, 0.2, -3])
    expect(Math.min(...r.points.map((p) => p[1]))).toBeLessThan(0.2)
  })
})
