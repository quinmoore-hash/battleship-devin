import { describe, expect, it } from 'vitest'
import { computeAtmosphere, GOLDEN_HOUR, parseTimeOfDay, parseWeather, TIME_PRESETS, TIME_PRESET_NAMES, WEATHERS } from './sun'

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

  const lum = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)

  describe('Sky & sea presets', () => {

    it('dawn / noon / golden hour light with the sun, dusk and night with the moon (one key light, never both)', () => {
      const a = Object.fromEntries(TIME_PRESET_NAMES.map((n) => [n, computeAtmosphere(TIME_PRESETS[n])]))
      expect(a.dawn.moon).toBe(0)
      expect(a.noon.moon).toBe(0)
      expect(a.golden.moon).toBe(0)
      expect(a.dusk.moon).toBe(1)
      expect(a.night.moon).toBe(1)
      expect(a.noon.keyDir[1]).toBeCloseTo(a.noon.sunDir[1], 5)
      expect(a.noon.keyColor).toBe(a.noon.sunColor)
      // the moon rises opposite the sun, well above the horizon, still on the near-shore side (+z)
      expect(a.night.keyDir[1]).toBeGreaterThan(0.3)
      expect(a.night.keyDir[2]).toBeGreaterThan(0)
      expect(Math.sign(a.night.keyDir[0])).toBe(-Math.sign(a.night.sunDir[0]))
      expect(Math.hypot(...a.night.keyDir)).toBeCloseTo(1, 5)
      expect(a.night.keyIntensity).toBeLessThan(a.noon.keyIntensity * 0.5)
      expect(a.night.keyIntensity).toBeGreaterThan(0.5)
    })

    it('night palette: cool key light, stars, dark sky and fog, brighter lanterns and fill — ships stay lit', () => {
      const night = computeAtmosphere(TIME_PRESETS.night)
      const noon = computeAtmosphere(TIME_PRESETS.noon)
      const b = (hex: string) => parseInt(hex.slice(5, 7), 16)
      const r = (hex: string) => parseInt(hex.slice(1, 3), 16)
      expect(b(night.keyColor)).toBeGreaterThan(r(night.keyColor))
      expect(night.stars).toBe(1)
      expect(lum(night.skyZenith)).toBeLessThan(lum(noon.skyZenith) * 0.4)
      expect(lum(night.fogColor)).toBeLessThan(lum(noon.fogColor) * 0.5)
      expect(night.lanternGlow).toBeGreaterThan(2)
      expect(noon.lanternGlow).toBeCloseTo(1, 2)
      expect(night.fillIntensity).toBeGreaterThanOrEqual(0.5)
      expect(night.ambientIntensity).toBeGreaterThan(0.4)
      expect(night.hemiIntensity).toBeGreaterThanOrEqual(0.8)
    })

    it('dawn and dusk are warm twilights on opposite horizons; dusk still shows some stars', () => {
      const dawn = computeAtmosphere(TIME_PRESETS.dawn)
      const dusk = computeAtmosphere(TIME_PRESETS.dusk)
      expect(dawn.sunDir[0]).toBeGreaterThan(0)
      expect(dusk.sunDir[0]).toBeLessThan(0)
      expect(dawn.elevation).toBeGreaterThan(0)
      expect(dusk.elevation).toBeLessThan(0)
      expect(dusk.stars).toBeGreaterThan(0.3)
      expect(dusk.stars).toBeLessThan(0.9)
      expect(dawn.stars).toBe(0)
    })

    it('every preset × weather yields valid colours and a unit key direction', () => {
      for (const n of TIME_PRESET_NAMES) {
        for (const w of WEATHERS) {
          const a = computeAtmosphere(TIME_PRESETS[n], w)
          for (const c of [a.keyColor, a.ambientColor, a.skyZenith, a.skyHorizon, a.sunGlow, a.fogColor, a.waterDeep, a.waterShallow]) expect(c).toMatch(/^#[0-9a-f]{6}$/)
          expect(Math.hypot(...a.keyDir)).toBeCloseTo(1, 5)
          expect(a.weather).toBe(w)
        }
      }
    })
  })

  describe('weather profiles', () => {
    it('overcast is grey but dry and flat; squall rains with big swell but no lightning; stormy adds lightning and the full heave', () => {
      const t = TIME_PRESETS.golden
      const calm = computeAtmosphere(t, 'calm')
      const over = computeAtmosphere(t, 'overcast')
      const squall = computeAtmosphere(t, 'squall')
      const storm = computeAtmosphere(t, 'stormy')
      expect(calm).toMatchObject({ storm: 0, rain: 0, swell: 0, lightning: false })
      expect(over.rain).toBe(0)
      expect(over.lightning).toBe(false)
      expect(over.storm).toBeGreaterThan(0.3)
      expect(over.swell).toBeLessThan(0.3)
      expect(squall.rain).toBe(1)
      expect(squall.lightning).toBe(false)
      expect(squall.swell).toBeGreaterThan(over.swell)
      expect(squall.swell).toBeLessThanOrEqual(storm.swell)
      expect(storm.lightning).toBe(true)
      expect(storm.swell).toBe(1)
      expect(lum(over.skyZenith)).toBeLessThan(lum(calm.skyZenith))
      expect(lum(squall.skyZenith)).toBeLessThan(lum(over.skyZenith))
    })

    it('unknown weather falls back to calm instead of breaking the scene', () => {
      expect(computeAtmosphere(0.5, 'hail' as never)).toMatchObject({ weather: 'calm', storm: 0 })
      expect(parseWeather('hail')).toBe('calm')
      expect(parseWeather(null)).toBe('calm')
      expect(parseWeather('squall')).toBe('squall')
      expect(parseWeather(undefined, 'overcast')).toBe('overcast')
    })

    it('parseTimeOfDay accepts preset names and numbers, else the golden hour', () => {
      expect(parseTimeOfDay('night')).toBe(TIME_PRESETS.night)
      expect(parseTimeOfDay('0.3')).toBeCloseTo(0.3)
      expect(parseTimeOfDay('later')).toBe(GOLDEN_HOUR)
      expect(parseTimeOfDay(null)).toBe(GOLDEN_HOUR)
      expect(parseTimeOfDay('', 0.1)).toBe(0.1)
    })
  })
})
