import { describe, expect, it } from 'vitest'
import { computeAtmosphere, GOLDEN_HOUR } from './sun'

describe('computeAtmosphere', () => {
  it('puts the sun above the horizon by day and below at night', () => {
    expect(computeAtmosphere(0.5).sunDir[1]).toBeGreaterThan(0.75)
    expect(computeAtmosphere(0).sunDir[1]).toBeLessThan(-0.75)
    expect(computeAtmosphere(0.25).elevation).toBeCloseTo(0, 5)
    expect(computeAtmosphere(0.75).elevation).toBeCloseTo(0, 5)
  })

  it('fades stars in at night and out by day', () => {
    expect(computeAtmosphere(0).stars).toBe(1)
    expect(computeAtmosphere(0.5).stars).toBe(0)
    expect(computeAtmosphere(GOLDEN_HOUR).stars).toBe(0)
  })

  it('returns valid hex colours and a unit sun direction', () => {
    for (let t = 0; t <= 1; t += 0.05) {
      const a = computeAtmosphere(t)
      for (const c of [a.sunColor, a.skyZenith, a.skyHorizon, a.waterDeep, a.waterShallow, a.fogColor]) {
        expect(c).toMatch(/^#[0-9a-f]{6}$/)
      }
      expect(Math.hypot(...a.sunDir)).toBeCloseTo(1, 5)
    }
  })

  it('darkens and desaturates everything in a storm, and hides the stars', () => {
    const calm = computeAtmosphere(0.5)
    const storm = computeAtmosphere(0.5, 'stormy')
    expect(storm.storm).toBe(1)
    expect(calm.storm).toBe(0)
    expect(storm.sunIntensity).toBeLessThan(calm.sunIntensity * 0.5)
    expect(computeAtmosphere(0, 'stormy').stars).toBe(0)
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)
    expect(lum(storm.skyZenith)).toBeLessThan(lum(calm.skyZenith))
    expect(lum(storm.waterShallow)).toBeLessThan(lum(calm.waterShallow))
    expect(storm.sunDir).toEqual(calm.sunDir)
  })

  it('wraps around past 1', () => {
    expect(computeAtmosphere(1.3)).toEqual(computeAtmosphere(0.3))
  })
})
