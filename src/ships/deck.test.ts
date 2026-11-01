import { describe, expect, it } from 'vitest'
import { FLEET } from '../engine'
import { SHIPS } from './index'
import { fitDeck, insideConvex, isCCW, isConvex, type Pt } from './kit/deck'
import { BRIGANTINE_MODEL_ANCHORS } from './brigantine/anchors'
import { FIT as BRIG_FIT } from './brigantine/hull'
import { FRIGATE_MODEL_ANCHORS } from './frigate/anchors'
import { FIT as FRIGATE_FIT } from './frigate/form'

/**
 * Stand-to-muzzle reach. Horizontally: muzzles poke up to 0.2 outboard of the planking (sloop/man-o'-war) and the
 * stand keeps 0.06–0.08 inside the bulwark. Vertically: guns under a castle (galleon stern pair under the poop,
 * man-o'-war lower gun deck) are served from the walkable deck above them.
 */
const STATION_REACH_XZ = 0.4
const STATION_REACH_Y = 0.9

const dist2 = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

describe.each(FLEET.map((s) => s.id))('%s deck anchors', (id) => {
  const a = SHIPS[id].anchors
  const deck = a.deck!

  it('exist with at least one walk polygon and no stray references', () => {
    expect(deck).toBeDefined()
    expect(deck.walk.length).toBeGreaterThan(0)
    for (const r of deck.ramps) {
      expect(deck.walk[r.from]).toBeDefined()
      expect(deck.walk[r.to]).toBeDefined()
      expect(r.from).not.toBe(r.to)
    }
  })

  it('walk polygons are convex, CCW, at least 0.2 wide and inside the hull', () => {
    for (const w of deck.walk) {
      expect(w.points.length).toBeGreaterThanOrEqual(4)
      expect(isCCW(w.points)).toBe(true)
      expect(isConvex(w.points)).toBe(true)
      const zs = w.points.map((p) => p[1])
      expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.15)
      for (const [x, z] of w.points) {
        expect(Math.abs(z)).toBeLessThan(a.hull.beam / 2)
        expect(Math.abs(x)).toBeLessThan(a.hull.length / 2 + 0.15)
      }
      expect(w.y).toBeGreaterThanOrEqual(a.deckY - 1e-6)
    }
  })

  it('spawn is inside a walk polygon at that polygon height and clear of obstacles', () => {
    const level = deck.walk.find((w) => Math.abs(w.y - deck.spawn[1]) < 1e-6 && insideConvex(w.points, [deck.spawn[0], deck.spawn[2]]))
    expect(level).toBeDefined()
    for (const o of deck.obstacles) expect(dist2(o.center, [deck.spawn[0], deck.spawn[2]])).toBeGreaterThan(o.radius)
  })

  it('has one station per cannon, standing inside a walk polygon within reach of its muzzle, facing it', () => {
    expect(deck.stations.length).toBe(a.cannons.length)
    deck.stations.forEach((s, i) => {
      const c = a.cannons[i]
      const level = deck.walk.find((w) => Math.abs(w.y - s.stand[1]) < 1e-6 && insideConvex(w.points, [s.stand[0], s.stand[2]]))
      expect(level, `${id} station ${i}`).toBeDefined()
      expect(dist2([s.stand[0], s.stand[2]], [c.muzzle[0], c.muzzle[2]]), `${id} station ${i} reach`).toBeLessThanOrEqual(STATION_REACH_XZ)
      expect(Math.abs(s.stand[1] - c.muzzle[1])).toBeLessThanOrEqual(STATION_REACH_Y)
      // yaw points from the stand toward the muzzle (same side of the ship)
      const toMuzzle = Math.sign(c.muzzle[2] - s.stand[2])
      expect(Math.sign(Math.cos(s.yaw))).toBe(toMuzzle)
    })
  })

  it('obstacles lie inside the hull; masts are obstacles', () => {
    for (const o of deck.obstacles) {
      expect(Math.abs(o.center[1]) + o.radius).toBeLessThan(a.hull.beam / 2 + 0.05)
      expect(Math.abs(o.center[0])).toBeLessThan(a.hull.length / 2 + 0.2)
      expect(o.radius).toBeGreaterThan(0.03)
    }
    for (const m of a.masts) expect(deck.obstacles.some((o) => dist2(o.center, [m.base[0], m.base[2]]) < 0.01)).toBe(true)
  })

  it('ramps sit on the shared break between the two polygons they join', () => {
    for (const r of deck.ramps) {
      const mid: Pt = [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2]
      expect(insideConvex(deck.walk[r.from].points, mid, -0.06)).toBe(true)
      expect(insideConvex(deck.walk[r.to].points, mid, -0.06)).toBe(true)
      expect(deck.walk[r.from].y).not.toBe(deck.walk[r.to].y)
    }
  })
})

describe('fit-scaled classes scale the deck data too', () => {
  it.each([
    ['brigantine', BRIGANTINE_MODEL_ANCHORS, BRIG_FIT],
    ['frigate', FRIGATE_MODEL_ANCHORS, FRIGATE_FIT],
  ] as const)('%s', (id, model, fit) => {
    const got = SHIPS[id].anchors.deck!
    const want = fitDeck(model.deck!, fit.scale, fit.dx)
    expect(got).toEqual(want)
    expect(got.spawn[1]).toBeCloseTo(model.deck!.spawn[1] * fit.scale, 6)
    expect(got.walk[0].points[0][0]).toBeCloseTo(model.deck!.walk[0].points[0][0] * fit.scale + fit.dx, 6)
  })
})
