import { describe, expect, it } from 'vitest'
import { bubbleIntensity, bubbleState, type BubbleOptions } from './bubbles'
import { debrisPieces, debrisState, flotsamLayout, footprintCenters, type DebrisLaunch } from './debris'

const centers = footprintCenters([0, 0.2, 0], 0, 3)
const launch: DebrisLaunch = { position: [0, 0.2, 0], rotationY: 0, hull: { length: 3, beam: 0.9, height: 2.4, draft: 0.35 }, deckY: 0.4, side: 1 }

describe('footprintCenters', () => {
  it('walks bow to stern along +x for a horizontal ship and +z for a vertical one', () => {
    expect(centers.map((c) => c[0])).toEqual([1, 0, -1])
    const vertical = footprintCenters([0, 0.2, 0], -Math.PI / 2, 3)
    expect(vertical.map((c) => Math.round(c[2]))).toEqual([1, 0, -1])
    expect(vertical.every((c) => Math.abs(c[0]) < 1e-9)).toBe(true)
  })
})

describe('flotsamLayout', () => {
  it('is deterministic, stays near its cells and has at most one hat and one wheel', () => {
    const a = flotsamLayout(centers, 5)
    expect(a).toEqual(flotsamLayout(centers, 5))
    expect(a).not.toEqual(flotsamLayout(centers, 6))
    expect(a.length).toBeGreaterThanOrEqual(centers.length * 2)
    for (const p of a) {
      expect(Math.abs(p.x) <= 1.5 + 0.4 && Math.abs(p.z) <= 0.4).toBe(true)
    }
    expect(a.filter((p) => p.kind === 'hat').length).toBeLessThanOrEqual(1)
    expect(a.filter((p) => p.kind === 'wheel').length).toBeLessThanOrEqual(1)
  })
})

describe('debrisState', () => {
  const pieces = debrisPieces(centers, 11, launch)
  it('keeps the flotsam layout so Debris hands over to Flotsam seamlessly', () => {
    const layout = flotsamLayout(centers, 11)
    pieces.forEach((p, i) => {
      expect([p.x, p.z, p.rotY, p.kind]).toEqual([layout[i].x, layout[i].z, layout[i].rotY, layout[i].kind])
    })
  })
  it('launches off the chosen side at deck height', () => {
    for (const p of pieces) {
      expect(p.from[2]).toBeCloseTo(0.45)
      expect(p.from[1]).toBeCloseTo(0.6)
      expect(p.launchAt).toBeGreaterThanOrEqual(0.28)
      expect(p.launchAt + p.flight).toBeLessThanOrEqual(0.85)
    }
  })
  it('is hidden before launch, arcs above the chord in flight, and floats at the water level after', () => {
    const p = pieces[0]
    expect(debrisState(p, p.launchAt - 0.01, 0, 0).visible).toBe(false)
    const mid = debrisState(p, p.launchAt + p.flight / 2, 0, 0)
    expect(mid.visible).toBe(true)
    expect(mid.y).toBeGreaterThan(Math.max(p.from[1], 0) * 0.5)
    const landed = debrisState(p, 1, 2, 0.07)
    expect(landed.flight).toBe(1)
    expect(landed.x).toBeCloseTo(p.x)
    expect(Math.abs(landed.y - 0.07)).toBeLessThan(0.03)
    expect(landed.scale).toBe(p.scale)
  })
  it('reduced motion places pieces straight on the water', () => {
    const p = pieces[1]
    expect(debrisState(p, p.launchAt + 0.001, 0, 0, true).flight).toBe(1)
  })
})

describe('bubbles', () => {
  const o: BubbleOptions = { count: 20, seed: 3, length: 3, beam: 0.9, period: 2, depth: 0.8 }
  it('is deterministic and rises from below the surface to just above it before popping', () => {
    expect(bubbleState(4, 1.23, o)).toEqual(bubbleState(4, 1.23, o))
    let maxY = -Infinity
    let minY = Infinity
    for (let t = 0; t < 4; t += 0.02) {
      const s = bubbleState(4, t, o)
      maxY = Math.max(maxY, s.y)
      minY = Math.min(minY, s.y)
      expect(Math.abs(s.x)).toBeLessThan(1.5)
      expect(Math.abs(s.z)).toBeLessThan(0.5)
      expect(s.scale).toBeGreaterThanOrEqual(0)
    }
    expect(minY).toBeLessThan(-0.6)
    expect(maxY).toBeGreaterThan(0.05)
  })
  it('pops with a ring near the end of its life', () => {
    const states = Array.from({ length: 200 }, (_, i) => bubbleState(0, (i / 200) * 2.6, o))
    const popped = states.find((s) => s.age > 0.98)!
    expect(popped.scale).toBeCloseTo(0, 3)
    expect(Math.max(...states.map((s) => s.ring))).toBeGreaterThan(0.9)
  })
  it('intensity is 0 before the list, peaks while sliding, and is 0 when settled', () => {
    expect(bubbleIntensity(0)).toBe(0)
    expect(bubbleIntensity(0.2)).toBeGreaterThan(0)
    expect(bubbleIntensity(0.7)).toBeCloseTo(1)
    expect(bubbleIntensity(1)).toBe(0)
  })
})
