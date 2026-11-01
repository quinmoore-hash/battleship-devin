import { describe, expect, it } from 'vitest'
import { CREAK_MAX_S, CREAK_MIN_S, DUCK_GAIN, createAmbience, windGainFor } from './ambience'
import { STEP_DISTANCE, TELEPORT_DISTANCE, createFootsteps } from './footsteps'
import { CROWD_GAP_MS, VOICE_GAP_MS, createVoiceLimiter } from './voice'

describe('footstep cadence', () => {
  it('drops one step every STEP_DISTANCE of walking, whatever the frame rate', () => {
    const fs = createFootsteps()
    let steps = 0
    for (let i = 0; i < 100; i++) steps += fs.advance(0.011, 1 / 60).length
    expect(steps).toBe(Math.floor(1.1 / STEP_DISTANCE))
    const slow = createFootsteps()
    let slowSteps = 0
    for (let i = 0; i < 10; i++) slowSteps += slow.advance(0.11, 1 / 6).length
    expect(slowSteps).toBe(steps)
  })
  it('is silent when standing still and resets on a teleport', () => {
    const fs = createFootsteps()
    expect(fs.advance(0, 1 / 60)).toEqual([])
    fs.advance(0.2, 1 / 60)
    expect(fs.advance(TELEPORT_DISTANCE + 1, 1 / 60)).toEqual([])
    expect(fs.advance(0.1, 1 / 60)).toEqual([])
  })
  it('running steps are louder and brighter than walking ones', () => {
    const walk = createFootsteps().advance(STEP_DISTANCE, 1 / 60, false)[0]
    const run = createFootsteps().advance(STEP_DISTANCE, 1 / 60, true)[0]
    expect(run.gain).toBeGreaterThan(walk.gain)
    expect(run.rate).toBeGreaterThan(walk.rate)
  })
})

describe('voice rate limiter', () => {
  it('allows at most one ordinary line per VOICE_GAP_MS', () => {
    const v = createVoiceLimiter()
    expect(v.request('crew-call', 0)).toBe(true)
    expect(v.request('crew-call', 1000)).toBe(false)
    expect(v.request('crew-call', VOICE_GAP_MS - 1)).toBe(false)
    expect(v.request('crew-call', VOICE_GAP_MS)).toBe(true)
  })
  it('lets the gun captain run the sequence: "Run out the gun!" after half the gap, "Fire!" after a quarter', () => {
    const v = createVoiceLimiter()
    v.request('crew-call', 0)
    expect(v.request('gun-call-run-out', VOICE_GAP_MS * 0.25)).toBe(false)
    expect(v.request('gun-call-run-out', VOICE_GAP_MS * 0.5)).toBe(true)
    const t = VOICE_GAP_MS * 0.5
    expect(v.request('gun-call-fire', t + 500)).toBe(false)
    expect(v.request('gun-call-fire', t + VOICE_GAP_MS * 0.25)).toBe(true)
  })
  it('lets urgent lines (brace, panic) cut in, never two at once', () => {
    const v = createVoiceLimiter()
    v.request('crew-call', 0)
    expect(v.request('crew-brace', VOICE_GAP_MS * 0.25)).toBe(false)
    expect(v.request('crew-brace', VOICE_GAP_MS * 0.5)).toBe(true)
    expect(v.request('crew-panic', VOICE_GAP_MS * 0.5 + 100)).toBe(false)
    expect(v.request('crew-panic', VOICE_GAP_MS * 0.75)).toBe(true)
  })
  it('cheer / groan are crowd reactions on their own guard: they follow a line at once, but not each other', () => {
    const v = createVoiceLimiter()
    expect(v.request('gun-call-fire', 0)).toBe(true)
    expect(v.request('crew-cheer', 1100)).toBe(true)
    expect(v.request('crew-groan', 1100 + CROWD_GAP_MS - 1)).toBe(false)
    expect(v.request('crew-groan', 1100 + CROWD_GAP_MS)).toBe(true)
    // the crowd never silences the next spoken line
    expect(v.request('crew-brace', VOICE_GAP_MS * 0.5)).toBe(true)
  })
})

describe('ambience', () => {
  it('maps weather to wind gain, storm loudest', () => {
    expect(windGainFor('calm')).toBeLessThan(windGainFor('overcast'))
    expect(windGainFor('overcast')).toBeLessThan(windGainFor('squall'))
    expect(windGainFor('squall')).toBeLessThan(windGainFor('stormy'))
    expect(windGainFor('stormy')).toBe(1)
    expect(DUCK_GAIN).toBeLessThan(1)
  })
  it('creaks at random 4–9 s intervals', () => {
    const amb = createAmbience(() => 0.5)
    const times: number[] = []
    let t = 0
    for (let i = 0; i < 60 * 60; i++) {
      t += 1 / 60
      if (amb.tick(1 / 60, 0).includes('hull-creak')) times.push(t)
    }
    expect(times.length).toBeGreaterThan(5)
    for (let i = 2; i < times.length; i++) {
      const gap = times[i] - times[i - 1]
      expect(gap).toBeGreaterThanOrEqual(CREAK_MIN_S - 0.05)
      expect(gap).toBeLessThanOrEqual(CREAK_MAX_S + 0.05)
    }
  })
  it('strains the rigging once per wave peak, not on a flat sea', () => {
    const amb = createAmbience(() => 0.9)
    let strains = 0
    for (let i = 0; i < 600; i++) if (amb.tick(1 / 60, 0).includes('rope-strain')) strains++
    expect(strains).toBe(0)
    const waves = createAmbience(() => 0.9)
    strains = 0
    for (let i = 0; i < 60 * 20; i++) {
      const y = 0.06 * Math.sin((i / 60) * (Math.PI * 2) / 5)
      if (waves.tick(1 / 60, y).includes('rope-strain')) strains++
    }
    expect(strains).toBe(4)
  })
})
