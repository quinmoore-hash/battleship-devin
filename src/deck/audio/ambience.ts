/**
 * Deck ambience scheduler (pure): hull creaks at random 4–9 s, rigging strain on wave peaks, water lapping at the hull
 * and a wind loop whose gain follows the weather. `DeckAudio` ticks it once per frame and plays what it returns.
 */
import type { Weather } from '../../store/gameStore'

export const CREAK_MIN_S = 4
export const CREAK_MAX_S = 9
export const LAP_MIN_S = 2.5
export const LAP_MAX_S = 5
/** Rigging strain only when the hull has risen at least this much (world units) since the last trough. */
export const PEAK_MIN_RISE = 0.02
/** Never two strains closer than this. */
export const STRAIN_MIN_GAP_S = 3

/** Wind-in-sails loop gain per weather; a storm is twice a calm day. */
export const WIND_GAIN: Record<Weather, number> = { calm: 0.35, overcast: 0.5, squall: 0.8, stormy: 1 }
export function windGainFor(weather: Weather): number {
  return WIND_GAIN[weather] ?? WIND_GAIN.calm
}

/** Cinematic cues pull the ambience down to this fraction. */
export const DUCK_GAIN = 0.4

export type AmbienceCue = 'hull-creak' | 'rope-strain' | 'water-lap'

export interface Ambience {
  /** Advance by `dt` seconds with the hull's current height; returns the cues that fire this tick. */
  tick(dt: number, hullY: number): AmbienceCue[]
  reset(): void
}

export function createAmbience(random: () => number = Math.random): Ambience {
  let creakIn = 0
  let lapIn = 0
  let lastY = NaN
  let rising = false
  let trough = NaN
  let sinceStrain = STRAIN_MIN_GAP_S
  const span = (lo: number, hi: number) => lo + (hi - lo) * random()
  const reset = () => {
    creakIn = span(CREAK_MIN_S, CREAK_MAX_S) * 0.5
    lapIn = span(0.5, LAP_MIN_S)
    lastY = NaN
    rising = false
    trough = NaN
    sinceStrain = STRAIN_MIN_GAP_S
  }
  reset()
  return {
    tick(dt, hullY) {
      const out: AmbienceCue[] = []
      creakIn -= dt
      if (creakIn <= 0) {
        out.push('hull-creak')
        creakIn = span(CREAK_MIN_S, CREAK_MAX_S)
      }
      lapIn -= dt
      if (lapIn <= 0) {
        out.push('water-lap')
        lapIn = span(LAP_MIN_S, LAP_MAX_S)
      }
      sinceStrain += dt
      if (Number.isFinite(lastY)) {
        if (hullY > lastY + 1e-5) {
          if (!rising) trough = lastY
          rising = true
        } else if (hullY < lastY - 1e-5 && rising) {
          rising = false
          if (Number.isFinite(trough) && lastY - trough >= PEAK_MIN_RISE && sinceStrain >= STRAIN_MIN_GAP_S) {
            out.push('rope-strain')
            sinceStrain = 0
          }
        }
      }
      lastY = hullY
      return out
    },
    reset,
  }
}
