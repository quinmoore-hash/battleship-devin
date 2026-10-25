import { describe, expect, it } from 'vitest'
import { emberAt, emberSeeds } from './embers'
import { FireLightBudget, lightCountFor, planFireLights, type FireSource } from './fireBudget'
import { smokePuffAt, smokeSeeds } from './smoke'
import { makeSplinters, splinterAt, splinterDuration } from './splinters'

describe('splinters', () => {
  const opts = { seed: 3, count: 20, normal: [0, 0, 1] as [number, number, number] }
  it('is deterministic and mostly flies along the hit normal', () => {
    const a = makeSplinters(opts)
    expect(a).toEqual(makeSplinters(opts))
    expect(a).not.toEqual(makeSplinters({ ...opts, seed: 4 }))
    expect(a.filter((s) => s.vz > 0).length).toBeGreaterThan(a.length * 0.8)
  })
  it('arcs under gravity, lands on the water, bobs, then sinks and disappears', () => {
    const s = { ...makeSplinters(opts)[0], delay: 0 }
    const waterY = -0.6
    const fly = splinterAt(s, 0.1, waterY)!
    expect(fly.landed).toBe(false)
    expect(fly.y).toBeGreaterThan(waterY)
    const end = splinterDuration([s], waterY)
    const landed = splinterAt(s, end - s.float * 0.3, waterY)!
    expect(landed.landed).toBe(true)
    expect(Math.abs(landed.y - waterY)).toBeLessThan(0.15)
    expect(landed.alpha).toBeLessThan(1)
    expect(splinterAt(s, end + 0.01, waterY)).toBeNull()
    expect(splinterAt(s, -0.01, waterY)).toBeNull()
  })
  it('big planks come first and are longer', () => {
    const a = makeSplinters(opts)
    expect(a[0].sx).toBeGreaterThan(a[a.length - 1].sx)
  })
})

describe('embers', () => {
  const o = { count: 8, seed: 1, life: 1.5, height: 1.2, wander: 0.1, wind: [0.5, 0] as [number, number] }
  const seeds = emberSeeds(o)
  it('loop, rise and drift downwind', () => {
    const t0 = -seeds[0] * o.life // age 0 for ember 0
    const a = emberAt(0, t0 + 0.2, seeds, o)
    const b = emberAt(0, t0 + 1.0, seeds, o)
    expect(a.age).toBeLessThan(b.age)
    expect(b.x).toBeGreaterThan(a.x - 0.1)
    expect(b.y).toBeGreaterThan(a.y)
    expect(emberAt(0, 0.2, seeds, o).age).toBeCloseTo(emberAt(0, 0.2 + o.life, seeds, o).age)
    const late = emberAt(1, 0.95 * o.life - seeds[4] * o.life, seeds, o)
    expect(late.glow).toBeLessThan(0.35)
  })
  it('seeds are deterministic', () => {
    expect(Array.from(emberSeeds(o))).toEqual(Array.from(emberSeeds(o)))
  })
})

describe('smoke plume', () => {
  const o = { count: 10, seed: 5, life: 4, height: 3, wind: [0.4, 0.1] as [number, number], radius: [0.15, 0.6] as [number, number] }
  const seeds = smokeSeeds(o)
  it('puffs grow, lean downwind and thin with height', () => {
    const t0 = -seeds[0] * o.life // age 0 for puff 0
    const young = smokePuffAt(0, t0 + 0.3, seeds, o)
    const old = smokePuffAt(0, t0 + 3.6, seeds, o)
    expect(old.radius).toBeGreaterThan(young.radius)
    expect(old.y).toBeGreaterThan(young.y)
    expect(old.x).toBeGreaterThan(young.x)
    expect(old.alpha).toBeLessThan(young.alpha)
    expect(smokePuffAt(0, t0 + o.life - 1e-3, seeds, o).alpha).toBeLessThan(0.01)
  })
  it('staggers puffs along the column', () => {
    const ys = Array.from({ length: o.count }, (_, i) => smokePuffAt(i, 0, seeds, o).y.toFixed(3))
    expect(new Set(ys).size).toBe(o.count)
  })
})

describe('fire light budget', () => {
  const fire = (id: string, x: number, z: number, intensity = 1): FireSource => ({ id, position: [x, 0.5, z], intensity })
  it('allows at most one light per three fires, capped', () => {
    expect(lightCountFor(0)).toBe(0)
    expect(lightCountFor(1)).toBe(1)
    expect(lightCountFor(3)).toBe(1)
    expect(lightCountFor(4)).toBe(2)
    expect(lightCountFor(30)).toBe(4)
  })
  it('clusters nearby fires under one light placed between them', () => {
    const lights = planFireLights([fire('a', 0, 0), fire('b', 1, 0), fire('c', 0.5, 0.5), fire('d', 9, 9)])
    expect(lights).toHaveLength(2)
    const big = lights.find((l) => l.fires.length === 3)!
    expect(big.position[0]).toBeCloseTo(0.5)
    expect(big.intensity).toBeCloseTo(3)
    expect(lights.find((l) => l.fires.includes('d'))!.fires).toEqual(['d'])
  })
  it('never exceeds the budget however many fires burn', () => {
    const many = Array.from({ length: 25 }, (_, i) => fire(`f${i}`, i % 5, Math.floor(i / 5) * 3))
    const lights = planFireLights(many)
    expect(lights.length).toBeLessThanOrEqual(4)
    expect(lights.flatMap((l) => l.fires).sort()).toEqual(many.map((f) => f.id).sort())
  })
  it('ignores extinguished fires and is stable across calls', () => {
    const a = planFireLights([fire('a', 0, 0, 0), fire('b', 2, 0)])
    expect(a).toHaveLength(1)
    expect(a[0].fires).toEqual(['b'])
    expect(planFireLights([fire('a', 0, 0), fire('b', 5, 0)])).toEqual(planFireLights([fire('b', 5, 0), fire('a', 0, 0)]))
  })
  it('registry: oldest fire hosts the lights, lights recompute on change', () => {
    const b = new FireLightBudget()
    let notified = 0
    b.subscribe(() => notified++)
    const offA = b.register('a', [0, 0, 0], 1)
    b.register('b', [4, 0, 0], 1)
    expect(b.hostId).toBe('a')
    expect(b.lights()).toHaveLength(1)
    const v = b.snapshot()
    b.update('b', [4, 0, 0], 1)
    expect(b.snapshot()).toBe(v)
    offA()
    expect(b.hostId).toBe('b')
    expect(b.lights()[0].fires).toEqual(['b'])
    expect(notified).toBe(3)
  })
})
