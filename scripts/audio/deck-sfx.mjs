/**
 * "On deck" sound effects (src/deck/audio): footsteps on planks, rigging strain, water lapping at the hull, wind in the
 * sails, crew voices (formant-synthesised "voiced placeholders", no recordings) and the spyglass clicks.
 * Every generator is deterministic (seeded) and returns a mono buffer. Kept short: the whole set must stay well under 600 KB.
 */
import {
  TAU, adEnv, asrEnv, bandpass, buffer, comb, envelope, expInterp, foldLoop, highpass, lerp, lowpass, midi, mix, noise,
  pinkNoise, resonantLowpass, reverb, rng, softclip, tone, wander, waves,
} from './dsp.mjs'
import { VOWEL, finish, voice } from './sfx.mjs'

// ---------------------------------------------------------------- footsteps

/** One boot on oak planks: a short thud with the plank's knock and a little grit. */
export function footstep(seed) {
  const r = rng(seed)
  const out = buffer(0.32)
  const len = 0.12 + r() * 0.04
  const f0 = 95 + r() * 30
  mix(out, tone(len, (t) => expInterp(f0 * 1.6, f0, Math.min(1, t / 0.05)), (t) => adEnv(t, 0.002, len, 5)), 0, 0.9)
  let knock = noise(0.08, (t) => adEnv(t, 0.001, 0.07, 6), r)
  knock = resonantLowpass(knock, 900 + r() * 400, 0.5)
  mix(out, knock, 0, 0.5)
  mix(out, highpass(noise(0.05, (t) => adEnv(t, 0.001, 0.04, 4), r), 2500), 0.004, 0.12)
  return finish(comb(out, 180 + r() * 40, 0.55, 0.5), { peak: 0.8 })
}

/** Landing from a jump: both boots, heavier, the deck answering with a low boom. */
export function footstepLand() {
  const r = rng(771)
  const out = buffer(0.6)
  mix(out, footstep(772), 0, 1)
  mix(out, footstep(773), 0.035, 0.9)
  mix(out, tone(0.4, (t) => expInterp(110, 48, Math.min(1, t / 0.3)), (t) => adEnv(t, 0.003, 0.38, 4)), 0, 0.9)
  mix(out, lowpass(noise(0.25, (t) => adEnv(t, 0.002, 0.2, 4), r), 500), 0, 0.5)
  return finish(reverb(out, { mixLevel: 0.12, decay: 0.6, tail: 0.3 }), { peak: 0.9 })
}

// ---------------------------------------------------------------- ship

/** Rope and rigging taking the strain on a wave peak: a slow stick-slip squeal through a taut line. */
export function ropeStrain(seed = 901) {
  const r = rng(seed)
  const len = 1.1 + r() * 0.3
  const out = buffer(len + 0.3)
  const f0 = 180 + r() * 60
  const freq = (t) => f0 * expInterp(1, 1.35, Math.min(1, t / len)) * (1 + 0.02 * Math.sin(TAU * 9 * t))
  let v = tone(len, freq, (t) => asrEnv(t, len, len * 0.4, len * 0.35) * (0.75 + 0.25 * Math.sin(TAU * 17 * t)), waves.pulse(0.1))
  v = resonantLowpass(v, (t) => 1200 + 900 * Math.min(1, t / len), 0.5)
  mix(out, v, 0, 0.8)
  mix(out, bandpass(noise(len, (t) => asrEnv(t, len, 0.3, 0.4) * 0.5, r), 2200, 1.2), 0, 0.2)
  return finish(reverb(comb(out, 320, 0.6, 0.4), { mixLevel: 0.15, decay: 0.7, tail: 0.4 }), { peak: 0.8 })
}

/** Water slapping and running along the hull planks. */
export function waterLap(seed = 911) {
  const r = rng(seed)
  const len = 1.5 + r() * 0.5
  const out = buffer(len)
  const slap = (at, l, g) => {
    let v = pinkNoise(l, (t) => adEnv(t, 0.01, l, 2.5), r)
    v = lowpass(v, (t) => expInterp(2600, 500, Math.min(1, t / l)), 2)
    mix(out, v, at, g)
    mix(out, bandpass(noise(l * 0.6, (t) => adEnv(t, 0.02, l * 0.5, 3), r), 3200, 0.8), at + 0.03, g * 0.35)
  }
  slap(0, 0.5 + r() * 0.2, 1)
  slap(0.45 + r() * 0.2, 0.7, 0.6)
  if (r() > 0.4) slap(1.0 + r() * 0.2, 0.45, 0.45)
  mix(out, lowpass(pinkNoise(len, (t) => asrEnv(t, len, 0.3, 0.6) * 0.5, r), 300), 0, 0.3)
  return finish(out, { peak: 0.75 })
}

/** Wind through canvas and shrouds, 6 s seamless loop; the game scales its gain with the weather. */
export function windSails() {
  const r = rng(921)
  const LOOP = 6
  const XF = 0.8
  const T = LOOP + XF
  const out = buffer(T)
  const gust = wander(T, 0.5, r, 0.25)
  const g = (t) => 0.45 + 0.55 * gust[Math.min(gust.length - 1, Math.round(t * 44100))]
  mix(out, lowpass(pinkNoise(T, g, r), (t) => 500 + 900 * g(t), 2), 0, 1.2)
  // whistle through the shrouds
  mix(out, bandpass(noise(T, (t) => Math.pow(g(t), 2) * 0.6, r), (t) => 1400 + 700 * g(t), 4), 0, 0.35)
  // canvas flutter
  const flutter = noise(T, (t) => Math.max(0, g(t) - 0.55) * (0.5 + 0.5 * Math.sin(TAU * 11 * t)), r)
  mix(out, lowpass(flutter, 900), 0, 0.5)
  return finish(foldLoop(out, LOOP, true), { peak: 0.8 })
}

// ---------------------------------------------------------------- crew voices (synthesised placeholders)

const bark = (out, at, base, len, vowels, r, g = 0.6) => mix(out, voice(len, (t) => base * expInterp(1.12, 0.9, Math.min(1, t / len)), vowels, r), at, g)

/** A deck-hand's call: "Steady!" (two syllables), "Heave!" (one long pull) or a bosun's whistle, by seed. */
export function crewCall(seed) {
  const r = rng(seed)
  const kind = seed % 3
  const out = buffer(1.4)
  if (kind === 0) {
    // "Stea-dy!"
    const base = midi(46 + r() * 5)
    bark(out, 0, base * 1.05, 0.28, [VOWEL.e, VOWEL.e], r, 0.6)
    bark(out, 0.3, base * 0.95, 0.3, [VOWEL.i, VOWEL.i], r, 0.5)
  } else if (kind === 1) {
    // "Heeave!" — long rising pull with two voices
    for (let v = 0; v < 2; v++) {
      const base = midi(44 + r() * 6)
      mix(out, voice(0.7, (t) => base * envelope([[0, 0.9], [0.3, 1.1], [0.7, 0.95]])(t), [VOWEL.i, VOWEL.a], r), r() * 0.05, 0.5)
    }
  } else {
    // bosun's whistle: two clean notes
    const note = (at, len, f0, f1) => mix(out, tone(len, (t) => expInterp(f0, f1, Math.min(1, t / len)) * (1 + 0.01 * Math.sin(TAU * 6 * t)), (t) => asrEnv(t, len, 0.02, 0.08), waves.pulse(0.5)), at, 0.35)
    note(0, 0.35, 1900, 2300)
    note(0.4, 0.45, 2300, 1700)
  }
  return finish(reverb(out, { mixLevel: 0.15, decay: 0.7, tail: 0.5, size: 1.4 }), { peak: 0.8 })
}

/** Gun captain: "Run out the gun!" — four quick syllables. */
export function gunCallRunOut() {
  const r = rng(931)
  const out = buffer(1.5)
  const base = midi(45)
  const syl = [
    [0, 0.16, VOWEL.a, 1.0],
    [0.18, 0.18, VOWEL.o, 0.95],
    [0.4, 0.14, VOWEL.e, 1.05],
    [0.56, 0.3, VOWEL.a, 0.9],
  ]
  for (const [at, len, vw, k] of syl) bark(out, at, base * k, len, [vw, vw], r, 0.6)
  return finish(reverb(out, { mixLevel: 0.15, decay: 0.7, tail: 0.5, size: 1.4 }), { peak: 0.85 })
}

/** Gun captain: "FIRE!" — one hard bark, two voices. */
export function gunCallFire() {
  const r = rng(941)
  const out = buffer(0.9)
  for (let v = 0; v < 2; v++) bark(out, r() * 0.04, midi(47 + r() * 4), 0.4, [VOWEL.a, VOWEL.r], r, 0.7)
  return finish(reverb(out, { mixLevel: 0.15, decay: 0.7, tail: 0.5, size: 1.4 }), { peak: 0.9 })
}

/** The crew groaning at a miss: falling "ooh" from several voices. */
export function crewGroan() {
  const r = rng(951)
  const out = buffer(1.4)
  for (let v = 0; v < 5; v++) {
    const base = midi(43 + r() * 6)
    const len = 0.6 + r() * 0.3
    mix(out, voice(len, (t) => base * expInterp(1.05, 0.8, Math.min(1, t / len)), [VOWEL.o, VOWEL.o], r, { breath: 0.35 }), r() * 0.15, 0.4)
  }
  return finish(reverb(out, { mixLevel: 0.18, decay: 0.7, tail: 0.5, size: 1.5 }), { peak: 0.8 })
}

/** "BRACE!" — a shouted warning as the enemy's ball comes in. */
export function crewBrace() {
  const r = rng(961)
  const out = buffer(1.1)
  for (let v = 0; v < 3; v++) {
    const base = midi(48 + r() * 5)
    mix(out, voice(0.5, (t) => base * envelope([[0, 1.15], [0.1, 1.05], [0.5, 0.9]])(t), [VOWEL.r, VOWEL.e], r), r() * 0.06, 0.55)
  }
  return finish(reverb(out, { mixLevel: 0.15, decay: 0.7, tail: 0.5, size: 1.4 }), { peak: 0.9 })
}

/** Panic as the ship goes down: overlapping cries, a long wail, a whistle. */
export function crewPanic() {
  const r = rng(971)
  const out = buffer(2.4)
  for (let v = 0; v < 8; v++) {
    const base = midi(46 + r() * 10)
    const len = 0.3 + r() * 0.5
    const vw = [VOWEL.a, VOWEL.o, VOWEL.e][v % 3]
    mix(out, voice(len, (t) => base * envelope([[0, 1.1], [len * 0.4, 1.2], [len, 0.85]])(t), [vw, VOWEL.a], r), r() * 1.4, 0.4)
  }
  mix(out, voice(1.1, (t) => midi(57) * envelope([[0, 1.0], [0.5, 1.15], [1.1, 0.9]])(t), [VOWEL.a, VOWEL.a], r, { breath: 0.3 }), 0.5, 0.35)
  mix(out, tone(0.5, (t) => expInterp(2100, 2500, Math.min(1, t / 0.5)), (t) => asrEnv(t, 0.5, 0.02, 0.1), waves.pulse(0.5)), 1.2, 0.2)
  return finish(reverb(out, { mixLevel: 0.2, decay: 0.75, tail: 0.6, size: 1.6 }), { peak: 0.9 })
}

/** "Land ho!"-style murmur from the lookout when the glass finds a ship: two syllables, far and echoing. */
export function landHo() {
  const r = rng(981)
  const out = buffer(1.6)
  const base = midi(50)
  bark(out, 0, base * 1.0, 0.3, [VOWEL.a, VOWEL.a], r, 0.5)
  mix(out, voice(0.6, (t) => base * envelope([[0, 1.2], [0.25, 1.3], [0.6, 1.0]])(t), [VOWEL.o, VOWEL.o], r), 0.36, 0.5)
  for (let v = 0; v < 3; v++) mix(out, voice(0.25, (t) => midi(44 + r() * 6) * expInterp(1.05, 0.9, Math.min(1, t / 0.25)), [VOWEL.o, VOWEL.o], r, { breath: 0.4 }), 1.0 + r() * 0.3, 0.25)
  return finish(reverb(out, { mixLevel: 0.3, decay: 0.8, tail: 0.8, size: 2 }), { peak: 0.8 })
}

// ---------------------------------------------------------------- spyglass

/** Brass tubes sliding out and seating: a slide-hiss and a click. */
export function spyglassRaise() {
  const r = rng(991)
  const out = buffer(0.5)
  mix(out, bandpass(noise(0.22, (t) => asrEnv(t, 0.22, 0.03, 0.08), r), (t) => lerp(1800, 2600, t / 0.22), 1.5), 0, 0.35)
  mix(out, softclip(resonantLowpass(noise(0.03, (t) => adEnv(t, 0.0005, 0.025, 6), r), 3200, 0.6), 2), 0.24, 0.9)
  mix(out, tone(0.12, () => 1450, (t) => adEnv(t, 0.001, 0.1, 6)), 0.24, 0.3)
  return finish(out, { peak: 0.7 })
}

/** The glass collapsing shut: click first, then the slide. */
export function spyglassLower() {
  const r = rng(992)
  const out = buffer(0.45)
  mix(out, softclip(resonantLowpass(noise(0.03, (t) => adEnv(t, 0.0005, 0.025, 6), r), 2400, 0.6), 2), 0, 0.8)
  mix(out, bandpass(noise(0.2, (t) => asrEnv(t, 0.2, 0.02, 0.1), r), (t) => lerp(2400, 1500, t / 0.2), 1.5), 0.05, 0.3)
  mix(out, tone(0.1, () => 1100, (t) => adEnv(t, 0.001, 0.08, 6)), 0.22, 0.25)
  return finish(out, { peak: 0.65 })
}
