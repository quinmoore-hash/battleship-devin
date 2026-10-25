import { afterEach, describe, expect, it } from 'vitest'
import { amplitudeScale, calmFactor, getSeaState, sampleWaveHeight, setSeaState, STORM_AMPLITUDE, WAVE_COUNT, wavesToGlsl } from './waves'

afterEach(() => setSeaState(0))

describe('storm sea state', () => {
  it('clamps to 0..1 and scales wave amplitude up to STORM_AMPLITUDE', () => {
    setSeaState(5)
    expect(getSeaState()).toBe(1)
    expect(amplitudeScale()).toBeCloseTo(STORM_AMPLITUDE)
    setSeaState(-1)
    expect(getSeaState()).toBe(0)
    expect(amplitudeScale()).toBe(1)
  })

  it('makes open-water waves taller in a storm but keeps the board zone damped', () => {
    const calmPeak = Math.max(...Array.from({ length: 60 }, (_, i) => Math.abs(sampleWaveHeight(60, -60, i * 0.25))))
    setSeaState(1)
    const stormPeak = Math.max(...Array.from({ length: 60 }, (_, i) => Math.abs(sampleWaveHeight(60, -60, i * 0.25))))
    expect(stormPeak).toBeGreaterThan(calmPeak * 1.8)
    expect(calmFactor(0, -6, 1)).toBeLessThan(calmFactor(60, -60, 1))
    expect(calmFactor(0, -6, 1)).toBeGreaterThan(calmFactor(0, -6, 0))
  })

  it('injects the storm uniform into the GLSL wave bank', () => {
    expect(wavesToGlsl(WAVE_COUNT.high)).toContain('uniform float uStorm;')
  })
})
