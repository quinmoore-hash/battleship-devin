import { describe, expect, it, vi } from 'vitest'
import { AMBIENCE_MS, DISTANT_GUN_GAIN, INCOMING_LEAD_MS, OWN_GUN_GAIN, createDeckLoops, deckShotTimeline, deckSinkTimeline } from './deck'
import { shotTimeline } from './sequence'

const at: [number, number, number] = [1, 0, 2]

describe('deck audio timelines', () => {
  it('own gun is loud and close; the rest of the shot matches the overview cue order', () => {
    const own = deckShotTimeline('hit', { outgoing: true, standingHit: false, nearby: false, from: [0, 0, 0], to: at, flightMs: 1400, fast: false })
    expect(own[0]).toMatchObject({ at: 0, sfx: 'cannon-fire', gain: OWN_GUN_GAIN, at3d: [0, 0, 0] })
    expect(own.map((c) => c.sfx)).toEqual(shotTimeline('hit', { flightMs: 1400 }).map((c) => c.sfx))
  })
  it('incoming ball: distant boom, then a 0.5–0.8 s whistle lead before the impact', () => {
    const inc = deckShotTimeline('hit', { outgoing: false, standingHit: true, nearby: true, from: [0, 0, -20], to: at, flightMs: 1400, fast: false })
    expect(inc[0]).toMatchObject({ sfx: 'cannon-fire', gain: DISTANT_GUN_GAIN })
    const whistle = inc.find((c) => c.sfx === 'cannon-whistle')!
    expect(1400 - whistle.at).toBe(INCOMING_LEAD_MS.full)
    expect(inc.find((c) => c.sfx === 'impact-wood')).toMatchObject({ at: 1400, gain: 1.5 })
    expect(inc.find((c) => c.sfx === 'hull-creak')).toBeDefined()
    const fast = deckShotTimeline('miss', { outgoing: false, standingHit: false, nearby: true, to: at, flightMs: 500, fast: true })
    const w = fast.find((c) => c.sfx === 'cannon-whistle')!
    expect(w.at).toBeGreaterThanOrEqual(0)
    expect(500 - w.at).toBeLessThanOrEqual(INCOMING_LEAD_MS.fast)
  })
  it('sinking the standing ship: creak, water-rush, groan, bubbles, bell; another ship keeps the overview cues', () => {
    expect(deckSinkTimeline(true, at, false).map((c) => c.sfx)).toEqual(['hull-creak', 'water-rush', 'sinking-groan', 'bubbles', 'bell-victory'])
    expect(deckSinkTimeline(false, at, true).map((c) => c.sfx)).toEqual(['mast-snap', 'sinking-groan', 'bubbles', 'crew-cheer'])
  })
})

describe('deck loops', () => {
  it('fire crackle follows burning state and position; no ambience of its own (deck audio layer owns it)', () => {
    vi.useFakeTimers()
    const played: string[] = []
    const handle = { stop: vi.fn(), setPosition: vi.fn() }
    const loops = createDeckLoops({ playAt: (name) => (played.push(name), handle), random: () => 0 })
    loops.update({ on: true, burning: false, fireAt: null, creakAt: at })
    expect(played).toEqual([])
    // ambience (creak / sail-flap) is the deck audio layer's (#55): nothing is scheduled here
    vi.advanceTimersByTime(AMBIENCE_MS.flap[1])
    expect(played).toEqual([])
    loops.update({ on: true, burning: true, fireAt: at, creakAt: at })
    expect(played.filter((n) => n === 'fire-loop')).toHaveLength(1)
    const moved: [number, number, number] = [3, 0, 2]
    loops.update({ on: true, burning: true, fireAt: moved, creakAt: moved })
    expect(handle.setPosition).toHaveBeenCalledWith(moved)
    expect(played.filter((n) => n === 'fire-loop')).toHaveLength(1)
    loops.update({ on: false, burning: true, fireAt: moved, creakAt: moved })
    expect(handle.stop).toHaveBeenCalled()
    const before = played.length
    vi.advanceTimersByTime(60_000)
    expect(played.length).toBe(before)
    loops.stop()
    vi.useRealTimers()
  })
})
