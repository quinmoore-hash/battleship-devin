import { describe, expect, it } from 'vitest'
import { beatAt, buildSequence, createSequenceClock, timeScaleAt } from './sequence'
import { CINEMATIC_TIMING, type CinematicEvent } from './types'
import { DEFAULT_SLOW_MO } from '../vfx/sinking/timeline'

const shot: CinematicEvent = { type: 'shot', by: 'human', target: { x: 1, y: 1 }, result: { coord: { x: 1, y: 1 }, outcome: 'miss' } }
const events: CinematicEvent[] = [shot, { type: 'sink', owner: 'enemy', shipId: 'sloop' }, { type: 'battle-start' }, { type: 'victory', winner: 'human' }]

describe('buildSequence', () => {
  it('uses CINEMATIC_TIMING for full and fast, zero for off', () => {
    for (const e of events) {
      expect(buildSequence(e, 'full').duration).toBeCloseTo(CINEMATIC_TIMING[e.type].full)
      expect(buildSequence(e, 'fast').duration).toBeCloseTo(CINEMATIC_TIMING[e.type].fast)
      expect(buildSequence(e, 'off').duration).toBe(0)
      expect(buildSequence(e, 'off').beats).toEqual([])
    }
  })
  it('beats tile the whole duration without gaps', () => {
    for (const e of events)
      for (const level of ['full', 'fast'] as const) {
        const seq = buildSequence(e, level)
        let t = 0
        for (const b of seq.beats) {
          expect(b.start).toBeCloseTo(t)
          t += b.duration
        }
        expect(t).toBeCloseTo(seq.duration)
      }
  })
  it('fast compresses every shot beat by the same factor', () => {
    const full = buildSequence(shot, 'full')
    const fast = buildSequence(shot, 'fast')
    const f = fast.duration / full.duration
    full.beats.forEach((b, i) => expect(fast.beats[i].duration).toBeCloseTo(b.duration * f))
    expect(fast.speedScale).toBeCloseTo(1 / f)
  })
  it('sink has slow-mo at full, none at fast or with reduced motion', () => {
    const full = buildSequence(events[1], 'full')
    expect(full.slowMo).toEqual(DEFAULT_SLOW_MO)
    const mid = full.duration * 0.55
    expect(timeScaleAt(full, mid)).toBe(0.4)
    expect(timeScaleAt(full, 0.1)).toBe(1)
    expect(timeScaleAt(full, full.duration - 0.1)).toBe(1)
    expect(buildSequence(events[1], 'fast').slowMo).toBeUndefined()
    expect(buildSequence(events[1], 'full', true).slowMo).toBeUndefined()
    expect(timeScaleAt(buildSequence(events[1], 'full', true), mid)).toBe(1)
  })
})

describe('beatAt', () => {
  it('finds the beat and local progress', () => {
    const seq = buildSequence(shot, 'full')
    expect(beatAt(seq, 0).beat?.name).toBe('approach')
    const fire = seq.beats[1]
    const mid = beatAt(seq, fire.start + fire.duration / 2)
    expect(mid.index).toBe(1)
    expect(mid.k).toBeCloseTo(0.5)
    expect(beatAt(seq, 99).beat?.name).toBe('return')
    expect(beatAt(seq, 99).k).toBe(1)
    expect(beatAt(buildSequence(shot, 'off'), 0)).toEqual({ beat: null, k: 1, index: -1 })
  })
})

describe('createSequenceClock', () => {
  it('runs to the duration and reports done once', () => {
    const clock = createSequenceClock(buildSequence(shot, 'fast'))
    let ticks = 0
    while (!clock.advance(0.05)) ticks++
    expect(clock.t).toBeCloseTo(1.6)
    expect(ticks).toBe(31)
    expect(clock.advance(0.05)).toBe(false)
  })
  it('clamps huge steps so a tab switch does not skip beats', () => {
    const clock = createSequenceClock(buildSequence(shot, 'full'))
    clock.advance(5)
    expect(clock.t).toBeCloseTo(0.5)
  })
  it('skip jumps to the end and finishes on the next tick', () => {
    const clock = createSequenceClock(buildSequence(shot, 'full'))
    clock.advance(0.5)
    clock.skip()
    expect(clock.skipped).toBe(true)
    expect(clock.t).toBeCloseTo(4.5)
    expect(clock.done).toBe(false)
    expect(clock.advance(0)).toBe(true)
  })
  it('off is done on its first tick', () => {
    const clock = createSequenceClock(buildSequence(shot, 'off'))
    expect(clock.advance(0)).toBe(true)
  })
})
