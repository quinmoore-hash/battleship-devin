/**
 * Ambience beds (seamless loops):
 *  - `ambienceSea()`   48 s: surf and lapping water, wind in the rigging, creaking timbers, far-off gulls, a distant bell
 *  - `ambienceStorm()` 32 s: heavy rain, gusting wind and bigger seas, layered on top of the sea bed during storms
 */
import { TAU, adEnv, asrEnv, bandpass, buffer, expInterp, foldLoop, highpass, lowpass, mix, noise, normalize, pinkNoise, resonantLowpass, reverb, rng, tone, wander, waves } from './dsp.mjs'
import { gull } from './sfx.mjs'

const mul = (src, mod, fn = (v) => v) => {
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = src[i] * fn(mod[i % mod.length])
  return out
}

function waveBreak(r, len) {
  // a swell that builds, breaks (brighter), then hisses out over the sand
  const env = (x) => Math.pow(Math.sin(Math.PI * Math.min(1, x / len)), 1.4)
  const body = lowpass(pinkNoise(len, env, r), (x) => 600 + 2600 * Math.pow(Math.sin(Math.PI * Math.min(1, x / len)), 2))
  const hiss = bandpass(noise(len, (x) => env(x) * Math.max(0, (x / len - 0.3) / 0.7), r), 3400, 0.7)
  const out = new Float32Array(body.length)
  for (let i = 0; i < out.length; i++) out[i] = body[i] + hiss[i] * 0.25
  return out
}

function creak(r, len) {
  let v = tone(len, (t) => expInterp(45 + r() * 30, 80 + r() * 40, Math.min(1, t / len)), (t) => asrEnv(t, len, len * 0.35, len * 0.4), waves.pulse(0.12))
  return resonantLowpass(v, 900, 0.4)
}

function distantBell(r) {
  const out = buffer(3)
  const f = 740
  for (const [ratio, g] of [[0.5, 0.5], [1, 1], [1.183, 0.5], [1.506, 0.35], [2, 0.3]]) mix(out, tone(3, () => f * ratio, (t) => adEnv(t, 0.002, 2.6, 3.2)), 0, g)
  return lowpass(reverb(out, { mixLevel: 0.6, decay: 0.85, tail: 1, size: 2.5 }), 1800)
}

export function ambienceSea() {
  const r = rng(4242)
  const LOOP = 48
  const XF = 4
  const T = LOOP + XF
  const out = buffer(T)

  // continuous surf bed: pink noise under slow multi-LFO swell
  const swell = (t) => 0.5 + 0.22 * Math.sin(TAU * 0.07 * t) + 0.16 * Math.sin(TAU * 0.17 * t + 1) + 0.12 * Math.sin(TAU * 0.043 * t + 2)
  mix(out, lowpass(pinkNoise(T, swell, r), (t) => 380 + 220 * swell(t), 2), 0, 1.5)
  // individual waves breaking on the beach / hull
  let t = 0.5
  while (t < T - 1) {
    const len = 3 + r() * 3
    mix(out, waveBreak(r, len), t, 0.28 + r() * 0.14)
    t += 2.5 + r() * 4
  }
  // lapping against the hull
  t = 0.2
  while (t < T) {
    const len = 0.5 + r() * 0.7
    mix(out, bandpass(noise(len, (x) => adEnv(x, len * 0.3, len * 0.7, 2), r), (x) => 900 + 1400 * (x / len), 0.9), t, 0.12 + r() * 0.08)
    t += 1.2 + r() * 2.2
  }
  // wind in the rigging: bandpassed noise wandering in pitch and strength, with gusts
  const gust = wander(T, 0.25, r, 1.5)
  const drift = wander(T, 0.12, r, 2.5)
  const windSrc = noise(T, 1, r)
  const wind = bandpass(windSrc, (x) => 380 + 520 * drift[Math.min(drift.length - 1, Math.round(x * 44100))], 1.6)
  mix(out, mul(wind, gust, (g) => 0.15 + 0.85 * g * g), 0, 0.55)
  // whistle in the shrouds on strong gusts
  const whistle = bandpass(windSrc, (x) => 1500 + 900 * drift[Math.min(drift.length - 1, Math.round(x * 44100))], 10)
  mix(out, mul(whistle, gust, (g) => Math.max(0, g - 0.55) * 2), 0, 0.5)
  // creaking timbers and rigging now and then
  t = 3
  while (t < T - 2) {
    mix(out, creak(r, 0.6 + r() * 0.9), t, 0.1 + r() * 0.08)
    t += 4 + r() * 7
  }
  // far-off gulls
  mix(out, gull(43), 9 + r() * 3, 0.1)
  mix(out, gull(44), 27 + r() * 4, 0.08)
  mix(out, gull(45), 39 + r() * 3, 0.07)
  // a bell from across the bay
  mix(out, distantBell(r), 18.5, 0.12)
  mix(out, distantBell(r), 19.1, 0.1)
  return normalize(foldLoop(out, LOOP, true), 0.75)
}

export function ambienceStorm() {
  const r = rng(5353)
  const LOOP = 32
  const XF = 3
  const T = LOOP + XF
  const out = buffer(T)
  // rain: dense bright noise with a slowly varying density, plus discrete heavy drops on the deck
  const density = wander(T, 0.2, r, 2)
  mix(out, mul(bandpass(noise(T, 1, r), 4200, 0.5), density, (d) => 0.55 + 0.45 * d), 0, 0.5)
  mix(out, mul(highpass(noise(T, 1, r), 6000), density, (d) => 0.4 + 0.6 * d), 0, 0.18)
  for (let i = 0; i < 260; i++) {
    const at = r() * (T - 0.1)
    const f = 1800 + r() * 3500
    mix(out, bandpass(noise(0.015, (t) => adEnv(t, 0.0005, 0.012, 4), r), f, 4), at, 0.35 + r() * 0.4)
  }
  // howling wind: stronger, lower, with long gusts
  const gust = wander(T, 0.18, r, 2)
  const drift = wander(T, 0.1, r, 3)
  const src = noise(T, 1, r)
  mix(out, mul(bandpass(src, (x) => 220 + 480 * drift[Math.min(drift.length - 1, Math.round(x * 44100))], 1.2), gust, (g) => 0.3 + 0.7 * g), 0, 1.0)
  mix(out, mul(bandpass(src, (x) => 900 + 1200 * drift[Math.min(drift.length - 1, Math.round(x * 44100))], 6), gust, (g) => Math.max(0, g - 0.4) * 1.6), 0, 0.5)
  // heavy seas: big slow breakers
  let t = 0.5
  while (t < T - 1) {
    const len = 4 + r() * 3
    mix(out, waveBreak(r, len), t, 0.5 + r() * 0.2)
    t += 3 + r() * 3
  }
  mix(out, lowpass(pinkNoise(T, (x) => 0.6 + 0.3 * Math.sin(TAU * 0.09 * x), r), 200, 2), 0, 1.4)
  // halyards slapping the mast in gusts
  for (let i = 0; i < 24; i++) {
    const at = r() * (T - 0.2)
    mix(out, lowpass(noise(0.03, (x) => adEnv(x, 0.001, 0.025, 4), r), 1500), at, 0.25)
  }
  return normalize(foldLoop(out, LOOP, true), 0.8)
}
