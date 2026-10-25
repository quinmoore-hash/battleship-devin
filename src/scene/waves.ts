/**
 * Gerstner wave bank shared by the water shader (GLSL) and `sampleWaveHeight` (JS) so that
 * floating props, ships and markers can bob in sync with the surface.
 * Each wave: direction (unit xz), wavelength, steepness (0..1) and amplitude.
 */
export interface GerstnerWave {
  dir: [number, number]
  wavelength: number
  steepness: number
  amplitude: number
}

const norm = (x: number, z: number): [number, number] => {
  const l = Math.hypot(x, z)
  return [x / l, z / l]
}

/** Ordered big -> small so the low quality tier can take the first N. */
export const WAVES: GerstnerWave[] = [
  { dir: norm(1, 0.35), wavelength: 22, steepness: 0.28, amplitude: 0.22 },
  { dir: norm(-0.6, 1), wavelength: 13, steepness: 0.32, amplitude: 0.12 },
  { dir: norm(0.8, -0.7), wavelength: 7.5, steepness: 0.35, amplitude: 0.06 },
  { dir: norm(-1, -0.3), wavelength: 4.2, steepness: 0.4, amplitude: 0.03 },
  { dir: norm(0.3, 1), wavelength: 2.3, steepness: 0.45, amplitude: 0.015 },
  { dir: norm(-0.9, 0.5), wavelength: 1.3, steepness: 0.5, amplitude: 0.008 },
]

export const WAVE_COUNT = { low: 3, high: 6 } as const
export const GRAVITY = 9.81
/** Wave clock runs a little slower than real time so the bay feels calm. */
export const WAVE_TIME_SCALE = 0.7

/**
 * The play area is a sheltered cove: waves are damped to `CALM_MIN` over the two boards and
 * ramp back up to full size `CALM_FALLOFF` units outside them. Must match `calm()` in the shader.
 */
export const CALM_BOX = { cx: 0, cz: -1, hx: 6.5, hz: 13.5 }
export const CALM_MIN = 0.22
export const CALM_FALLOFF = 9

/**
 * Sea state shared by the shader and the JS samplers. `storm` in [0, 1] scales the swell
 * (`STORM_AMPLITUDE` at 1) and lets more of it into the sheltered play area (`STORM_CALM_MIN`).
 * `<Water>` sets it from the scene's `weather`; floating props read it through `sampleWaveHeight`.
 */
export const STORM_AMPLITUDE = 2.4
export const STORM_CALM_MIN = 0.5
const seaState = { storm: 0 }
export function setSeaState(storm: number): void {
  seaState.storm = Math.min(1, Math.max(0, storm))
}
export const getSeaState = (): number => seaState.storm
export const amplitudeScale = (storm: number = seaState.storm): number => 1 + (STORM_AMPLITUDE - 1) * storm

export function calmFactor(x: number, z: number, storm: number = seaState.storm): number {
  const dx = Math.max(Math.abs(x - CALM_BOX.cx) - CALM_BOX.hx, 0)
  const dz = Math.max(Math.abs(z - CALM_BOX.cz) - CALM_BOX.hz, 0)
  const d = Math.hypot(dx, dz)
  const t = Math.min(1, Math.max(0, d / CALM_FALLOFF))
  const s = t * t * (3 - 2 * t)
  const min = CALM_MIN + (STORM_CALM_MIN - CALM_MIN) * storm
  return min + (1 - min) * s
}

export function waveSpeed(w: GerstnerWave): number {
  const k = (2 * Math.PI) / w.wavelength
  return Math.sqrt(GRAVITY / k)
}

/** Vertical surface displacement at world (x, z) at scene time `t` (seconds). */
export function sampleWaveHeight(x: number, z: number, t: number, count: number = WAVE_COUNT.high): number {
  const n = Math.min(count, WAVES.length)
  const tt = t * WAVE_TIME_SCALE
  const cf = calmFactor(x, z) * amplitudeScale()
  // Gerstner vertices slide horizontally, so the surface above (x, z) comes from a nearby
  // source point; iterate the inverse a few times (mirrors the vertex shader exactly).
  let sx = x
  let sz = z
  let y = 0
  for (let iter = 0; iter < 3; iter++) {
    let dx = 0
    let dz = 0
    y = 0
    for (let i = 0; i < n; i++) {
      const w = WAVES[i]
      const k = (2 * Math.PI) / w.wavelength
      const q = w.steepness / (k * w.amplitude * n)
      const f = k * (w.dir[0] * sx + w.dir[1] * sz - waveSpeed(w) * tt)
      const c = Math.cos(f) * cf
      dx += q * w.amplitude * w.dir[0] * c
      dz += q * w.amplitude * w.dir[1] * c
      y += w.amplitude * Math.sin(f) * cf
    }
    sx = x - dx
    sz = z - dz
  }
  return y
}

/** Surface normal (approximate, ignores horizontal Gerstner drift) for tilting floating props. */
export function sampleWaveNormal(x: number, z: number, t: number, count: number = WAVE_COUNT.high): [number, number, number] {
  let nx = 0
  let nz = 0
  const tt = t * WAVE_TIME_SCALE
  for (let i = 0; i < Math.min(count, WAVES.length); i++) {
    const w = WAVES[i]
    const k = (2 * Math.PI) / w.wavelength
    const f = k * (w.dir[0] * x + w.dir[1] * z - waveSpeed(w) * tt)
    const d = w.amplitude * k * Math.cos(f) * calmFactor(x, z) * amplitudeScale()
    nx -= w.dir[0] * d
    nz -= w.dir[1] * d
  }
  const l = Math.hypot(nx, 1, nz)
  return [nx / l, 1 / l, nz / l]
}

/** GLSL array literal for the wave bank, injected into the water shader. */
export function wavesToGlsl(count: number): string {
  const n = Math.min(count, WAVES.length)
  const items = WAVES.slice(0, n)
    .map((w) => {
      const k = (2 * Math.PI) / w.wavelength
      return `vec4(${w.dir[0].toFixed(5)}, ${w.dir[1].toFixed(5)}, ${k.toFixed(5)}, ${w.amplitude.toFixed(5)})`
    })
    .join(',\n    ')
  const steep = WAVES.slice(0, n)
    .map((w) => w.steepness.toFixed(3))
    .join(', ')
  const speeds = WAVES.slice(0, n)
    .map((w) => waveSpeed(w).toFixed(5))
    .join(', ')
  return `
  #define WAVE_COUNT ${n}
  uniform float uStorm;
  float calm(vec2 p) {
    vec2 d = max(abs(p - vec2(${CALM_BOX.cx.toFixed(1)}, ${CALM_BOX.cz.toFixed(1)})) - vec2(${CALM_BOX.hx.toFixed(1)}, ${CALM_BOX.hz.toFixed(1)}), 0.0);
    float cmin = mix(${CALM_MIN.toFixed(2)}, ${STORM_CALM_MIN.toFixed(2)}, uStorm);
    return mix(cmin, 1.0, smoothstep(0.0, ${CALM_FALLOFF.toFixed(1)}, length(d))) * mix(1.0, ${STORM_AMPLITUDE.toFixed(2)}, uStorm);
  }
  const vec4 WAVES[WAVE_COUNT] = vec4[WAVE_COUNT](
    ${items}
  );
  const float STEEP[WAVE_COUNT] = float[WAVE_COUNT](${steep});
  const float SPEED[WAVE_COUNT] = float[WAVE_COUNT](${speeds});
  `
}
