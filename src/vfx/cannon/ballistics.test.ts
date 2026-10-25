import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../../scene/layout'
import { aimDirection, broadsideDuration, createImpactLatch, scheduleBroadside, solveArc } from './ballistics'

const from: Vec3 = [-1, 0.6, 4]
const to: Vec3 = [2, 0.3, -8]

describe('solveArc', () => {
  const arc = solveArc(from, to)
  it('starts at the muzzle and lands exactly on the target', () => {
    expect(arc.pointAt(0)).toEqual(from)
    arc.pointAt(1).forEach((c, i) => expect(c).toBeCloseTo(to[i], 9))
  })
  it('peaks above the chord midway and never dips below the endpoints before landing', () => {
    const mid = arc.pointAt(0.5)
    expect(mid[1]).toBeCloseTo((from[1] + to[1]) / 2 + arc.apex, 9)
    for (let k = 0; k <= 1; k += 0.05) expect(arc.pointAt(k)[1]).toBeGreaterThanOrEqual(Math.min(from[1], to[1]) - 1e-9)
  })
  it('flight time follows distance / speed with a floor', () => {
    expect(arc.duration).toBeCloseTo(arc.distance / 15)
    expect(solveArc(from, [from[0] + 0.1, from[1], from[2]]).duration).toBe(0.35)
    expect(solveArc(from, to, { speed: 30 }).duration).toBeCloseTo(arc.duration / 2)
  })
  it('velocity is upward at launch, downward at impact, and matches finite differences', () => {
    expect(arc.velocityAt(0)[1]).toBeGreaterThan(0)
    expect(arc.velocityAt(1)[1]).toBeLessThan(0)
    const h = 1e-4
    const a = arc.pointAt(0.3 - h)
    const b = arc.pointAt(0.3 + h)
    const v = arc.velocityAt(0.3)
    for (let i = 0; i < 3; i++) expect(v[i]).toBeCloseTo((b[i] - a[i]) / (2 * h) / arc.duration, 3)
  })
})

describe('aimDirection', () => {
  it('points along the horizontal chord with a small lift', () => {
    const d = aimDirection([0, 0, 0], [0, 5, -10])
    expect(d[0]).toBeCloseTo(0)
    expect(d[2]).toBeCloseTo(-1)
    expect(d[1]).toBeCloseTo(0.08)
  })
})

describe('createImpactLatch', () => {
  it('fires the callback exactly once', () => {
    let calls = 0
    const latch = createImpactLatch(() => calls++)
    expect(latch.fire(1)).toBe(true)
    expect(latch.fire(2)).toBe(false)
    latch.fire(3)
    expect(calls).toBe(1)
    expect(latch.fired).toBe(true)
  })
})

describe('scheduleBroadside', () => {
  const shots = [0, 1, 2].map((i) => ({ from: [i - 1, 0.6, 4] as Vec3, to: [i, 0.3, -8] as Vec3 }))
  it('spreads the guns over the stagger, first at 0 and last at stagger', () => {
    const s = scheduleBroadside(shots, 0.6)
    expect(s.map((x) => x.delay)).toEqual([0, 0.3, 0.6])
    expect(scheduleBroadside(shots.slice(0, 1), 0.6)[0].delay).toBe(0)
  })
  it('broadsideDuration ends when the last ball lands', () => {
    const s = scheduleBroadside(shots, 0.6)
    expect(broadsideDuration(s)).toBeCloseTo(0.6 + s[2].arc.duration)
  })
})
