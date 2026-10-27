import type { Vec3 } from './layout'

/**
 * Everything in the scene that depends on the time of day is derived from one number in
 * [0, 1]: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset, 1 = midnight again.
 * The default (`GOLDEN_HOUR`) is a warm late-afternoon look.
 */
export const GOLDEN_HOUR = 0.68

/**
 * `calm` / `overcast` / `squall` are the player's "Sky & sea" picks (looks only); `stormy` is forced by the
 * Stormy-seas rule: squall plus lightning and the heaviest swell.
 */
export type Weather = 'calm' | 'overcast' | 'squall' | 'stormy'
export const WEATHERS: readonly Weather[] = ['calm', 'overcast', 'squall', 'stormy']
export const WEATHER_LABELS: Record<Weather, string> = { calm: 'Calm', overcast: 'Overcast', squall: 'Squall', stormy: 'Stormy seas' }

/** Named times of day for the Sky & sea picker (fractions of the day, see `computeAtmosphere`). */
export const TIME_PRESETS = { dawn: 0.27, noon: 0.5, golden: GOLDEN_HOUR, dusk: 0.77, night: 0.98 } as const
export type TimePreset = keyof typeof TIME_PRESETS
export const TIME_PRESET_NAMES = Object.keys(TIME_PRESETS) as TimePreset[]
export const TIME_PRESET_LABELS: Record<TimePreset, string> = { dawn: 'Dawn', noon: 'Noon', golden: 'Golden hour', dusk: 'Dusk', night: 'Moonlit night' }

export const isTimePreset = (v: unknown): v is TimePreset => typeof v === 'string' && Object.hasOwn(TIME_PRESETS, v)
export const isWeather = (v: unknown): v is Weather => typeof v === 'string' && (WEATHERS as readonly string[]).includes(v)

/** `?tod=`: a preset name or a number (fraction of the day); anything else is `fallback`. */
export function parseTimeOfDay(raw: string | null | undefined, fallback: number = GOLDEN_HOUR): number {
  if (raw == null || raw === '') return fallback
  if (isTimePreset(raw)) return TIME_PRESETS[raw]
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/** `?weather=` / stored value: a known weather, else `fallback` (unknown names never break the scene). */
export function parseWeather(raw: unknown, fallback: Weather = 'calm'): Weather {
  return isWeather(raw) ? raw : fallback
}

interface WeatherProfile {
  /** Overcast look 0..1: cloud cover, grey-green desaturation, fog, dimmer sun. */
  storm: number
  /** Rain streaks + rings on the water 0..1. */
  rain: number
  /** Swell: 0 = sheltered cove, 1 = the stormy-seas heave (`setSeaState`). */
  swell: number
  lightning: boolean
}
const WEATHER_PROFILE: Record<Weather, WeatherProfile> = {
  calm: { storm: 0, rain: 0, swell: 0, lightning: false },
  overcast: { storm: 0.55, rain: 0, swell: 0.15, lightning: false },
  squall: { storm: 0.85, rain: 1, swell: 0.7, lightning: false },
  stormy: { storm: 1, rain: 1, swell: 1, lightning: true },
}

export interface Atmosphere {
  weather: Weather
  /** 0 = calm, 1 = full storm look (overcast, grey-green sea). Rain / swell / lightning are separate below. */
  storm: number
  /** 0..1 rain density (squall and stormy). */
  rain: number
  /** 0..1 swell scale fed to `setSeaState` (squall 0.7, stormy 1). */
  swell: number
  /** Lightning only in the Stormy-seas rule weather. */
  lightning: boolean
  /** 0 = the key light is the sun, 1 = it is the moon (the one shadow-casting directional light swaps role). */
  moon: number
  /** Unit direction toward the key light (sun by day, moon at night). */
  keyDir: Vec3
  keyColor: string
  keyIntensity: number
  /** Camera-following fill so hulls never go black; higher at night / dusk (silhouette complaint). */
  fillIntensity: number
  hemiIntensity: number
  /** Multiplier for lantern / buoy flame emissive: 1 by day, brighter after dark. */
  lanternGlow: number
  /** Unit direction *toward* the sun. y < 0 means night. */
  sunDir: Vec3
  /** Sun elevation in [-1, 1] (sin of the altitude angle). */
  elevation: number
  /** 0 = full night, 1 = full day. Smooth through twilight. */
  daylight: number
  sunColor: string
  sunIntensity: number
  ambientColor: string
  ambientIntensity: number
  skyZenith: string
  skyHorizon: string
  /** Colour of the glow around the sun disc. */
  sunGlow: string
  fogColor: string
  waterDeep: string
  waterShallow: string
  /** 0..1 star visibility. */
  stars: number
  /** Moonlight fill when the sun is down. */
  moonIntensity: number
}

type Stop = { t: number; c: [number, number, number] }

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgbToHex = (c: [number, number, number]) =>
  '#' + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Piecewise-linear colour ramp over t in [0,1] (wraps around). */
function ramp(stops: Stop[], t: number): string {
  const tt = ((t % 1) + 1) % 1
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (tt >= a.t && tt <= b.t) {
      const k = b.t === a.t ? 0 : (tt - a.t) / (b.t - a.t)
      return rgbToHex([lerp(a.c[0], b.c[0], k), lerp(a.c[1], b.c[1], k), lerp(a.c[2], b.c[2], k)])
    }
  }
  return rgbToHex(stops[stops.length - 1].c)
}
const stops = (pairs: [number, string][]): Stop[] => pairs.map(([t, hex]) => ({ t, c: hexToRgb(hex) }))

const SUN = stops([
  [0, '#5b6fa8'], // midnight: cool moon
  [0.2, '#5b6fa8'],
  [0.25, '#ff9a4a'], // sunrise
  [0.33, '#ffd9a8'],
  [0.5, '#fff6e0'], // noon
  [0.66, '#ffe3b0'],
  [0.74, '#ff9a3a'], // golden hour
  [0.78, '#ff5e3a'], // sunset
  [0.83, '#5b6fa8'],
  [1, '#5b6fa8'],
])
const ZENITH = stops([
  [0, '#060a1e'],
  [0.2, '#0a1030'],
  [0.26, '#3b4a8a'],
  [0.35, '#3e8fd9'],
  [0.5, '#3a86e0'],
  [0.65, '#3f87d8'],
  [0.74, '#3a5fa8'],
  [0.8, '#1d2a66'],
  [0.86, '#0a1030'],
  [1, '#060a1e'],
])
const HORIZON = stops([
  [0, '#141c3a'],
  [0.2, '#1a2246'],
  [0.25, '#ff9f6a'],
  [0.33, '#ffd3a1'],
  [0.5, '#bfe4ff'],
  [0.65, '#ffe0b5'],
  [0.72, '#ffb574'],
  [0.78, '#ff7a4d'],
  [0.84, '#2a2a5c'],
  [1, '#141c3a'],
])
const GLOW = stops([
  [0, '#8fa3e6'],
  [0.2, '#8fa3e6'],
  [0.25, '#ffb070'],
  [0.4, '#fff0cc'],
  [0.6, '#fff0cc'],
  [0.72, '#ffb060'],
  [0.78, '#ff7040'],
  [0.84, '#8fa3e6'],
  [1, '#8fa3e6'],
])
const DEEP = stops([
  [0, '#061427'],
  [0.2, '#07192f'],
  [0.26, '#0f3a5c'],
  [0.35, '#0e4f7a'],
  [0.5, '#0a5c8c'],
  [0.65, '#0d5680'],
  [0.74, '#124565'],
  [0.8, '#0c2a48'],
  [0.86, '#07192f'],
  [1, '#061427'],
])
const SHALLOW = stops([
  [0, '#15405a'],
  [0.2, '#174766'],
  [0.26, '#3a9fb0'],
  [0.35, '#45d3c8'],
  [0.5, '#4fe3d4'],
  [0.65, '#4bd1c4'],
  [0.74, '#4bb6a8'],
  [0.8, '#2a7a84'],
  [0.86, '#174766'],
  [1, '#15405a'],
])
const AMBIENT = stops([
  [0, '#2a3566'],
  [0.2, '#2a3566'],
  [0.26, '#8a7fa8'],
  [0.35, '#a9c6e8'],
  [0.5, '#bcd6f0'],
  [0.65, '#c9c3d8'],
  [0.74, '#b08a9a'],
  [0.8, '#4a4a88'],
  [0.86, '#2a3566'],
  [1, '#2a3566'],
])

/** Blend a hex colour toward `target` by `k`, dropping saturation on the way (overcast look). */
function stormTint(hex: string, target: string, k: number): string {
  if (k <= 0) return hex
  const a = hexToRgb(hex)
  const b = hexToRgb(target)
  const lum = (a[0] * 0.3 + a[1] * 0.59 + a[2] * 0.11)
  const grey: [number, number, number] = [lerp(a[0], lum, 0.6), lerp(a[1], lum, 0.6), lerp(a[2], lum, 0.6)]
  return rgbToHex([lerp(grey[0], b[0], k), lerp(grey[1], b[1], k), lerp(grey[2], b[2], k)])
}

export function computeAtmosphere(timeOfDay: number, weather: Weather = 'calm'): Atmosphere {
  const t = ((timeOfDay % 1) + 1) % 1
  const w = WEATHER_PROFILE[isWeather(weather) ? weather : 'calm']
  const storm = w.storm
  const angle = (t - 0.25) * Math.PI * 2 // 0 at sunrise, PI/2 at noon, PI at sunset
  const elevation = Math.sin(angle)
  // sun travels east -> west across the bay, arcing over the near shore (+z) so the fleets are front-lit from
  // the player's camera instead of backlit into silhouettes
  const sunDir: Vec3 = [Math.cos(angle) * 0.9, elevation, 0.55 + 0.25 * Math.max(0, elevation)]
  const len = Math.hypot(...sunDir)
  const dir: Vec3 = [sunDir[0] / len, sunDir[1] / len, sunDir[2] / len]

  const daylight = smoothstep(-0.12, 0.18, elevation)
  const night = 1 - daylight
  const stars = (1 - smoothstep(-0.22, 0.02, elevation)) * (1 - storm)
  const sunIntensity = lerp(0.08, 2.4, smoothstep(-0.05, 0.35, elevation)) * lerp(1, 0.28, storm)
  const ambientIntensity = lerp(0.42, 0.75, daylight) * lerp(1, 0.84, storm)
  const moonIntensity = night * 1.0 * (1 - storm * 0.35)

  // the moon takes over the single directional slot once the sun is well under the horizon; the moon sits
  // opposite the sun but on the same (near-shore) side, so night ships stay front-lit too
  const moon = smoothstep(0.02, 0.12, -elevation)
  const moonDir: Vec3 = [-dir[0], Math.max(-dir[1], 0.35), dir[2]]
  const ml = Math.hypot(...moonDir)
  const sunKey: Vec3 = [dir[0], Math.max(dir[1], 0.08), dir[2]]
  const sl = Math.hypot(...sunKey)
  const keyDir: Vec3 = moon > 0.5 ? [moonDir[0] / ml, moonDir[1] / ml, moonDir[2] / ml] : [sunKey[0] / sl, sunKey[1] / sl, sunKey[2] / sl]

  // a storm pulls every colour toward a bruised grey-green overcast, darker at night
  const k = storm * 0.72
  const dark = lerp(1, 0.45, night)
  const overcast = rgbToHex([74 * dark, 84 * dark, 92 * dark])
  const seaStorm = rgbToHex([38 * dark, 60 * dark, 62 * dark])
  const shallowStorm = rgbToHex([70 * dark, 110 * dark, 108 * dark])
  const sunColor = stormTint(ramp(SUN, t), '#c9d2d8', storm * 0.5)

  return {
    weather: isWeather(weather) ? weather : 'calm',
    storm,
    rain: w.rain,
    swell: w.swell,
    lightning: w.lightning,
    sunDir: dir,
    elevation,
    daylight,
    sunColor,
    sunIntensity,
    ambientColor: stormTint(ramp(AMBIENT, t), overcast, k),
    ambientIntensity,
    skyZenith: stormTint(ramp(ZENITH, t), rgbToHex([44 * dark, 52 * dark, 60 * dark]), k),
    skyHorizon: stormTint(ramp(HORIZON, t), overcast, k),
    sunGlow: stormTint(ramp(GLOW, t), '#b8c0c8', storm * 0.8),
    fogColor: stormTint(ramp(HORIZON, t), overcast, k),
    waterDeep: stormTint(ramp(DEEP, t), seaStorm, k),
    waterShallow: stormTint(ramp(SHALLOW, t), shallowStorm, k),
    stars,
    moonIntensity,
    moon,
    keyDir,
    keyColor: moon > 0.5 ? stormTint('#aebfff', '#c9d2d8', storm * 0.5) : sunColor,
    keyIntensity: lerp(sunIntensity, moonIntensity, moon),
    fillIntensity: lerp(0.7, 0.55, daylight) * lerp(1, 0.95, storm),
    hemiIntensity: lerp(0.9, 1.2, daylight),
    lanternGlow: 1 + night * 1.4,
  }
}

/**
 * Lantern flame boost shared with the ship kit (`Lantern` / `SternLantern` read it every frame). The scene
 * sets it from `Atmosphere.lanternGlow`, so the kit never has to know about the sky.
 */
const lanternGlow = { value: 1 }
export const setLanternGlow = (v: number): void => {
  lanternGlow.value = v
}
export const getLanternGlow = (): number => lanternGlow.value
