import { describe, expect, it } from 'vitest'
import { createTimeline } from './timeline'

describe('createTimeline', () => {
  it('reaches the end exactly once regardless of frame rate', () => {
    for (const fps of [20, 60, 144]) {
      const tl = createTimeline(1.5)
      let finishes = 0
      let frames = 0
      while (!tl.done && frames < 10_000) {
        if (tl.advance(1 / fps)) finishes++
        frames++
      }
      expect(finishes).toBe(1)
      expect(tl.progress).toBe(1)
      expect(Math.abs(frames / fps - 1.5)).toBeLessThan(1 / fps + 1e-9)
    }
  })
  it('clamps huge steps so a background tab does not teleport the effect', () => {
    const tl = createTimeline(2)
    tl.advance(5)
    expect(tl.t).toBeCloseTo(0.1)
    expect(tl.done).toBe(false)
  })
  it('skip() finishes on the next advance and reports done once', () => {
    const tl = createTimeline(3)
    tl.advance(0.016)
    tl.skip()
    expect(tl.progress).toBe(1)
    expect(tl.done).toBe(false)
    expect(tl.advance(0)).toBe(true)
    expect(tl.advance(0.016)).toBe(false)
    expect(tl.done).toBe(true)
  })
  it('honours speed and restart', () => {
    const tl = createTimeline(1, { speed: 2 })
    tl.advance(0.1)
    expect(tl.t).toBeCloseTo(0.2)
    tl.restart()
    expect(tl.t).toBe(0)
    expect(tl.done).toBe(false)
  })
})
