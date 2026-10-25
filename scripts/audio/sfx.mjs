/**
 * Pirate battle sound effects. Every generator is deterministic (seeded) and returns a mono buffer.
 */
import {
  TAU, adEnv, asrEnv, bandpass, buffer, comb, echo, envelope, expInterp, fadeEdges, foldLoop, gain, highpass, lerp,
  limit, lowpass, midi, mix, noise, normalize, pinkNoise, pluck, resonantLowpass, reverb, rng, softclip, tone, trimTail,
  wander, waves,
} from './dsp.mjs'

const finish = (out, { peak = 0.95, drive = 1.1 } = {}) => fadeEdges(trimTail(limit(out, peak, drive)))

// ---------------------------------------------------------------- cannon

/** Deep black-powder boom with a sharp crack and a long air-rumble tail. */
export function cannonFire(seed) {
  const r = rng(seed)
  const size = 0.92 + r() * 0.16
  const out = buffer(2.6)
  // muzzle crack: a hard, very short broadband transient
  const crack = highpass(noise(0.035, (t) => adEnv(t, 0.0005, 0.03, 5), r), 900)
  mix(out, softclip(crack, 4), 0, 1.6)
  // pressure wave: lowpassed noise that opens then slams shut
  const body = lowpass(noise(1.1, (t) => adEnv(t, 0.003, 0.8, 3.5), r), (t) => expInterp(5200, 140, Math.min(1, t / 0.9)) / size)
  mix(out, softclip(body, 2.2), 0.002, 1.5)
  // sub boom: pitched thump sweeping down
  const boom = tone(1.4, (t) => expInterp(140, 32, Math.min(1, t / 0.5)) / size, (t) => adEnv(t, 0.004, 1.2, 3.2))
  mix(out, softclip(boom, 3), 0.004, 1.3)
  // rolling rumble tail across the bay
  const rumble = lowpass(pinkNoise(2.2, (t) => adEnv(t, 0.08, 2.0, 2.4), r), 160, 2)
  mix(out, rumble, 0.12, 2.6)
  // smoke/air hiss after the blast
  mix(out, bandpass(noise(0.9, (t) => adEnv(t, 0.03, 0.8, 3), r), (t) => 1800 - 900 * Math.min(1, t / 0.8), 0.9), 0.05, 0.25)
  return finish(reverb(out, { mixLevel: 0.22, decay: 0.84, tail: 1.1, size: 2.2, damp: 0.4 }), { drive: 1.4 })
}

/** Ball in flight: airy whistle whose pitch falls as it goes away (the runtime also rate-shifts it by distance). */
export function cannonWhistle() {
  const r = rng(77)
  const out = buffer(1.7)
  const pitch = (t) => expInterp(2300, 820, Math.min(1, t / 1.5))
  const amp = envelope([[0, 0], [0.12, 0.6], [0.45, 1], [1.2, 0.55], [1.6, 0]])
  // breathy core
  mix(out, bandpass(noise(1.65, amp, r), pitch, 9), 0, 1.0)
  mix(out, bandpass(noise(1.65, amp, r), (t) => pitch(t) * 1.5, 7), 0, 0.35)
  // thin whistle tone with vibrato
  mix(out, tone(1.65, (t) => pitch(t) * (1 + 0.012 * Math.sin(TAU * 11 * t)), (t) => amp(t) * 0.5), 0, 0.5)
  // low rush of air
  mix(out, lowpass(noise(1.65, amp, r), 500), 0, 0.35)
  return finish(out, { peak: 0.8 })
}

// ---------------------------------------------------------------- water

/** A cannonball punching into the sea: slap, deep whoomp, tall spray, falling droplets. */
export function splashMiss(seed) {
  const r = rng(seed)
  const size = 0.9 + r() * 0.2
  const out = buffer(2.4)
  // surface slap
  mix(out, bandpass(noise(0.05, (t) => adEnv(t, 0.001, 0.045, 4), r), 1700 * size, 1.1), 0, 1.4)
  // body of displaced water
  const whoomp = lowpass(noise(0.6, (t) => adEnv(t, 0.01, 0.5, 3), r), (t) => expInterp(900, 160, Math.min(1, t / 0.5)) * size)
  mix(out, softclip(whoomp, 2), 0.01, 1.6)
  mix(out, tone(0.35, (t) => expInterp(170, 420, Math.min(1, t / 0.3)) * size, (t) => adEnv(t, 0.01, 0.3, 3)), 0.02, 0.5)
  // rising spray column then rain-back
  const spray = bandpass(noise(1.6, envelope([[0, 0], [0.08, 1], [0.5, 0.7], [1.5, 0]]), r), (t) => (3200 + 1800 * Math.sin(Math.min(1, t / 1.4) * Math.PI)) * size, 0.8)
  mix(out, lowpass(spray, 7000), 0.03, 0.55)
  // droplets falling back in
  const drops = 10 + Math.floor(r() * 6)
  for (let i = 0; i < drops; i++) {
    const at = 0.45 + r() * 1.1
    const f = 500 + r() * 1400
    const drop = tone(0.08, (t) => expInterp(f, f * 2.1, Math.min(1, t / 0.07)), (t) => adEnv(t, 0.003, 0.07, 3))
    mix(out, drop, at, 0.16 * (1 - at / 1.8))
  }
  // churn / fizz
  mix(out, highpass(noise(1.4, (t) => adEnv(t, 0.2, 1.2, 2.5), r), 3500), 0.3, 0.12)
  return finish(reverb(out, { mixLevel: 0.18, decay: 0.7, tail: 0.6, size: 1.6 }), { peak: 0.92 })
}

/** Bubbles rising from a flooding hull. Seamless loop. */
export function bubbles() {
  const r = rng(909)
  const LOOP = 3.2
  const out = buffer(LOOP + 0.6)
  for (let i = 0; i < 46; i++) {
    const at = r() * LOOP
    const f = 240 + r() * 900
    const len = 0.05 + r() * 0.08
    const b = tone(len, (t) => expInterp(f, f * (1.5 + r() * 0.6), Math.min(1, t / len)), (t) => adEnv(t, 0.004, len, 2.5))
    mix(out, b, at, 0.18 + r() * 0.2)
  }
  // underwater gurgle bed
  const gurgle = multiplyWander(lowpass(noise(LOOP + 0.6, 1, r), 700), wander(LOOP + 0.6, 6, r, 0.05))
  mix(out, gurgle, 0, 0.5)
  return normalize(foldLoop(out, LOOP, true), 0.7)
}

function multiplyWander(src, mod) {
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = src[i] * mod[i]
  return out
}

// ---------------------------------------------------------------- wood

/** Cannonball into oak: splinter crack, planks bursting, heavy thud, debris landing. */
export function impactWood(seed) {
  const r = rng(seed)
  const size = 0.9 + r() * 0.2
  const out = buffer(1.9)
  // initial strike: broadband crack through wood resonances
  const strike = highpass(noise(0.02, (t) => adEnv(t, 0.0005, 0.018, 4), r), 600)
  mix(out, softclip(comb(strike, 420 * size, 0.86, 0.25), 3), 0, 1.4)
  mix(out, comb(strike, 760 * size, 0.8, 0.3), 0, 0.5)
  // splintering: dense cluster of micro-cracks in the first 180 ms
  for (let i = 0; i < 18; i++) {
    const at = r() * r() * 0.2
    const crack = bandpass(noise(0.01, (t) => adEnv(t, 0.0003, 0.009, 4), r), 1500 + r() * 4500, 2.5)
    mix(out, crack, at, 1.2 * (1 - at / 0.25) * (0.5 + r()))
  }
  // hull thud
  const thud = tone(0.5, (t) => expInterp(190, 55, Math.min(1, t / 0.35)) * size, (t) => adEnv(t, 0.003, 0.45, 4))
  mix(out, softclip(thud, 2.5), 0.006, 1.2)
  mix(out, lowpass(noise(0.4, (t) => adEnv(t, 0.002, 0.3, 4), r), (t) => expInterp(2500, 200, Math.min(1, t / 0.3))), 0.004, 0.9)
  // timber groaning briefly under the shock
  mix(out, bandpass(tone(0.35, (t) => 110 * size * (1 + 0.1 * Math.sin(TAU * 9 * t)), (t) => adEnv(t, 0.05, 0.3, 3), waves.softSaw), 380 * size, 2.5), 0.05, 0.35)
  // debris: wood bits clattering on deck
  for (let i = 0; i < 7; i++) {
    const at = 0.3 + r() * 0.9
    const f = 350 + r() * 900
    const knock = tone(0.06, () => f, (t) => adEnv(t, 0.001, 0.05, 6), waves.tri)
    mix(out, knock, at, 0.22 * (1 - at / 1.5))
  }
  return finish(reverb(out, { mixLevel: 0.17, decay: 0.72, tail: 0.5, size: 1.5 }), { drive: 1.3 })
}

/** Timbers working: slow stick-slip groan sweeping up in pitch. */
export function hullCreak(seed = 404) {
  const r = rng(seed)
  const out = buffer(2.4)
  const creak = (at, len, f0, f1, g) => {
    // stick-slip: a pulse train whose rate rises, through a wooden resonance
    const freq = (t) => expInterp(f0, f1, Math.min(1, t / len)) * (1 + 0.03 * Math.sin(TAU * 6 * t))
    const amp = (t) => asrEnv(t, len, len * 0.3, len * 0.4) * (0.7 + 0.3 * Math.sin(TAU * 13 * t))
    let v = tone(len, freq, amp, waves.pulse(0.12))
    v = resonantLowpass(v, (t) => 700 + 500 * Math.min(1, t / len), 0.45)
    v = comb(v, 210, 0.7, 0.4)
    mix(out, v, at, g)
  }
  creak(0, 1.1, 48, 92, 0.9)
  creak(0.95, 0.9, 64, 58, 0.6)
  creak(1.5 + r() * 0.1, 0.7, 40, 70, 0.5)
  mix(out, lowpass(noise(2.2, (t) => asrEnv(t, 2.2, 0.4, 0.8), r), 220), 0, 0.15)
  return finish(reverb(out, { mixLevel: 0.15, decay: 0.7, tail: 0.5 }), { peak: 0.85 })
}

/** A mast going over: sharp crack, long tearing splinter, rigging whipping, the spar crashing down. */
export function mastSnap() {
  const r = rng(515)
  const out = buffer(3.2)
  // first ominous crack
  const crack = highpass(noise(0.03, (t) => adEnv(t, 0.0004, 0.025, 4), r), 500)
  mix(out, softclip(comb(crack, 320, 0.9, 0.2), 3.5), 0, 1.5)
  // tearing fibres: dense crackle whose density and pitch drop over 0.8 s
  for (let i = 0; i < 70; i++) {
    const at = 0.02 + r() * r() * 0.9
    const c = bandpass(noise(0.012, (t) => adEnv(t, 0.0003, 0.01, 4), r), 900 + r() * 5000 * (1 - at / 1.2), 2)
    mix(out, c, at, 1.1 * (1 - at / 1.1))
  }
  mix(out, bandpass(noise(0.9, envelope([[0, 0.2], [0.1, 1], [0.8, 0]]), r), (t) => 1600 - 1100 * Math.min(1, t / 0.8), 1.4), 0.03, 0.6)
  // rigging parting and whipping
  for (let i = 0; i < 6; i++) {
    const at = 0.25 + r() * 0.9
    mix(out, highpass(noise(0.05, (t) => adEnv(t, 0.002, 0.045, 3), r), 2500), at, 0.4)
    mix(out, pluck(0.5, 90 + r() * 120, r, { brightness: 0.3, decay: 0.993 }), at, 0.35)
  }
  // the spar hits deck and sea
  const crash = 1.05 + r() * 0.1
  mix(out, softclip(tone(1.0, (t) => expInterp(120, 38, Math.min(1, t / 0.4)), (t) => adEnv(t, 0.004, 0.9, 3.5)), 2.5), crash, 1.3)
  mix(out, lowpass(noise(0.9, (t) => adEnv(t, 0.003, 0.7, 3.5), r), (t) => expInterp(3000, 150, Math.min(1, t / 0.6))), crash, 1.3)
  mix(out, bandpass(noise(1.2, (t) => adEnv(t, 0.02, 1.0, 3), r), (t) => 2600 - 1200 * Math.min(1, t / 1), 0.9), crash + 0.03, 0.4) // splash of the yard
  for (let i = 0; i < 9; i++) {
    const at = crash + 0.15 + r() * 0.9
    mix(out, tone(0.07, () => 300 + r() * 800, (t) => adEnv(t, 0.001, 0.06, 6), waves.tri), at, 0.25 * (1 - (at - crash) / 1.3))
  }
  return finish(reverb(out, { mixLevel: 0.2, decay: 0.78, tail: 0.9, size: 1.8 }), { drive: 1.3 })
}

/** The whole hull groaning as she goes down: low moaning timbers, stressed iron, rushing water. */
export function sinkingGroan() {
  const r = rng(606)
  const LEN = 4.6
  const out = buffer(LEN + 0.4)
  // deep groan: rich low tone with slow pitch sag and formant sweep
  const groan = (at, len, f0, f1, g) => {
    const freq = (t) => expInterp(f0, f1, Math.min(1, t / len)) * (1 + 0.02 * Math.sin(TAU * 4.5 * t))
    let v = tone(len, freq, (t) => asrEnv(t, len, len * 0.35, len * 0.35), waves.softSaw)
    v = resonantLowpass(v, (t) => 180 + 420 * Math.sin((Math.min(1, t / len)) * Math.PI), 0.5)
    mix(out, v, at, g)
  }
  groan(0, 2.6, 52, 41, 1.0)
  groan(1.6, 2.4, 64, 47, 0.8)
  groan(2.9, 1.6, 44, 36, 0.9)
  // stressed timbers (shorter creaks on top)
  for (let i = 0; i < 5; i++) {
    const at = 0.3 + r() * 3.2
    const len = 0.4 + r() * 0.5
    let v = tone(len, (t) => expInterp(70 + r() * 40, 110 + r() * 60, Math.min(1, t / len)), (t) => asrEnv(t, len, len * 0.3, len * 0.4), waves.pulse(0.1))
    v = resonantLowpass(v, 900, 0.4)
    mix(out, comb(v, 260, 0.7, 0.4), at, 0.35)
  }
  // deep rumble + sub
  mix(out, lowpass(pinkNoise(LEN, (t) => asrEnv(t, LEN, 0.6, 1.2), r), 110, 2), 0, 2.2)
  mix(out, tone(LEN, (t) => 38 + 5 * Math.sin(TAU * 0.6 * t), (t) => asrEnv(t, LEN, 0.5, 1.0)), 0, 0.45)
  // sea pouring in: swelling filtered noise
  const rush = bandpass(noise(LEN, (t) => 0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, t / LEN)), r), (t) => 500 + 500 * Math.sin(TAU * 0.3 * t), 0.7)
  mix(out, lowpass(rush, 2600), 0, 0.45)
  // bubbles escaping
  for (let i = 0; i < 22; i++) {
    const at = 0.8 + r() * 3.4
    const f = 220 + r() * 600
    mix(out, tone(0.08, (t) => expInterp(f, f * 1.7, Math.min(1, t / 0.07)), (t) => adEnv(t, 0.004, 0.07, 3)), at, 0.16)
  }
  return finish(reverb(out, { mixLevel: 0.28, decay: 0.84, tail: 1.2, size: 2.2, damp: 0.5 }), { peak: 0.95 })
}

// ---------------------------------------------------------------- fire

/** Burning deck: crackling, hissing, flame roar. Seamless loop (6 s). */
export function fireLoop() {
  const r = rng(303)
  const LOOP = 6
  const XF = 1
  const out = buffer(LOOP + XF)
  // flame roar: pink noise lowpassed with a flickering modulator
  const flicker = wander(LOOP + XF, 14, r, 0.04)
  const roar = multiplyWander(lowpass(pinkNoise(LOOP + XF, 1, r), 900, 2), gain(flicker, () => 1).map((v) => 0.45 + 0.55 * v))
  mix(out, roar, 0, 1.6)
  // hiss / sizzle layer
  const hiss = multiplyWander(bandpass(noise(LOOP + XF, 1, r), 3800, 0.6), wander(LOOP + XF, 7, r, 0.08).map((v) => 0.3 + 0.7 * v))
  mix(out, hiss, 0, 0.12)
  // crackles: random short bright impulses
  for (let i = 0; i < 160; i++) {
    const at = r() * (LOOP + XF - 0.05)
    const f = 1200 + r() * 5500
    const c = bandpass(noise(0.008 + r() * 0.01, (t) => adEnv(t, 0.0003, 0.012, 5), r), f, 3)
    mix(out, c, at, 0.5 + r() * 0.9)
  }
  // pops: small pitched thumps (knots bursting)
  for (let i = 0; i < 14; i++) {
    const at = r() * (LOOP + XF - 0.1)
    const f = 90 + r() * 180
    mix(out, tone(0.09, (t) => expInterp(f * 2, f, Math.min(1, t / 0.05)), (t) => adEnv(t, 0.002, 0.08, 5)), at, 0.5)
  }
  return normalize(foldLoop(out, LOOP, true), 0.85)
}

// ---------------------------------------------------------------- crew (formant voices)

/** Rough formant-synth shout. `contour(t)` gives the fundamental in Hz; `vowels` morph formant sets. */
function voice(len, contour, vowels, r, { breath = 0.25, rough = 0.12 } = {}) {
  const jitter = wander(len, 30, r, 0.01)
  const src = tone(len, (t) => contour(t) * (1 + rough * 0.08 * (jitter[Math.min(jitter.length - 1, Math.round(t * 44100))] - 0.5)), (t) => asrEnv(t, len, 0.03, len * 0.3), waves.pulse(0.3))
  const air = noise(len, (t) => asrEnv(t, len, 0.03, len * 0.3) * breath, r)
  const mixed = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) mixed[i] = src[i] + air[i]
  const out = new Float32Array(src.length)
  const [vA, vB] = vowels
  for (let f = 0; f < 3; f++) {
    const band = bandpass(mixed, (t) => lerp(vA.f[f], vB.f[f], Math.min(1, t / len)), 6)
    mix(out, band, 0, vA.g[f])
  }
  return out
}

const VOWEL = {
  a: { f: [730, 1090, 2440], g: [1, 0.5, 0.25] },
  o: { f: [570, 840, 2410], g: [1, 0.35, 0.15] },
  e: { f: [530, 1840, 2480], g: [1, 0.4, 0.2] },
  i: { f: [270, 2290, 3010], g: [0.8, 0.5, 0.3] },
  r: { f: [490, 1350, 1690], g: [1, 0.45, 0.3] },
}

/** "Yarr!" / "Hit!" — a handful of gruff voices barking together as a shot lands. */
export function crewShoutHit() {
  const r = rng(808)
  const out = buffer(1.3)
  const voices = 5
  for (let v = 0; v < voices; v++) {
    const base = midi(45 + r() * 7) // A2..E3 register
    const at = r() * 0.12
    const len = 0.45 + r() * 0.2
    const contour = (t) => base * expInterp(1.15, 0.85, Math.min(1, t / len)) * (1 + 0.04 * Math.sin(TAU * 5.5 * t))
    mix(out, voice(len, contour, [VOWEL.a, VOWEL.r], r), at, 0.5)
  }
  // a couple of shorter "Ha!"s afterwards
  for (let v = 0; v < 2; v++) {
    const base = midi(50 + r() * 5)
    const at = 0.55 + r() * 0.2
    mix(out, voice(0.22, (t) => base * expInterp(1.1, 0.9, Math.min(1, t / 0.22)), [VOWEL.a, VOWEL.a], r), at, 0.4)
  }
  return finish(reverb(out, { mixLevel: 0.18, decay: 0.7, tail: 0.5, size: 1.5 }), { peak: 0.85 })
}

/** Crew cheering: rising "Hooraay!" from many voices, then a few whoops. */
export function crewCheer() {
  const r = rng(818)
  const out = buffer(2.6)
  for (let v = 0; v < 9; v++) {
    const base = midi(48 + r() * 12)
    const at = r() * 0.2
    const len = 1.1 + r() * 0.4
    const contour = (t) => base * expInterp(0.9, 1.35, Math.min(1, t / (len * 0.6))) * (1 + 0.03 * Math.sin(TAU * 6 * t))
    mix(out, voice(len, contour, [VOWEL.o, VOWEL.e], r, { breath: 0.2 }), at, 0.32)
  }
  for (let v = 0; v < 4; v++) {
    const base = midi(57 + r() * 9)
    const at = 1.0 + r() * 0.9
    const len = 0.3 + r() * 0.2
    mix(out, voice(len, (t) => base * expInterp(0.8, 1.5, Math.min(1, t / len)), [VOWEL.o, VOWEL.i], r), at, 0.3)
  }
  // hands slapping / stamping
  for (let i = 0; i < 10; i++) {
    const at = 0.4 + r() * 1.8
    mix(out, lowpass(noise(0.05, (t) => adEnv(t, 0.001, 0.04, 5), r), 1200), at, 0.3)
  }
  return finish(reverb(out, { mixLevel: 0.22, decay: 0.75, tail: 0.7, size: 1.8 }), { peak: 0.88 })
}

// ---------------------------------------------------------------- bells & drums

/** Bronze ship's bell: inharmonic partials with individual decays. */
function bellStrike(len, f, gainAt = 1) {
  const out = buffer(len)
  const partials = [
    [0.5, 0.5, 2.0], [1, 1, 1.6], [1.183, 0.6, 1.4], [1.506, 0.45, 1.2], [2.0, 0.5, 1.0], [2.514, 0.35, 0.8], [2.662, 0.25, 0.7], [3.011, 0.2, 0.6], [4.166, 0.12, 0.45],
  ]
  for (const [ratio, g, decayScale] of partials) {
    mix(out, tone(len, () => f * ratio, (t) => adEnv(t, 0.001, len * decayScale * 0.9, 3.5)), 0, g * gainAt)
  }
  // clapper click
  const r = rng(Math.round(f))
  mix(out, highpass(noise(0.01, (t) => adEnv(t, 0.0003, 0.008, 4), r), 2500), 0, 0.5)
  return out
}

/** Victory: eight bells rung in pairs, then a bright major fanfare chord swelling under a last bell. */
export function bellVictory() {
  const out = buffer(5.0)
  const f = 1046 // C6-ish bronze
  const pairs = [0, 0.34, 0.9, 1.24, 1.8, 2.14]
  pairs.forEach((at, i) => mix(out, bellStrike(2.5, f * (i % 2 ? 1 : 0.999)), at, 0.75))
  // final big bell on the chord
  mix(out, bellStrike(3.0, f / 2), 2.75, 0.9)
  // accordion-ish major chord swell (D major, shanty key) under the last bells
  const chordAt = 2.7
  for (const n of [50, 57, 62, 66, 69, 74]) {
    for (const det of [-7, 0, 7]) {
      const fr = midi(n) * Math.pow(2, det / 1200)
      mix(out, lowpass(tone(2.1, () => fr, (t) => asrEnv(t, 2.1, 0.35, 0.9), waves.softSaw), 2600), chordAt, 0.055)
    }
  }
  // drum roll flourish into the chord
  const r = rng(5)
  for (let i = 0; i < 14; i++) {
    const at = 2.1 + i * 0.045
    mix(out, lowpass(noise(0.05, (t) => adEnv(t, 0.001, 0.04, 5), r), 1500), at, 0.25 + i * 0.03)
  }
  mix(out, softclip(tone(0.8, (t) => expInterp(110, 55, Math.min(1, t / 0.3)), (t) => adEnv(t, 0.003, 0.7, 4)), 2), chordAt, 0.8)
  return finish(reverb(out, { mixLevel: 0.3, decay: 0.85, tail: 1.3, size: 2.0 }), { peak: 0.95 })
}

/** Defeat: a slow funeral tattoo on a muffled drum with a minor accordion drone sinking under it. */
export function drumDefeat() {
  const r = rng(13)
  const out = buffer(4.6)
  const drum = (at, g, f0 = 95) => {
    mix(out, softclip(tone(0.9, (t) => expInterp(f0, f0 * 0.5, Math.min(1, t / 0.25)), (t) => adEnv(t, 0.004, 0.8, 3.5)), 2), at, g)
    mix(out, lowpass(noise(0.3, (t) => adEnv(t, 0.001, 0.2, 4), r), (t) => expInterp(2500, 300, Math.min(1, t / 0.2))), at, g * 0.6)
  }
  drum(0, 0.9)
  drum(0.9, 0.8)
  drum(1.35, 0.55)
  drum(1.8, 0.95)
  // snare-ish ruffle before the last hit
  for (let i = 0; i < 6; i++) mix(out, bandpass(noise(0.04, (t) => adEnv(t, 0.001, 0.035, 4), r), 1800, 1.2), 2.55 + i * 0.05, 0.22 + i * 0.03)
  drum(2.9, 1.0, 80)
  // minor drone: D minor → sinks a semitone at the end
  for (const n of [38, 50, 53, 57]) {
    for (const det of [-6, 6]) {
      const freq = (t) => midi(n) * Math.pow(2, det / 1200) * expInterp(1, 0.944, Math.max(0, Math.min(1, (t - 2.6) / 1.4)))
      mix(out, lowpass(tone(4.3, freq, (t) => asrEnv(t, 4.3, 1.0, 1.4) * (0.8 + 0.2 * Math.sin(TAU * 1.5 * t)), waves.softSaw), 1600), 0.1, 0.07)
    }
  }
  return finish(reverb(out, { mixLevel: 0.26, decay: 0.84, tail: 1.2, size: 2.0, damp: 0.45 }), { peak: 0.95 })
}

// ---------------------------------------------------------------- UI / placement

/** Wooden tick (rolling a die on a chart table). */
export function uiClick() {
  const r = rng(5)
  const out = buffer(0.2)
  mix(out, tone(0.06, (t) => expInterp(1400, 600, Math.min(1, t / 0.05)), (t) => adEnv(t, 0.001, 0.05, 5), waves.tri), 0, 0.7)
  mix(out, comb(highpass(noise(0.012, (t) => adEnv(t, 0.0003, 0.01, 4), r), 1200), 900, 0.8, 0.3), 0, 0.9)
  return finish(out, { peak: 0.6 })
}

/** Softer, higher tick for hover. */
export function uiHover() {
  const r = rng(6)
  const out = buffer(0.12)
  mix(out, tone(0.035, (t) => expInterp(2200, 1500, Math.min(1, t / 0.03)), (t) => adEnv(t, 0.001, 0.03, 5), waves.tri), 0, 0.5)
  mix(out, highpass(noise(0.008, (t) => adEnv(t, 0.0003, 0.006, 4), r), 3000), 0, 0.5)
  return finish(out, { peak: 0.35 })
}

/** Ship set down on the chart: heavy wooden thunk, a short rope creak, a small lap of water. */
export function placeShip() {
  const r = rng(11)
  const out = buffer(0.9)
  const knock = bandpass(noise(0.035, (t) => adEnv(t, 0.0005, 0.03, 3), r), 900, 1.0)
  mix(out, softclip(comb(knock, 240, 0.85, 0.35), 2), 0, 1.4)
  mix(out, tone(0.3, (t) => expInterp(150, 70, Math.min(1, t / 0.2)), (t) => adEnv(t, 0.002, 0.25, 5)), 0.002, 0.9)
  mix(out, tone(0.15, () => 520, (t) => adEnv(t, 0.001, 0.1, 7), waves.tri), 0, 0.3)
  // rope creak
  let creak = tone(0.25, (t) => expInterp(70, 120, Math.min(1, t / 0.25)), (t) => asrEnv(t, 0.25, 0.08, 0.1), waves.pulse(0.12))
  creak = resonantLowpass(creak, 1100, 0.4)
  mix(out, creak, 0.08, 0.25)
  // water lap
  mix(out, bandpass(noise(0.5, (t) => adEnv(t, 0.03, 0.4, 3), r), (t) => 1500 + 900 * Math.min(1, t / 0.4), 0.9), 0.05, 0.3)
  return finish(reverb(out, { mixLevel: 0.12, decay: 0.6, tail: 0.3 }), { peak: 0.85 })
}

/** Rotating a ship: a quick wooden ratchet (three clicks) with a swish. */
export function rotateShip() {
  const r = rng(12)
  const out = buffer(0.45)
  for (let i = 0; i < 3; i++) {
    const at = i * 0.055
    const click = comb(highpass(noise(0.01, (t) => adEnv(t, 0.0003, 0.008, 4), r), 1000), 700 + i * 120, 0.82, 0.3)
    mix(out, click, at, 0.9)
  }
  mix(out, bandpass(noise(0.25, (t) => adEnv(t, 0.04, 0.2, 3), r), (t) => 1200 + 1800 * Math.min(1, t / 0.2), 1.2), 0.02, 0.35)
  return finish(out, { peak: 0.7 })
}

// ---------------------------------------------------------------- weather & wildlife

/** Canvas slatting in a gust: a few heavy "whumps" of sailcloth. */
export function sailFlap() {
  const r = rng(21)
  const out = buffer(1.6)
  const flaps = [0, 0.19, 0.42, 0.58, 0.9, 1.08]
  flaps.forEach((at, i) => {
    const len = 0.12 + r() * 0.08
    let whump = noise(len, (t) => adEnv(t, 0.004, len, 3), r)
    whump = lowpass(whump, (t) => expInterp(2400, 500, Math.min(1, t / len)), 2)
    mix(out, softclip(whump, 1.8), at, 1.1 - i * 0.08)
    mix(out, tone(0.1, (t) => expInterp(140, 60, Math.min(1, t / 0.08)), (t) => adEnv(t, 0.002, 0.09, 5)), at, 0.5)
  })
  mix(out, bandpass(noise(1.5, envelope([[0, 0.3], [0.6, 1], [1.5, 0]]), r), 600, 0.8), 0, 0.2)
  return finish(out, { peak: 0.85 })
}

/** Storm thunder: a tearing crack followed by a long rolling rumble with echoes off the headlands. */
export function thunder() {
  const r = rng(31)
  const out = buffer(5.5)
  // crack
  const crack = highpass(noise(0.12, (t) => adEnv(t, 0.002, 0.1, 3), r), 700)
  mix(out, softclip(crack, 3), 0, 1.2)
  mix(out, lowpass(noise(0.5, (t) => adEnv(t, 0.003, 0.4, 3), r), (t) => expInterp(4000, 300, Math.min(1, t / 0.4))), 0.01, 1.2)
  // rolling rumble: pink noise lowpassed, modulated by a slow random walk and a few secondary peaks
  const roll = wander(4.8, 3, r, 0.12)
  const rumbleEnv = envelope([[0, 0.3], [0.25, 1], [1.4, 0.7], [2.6, 0.9], [4.6, 0]])
  const rumble = multiplyWander(lowpass(pinkNoise(4.8, 1, r), (t) => 90 + 120 * rumbleEnv(t), 2), roll.map((v, i) => (0.4 + 0.6 * v) * rumbleEnv(i / 44100)))
  mix(out, rumble, 0.15, 3.2)
  mix(out, tone(3.0, (t) => 34 + 6 * Math.sin(TAU * 0.4 * t), (t) => adEnv(t, 0.2, 2.8, 2.5)), 0.2, 0.5)
  return finish(echo(reverb(out, { mixLevel: 0.25, decay: 0.86, tail: 0.8, size: 2.5, damp: 0.55 }), 0.9, 0.35, 2, 0.3), { peak: 0.95, drive: 1.3 })
}

/** Herring gull: a couple of "kee-yaa" cries. */
export function gull(seed = 41) {
  const r = rng(seed)
  const out = buffer(1.9)
  const cry = (at, len, base) => {
    const freq = (t) => base * envelope([[0, 0.85], [len * 0.25, 1.25], [len * 0.55, 1.05], [len, 0.8]])(t) * (1 + 0.025 * Math.sin(TAU * 28 * t))
    const amp = (t) => asrEnv(t, len, len * 0.15, len * 0.35)
    let v = tone(len, freq, amp, waves.pulse(0.35))
    v = bandpass(v, (t) => freq(t) * 1.0, 3)
    const v2 = bandpass(tone(len, freq, amp, waves.saw), (t) => freq(t) * 2.0, 4)
    mix(out, v, at, 0.8)
    mix(out, v2, at, 0.35)
    mix(out, highpass(noise(len, (t) => amp(t) * 0.15, r), 2000), at, 0.3)
  }
  cry(0, 0.5, 1150 + r() * 200)
  cry(0.62, 0.42, 1250 + r() * 200)
  cry(1.18, 0.6, 1050 + r() * 150)
  return finish(reverb(out, { mixLevel: 0.2, decay: 0.72, tail: 0.5, size: 2.0 }), { peak: 0.75 })
}
