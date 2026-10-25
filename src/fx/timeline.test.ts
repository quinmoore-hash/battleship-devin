import { describe, expect, it } from 'vitest'
import {
  OTTER_MOODS,
  SINK_DEPTH,
  SINK_DURATION,
  SINK_TILT,
  bobPose,
  damp,
  easeOutBack,
  easeOutCubic,
  markerPhase,
  otterPose,
  projectileApex,
  projectilePoint,
  settledMarkerPhase,
  sinkPose,
  smoothPose,
} from './timeline'

describe('easing', () => {
  it('stays within bounds at the ends', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(2)).toBe(1)
    expect(easeOutBack(0)).toBeCloseTo(0)
    expect(easeOutBack(1)).toBeCloseTo(1)
    expect(easeOutBack(0.7)).toBeGreaterThan(1) // overshoot
  })
  it('damp converges toward the target', () => {
    let v = 0
    for (let i = 0; i < 60; i++) v = damp(v, 1, 9, 1 / 60)
    expect(v).toBeGreaterThan(0.99)
  })
})

describe('bobPose', () => {
  it('is small and phase dependent', () => {
    const a = bobPose(1, 0)
    const b = bobPose(1, 2)
    expect(Math.abs(a.y)).toBeLessThan(0.05)
    expect(Math.abs(a.roll)).toBeLessThan(0.05)
    expect(a.y).not.toBe(b.y)
    expect(bobPose(1, 0, 0).y).toBe(0)
  })
})

describe('sinkPose', () => {
  it('starts afloat and ends as a tilted wreck', () => {
    const start = sinkPose(0)
    expect(start.progress).toBe(0)
    expect(start.depth).toBeCloseTo(0)
    expect(start.tilt).toBeCloseTo(0)
    expect(start.bubbling).toBe(true)
    const end = sinkPose(SINK_DURATION + 5)
    expect(end.progress).toBe(1)
    expect(end.depth).toBeCloseTo(SINK_DEPTH)
    expect(end.tilt).toBeCloseTo(SINK_TILT)
    expect(end.bubbling).toBe(false)
  })
  it('descends monotonically', () => {
    let prev = 0
    for (let t = 0; t <= SINK_DURATION; t += 0.1) {
      const d = sinkPose(t).depth
      expect(d).toBeLessThanOrEqual(prev + 1e-9)
      prev = d
    }
  })
})

describe('markerPhase', () => {
  it('starts with a fresh ring and no settled marker', () => {
    for (const outcome of ['miss', 'hit', 'sunk'] as const) {
      const p = markerPhase(outcome, 0)
      expect(p.ring).toBe(0)
      expect(p.ringOpacity).toBeGreaterThan(0.8)
      expect(p.settled).toBeCloseTo(0)
      expect(p.done).toBe(false)
    }
  })
  it('flashes only for hits', () => {
    expect(markerPhase('miss', 0).flash).toBe(0)
    expect(markerPhase('hit', 0).flash).toBe(1)
    expect(markerPhase('sunk', 0.1).flash).toBeGreaterThan(0)
  })
  it('finishes fully settled', () => {
    for (const outcome of ['miss', 'hit', 'sunk'] as const) {
      const p = settledMarkerPhase(outcome)
      expect(p.done).toBe(true)
      expect(p.settled).toBeCloseTo(1)
      expect(p.ringOpacity).toBe(0)
      expect(p.flash).toBe(0)
    }
  })
  it('sunk shockwave is bigger than a miss splash', () => {
    expect(markerPhase('sunk', 0.5).ringScale).toBeGreaterThan(markerPhase('miss', 0.5).ringScale)
  })
})

describe('projectile', () => {
  const from: [number, number, number] = [0, 0.5, -14]
  const to: [number, number, number] = [3, 0, 2]
  it('hits both end points exactly', () => {
    expect(projectilePoint(from, to, 0)).toEqual(from)
    expect(projectilePoint(from, to, 1)).toEqual(to)
    expect(projectilePoint(from, to, 1.5)).toEqual(to)
  })
  it('peaks at the apex half way', () => {
    const mid = projectilePoint(from, to, 0.5, 3)
    expect(mid[1]).toBeCloseTo(0.25 + 3)
    expect(mid[0]).toBeCloseTo(1.5)
    expect(mid[2]).toBeCloseTo(-6)
  })
  it('apex grows with distance', () => {
    expect(projectileApex([0, 0, 0], [0, 0, 1])).toBeLessThan(projectileApex([0, 0, 0], [0, 0, 20]))
  })
})

describe('otterPose', () => {
  it('idle types with the laptop open and spins nowhere', () => {
    const p = otterPose('idle', 1)
    expect(p.typing).toBe(1)
    expect(p.lidOpen).toBe(1)
    expect(p.spinSpeed).toBe(0)
    expect(p.confetti).toBe(false)
  })
  it('each mood has its signature', () => {
    expect(otterPose('cheer', 0.3).bodyY).toBeGreaterThan(0)
    expect(otterPose('cheer', 0.3).armR).toBeGreaterThan(0.5)
    expect(otterPose('grumble', 0.3).earFlat).toBe(1)
    expect(otterPose('grumble', 0.3).smile).toBeLessThan(0)
    expect(otterPose('taunt', 0.3).lean).toBeLessThan(0)
    expect(otterPose('taunt', 0.3).armR).toBeGreaterThan(0.5)
    expect(otterPose('victory', 0.3).spinSpeed).toBeGreaterThan(0)
    expect(otterPose('victory', 0.3).confetti).toBe(true)
    expect(otterPose('defeat', 0.3).lidOpen).toBe(0)
    expect(otterPose('defeat', 0.3).lean).toBeGreaterThan(0)
  })
  it('all moods produce finite values', () => {
    for (const mood of OTTER_MOODS) {
      for (const t of [0, 0.5, 2.3, 10]) {
        const p = otterPose(mood, t)
        for (const v of Object.values(p)) {
          if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true)
        }
      }
    }
  })
  it('smoothPose moves toward the target without overshoot', () => {
    const current = otterPose('idle', 0)
    const target = otterPose('defeat', 0)
    const before = Math.abs(current.lean - target.lean)
    smoothPose(current, target, 1 / 60)
    const after = Math.abs(current.lean - target.lean)
    expect(after).toBeLessThan(before)
    expect(current.lidOpen).toBeGreaterThan(target.lidOpen)
    expect(current.confetti).toBe(target.confetti)
  })
})
