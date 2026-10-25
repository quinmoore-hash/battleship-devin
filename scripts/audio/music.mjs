/**
 * Sea-shanty music: a fiddle + accordion + bodhrán ensemble at 104 BPM in D dorian.
 *  - `musicMenu()`   74 s seamless loop, relaxed tavern feel (menu / placement)
 *  - `musicBattle()` same tune and tempo, driving war drums, low drone and tremolo fiddle (battle)
 *  - `musicIntro()`  3.5 s sting (drum roll + chord + fiddle flourish) that leads into the battle loop
 */
import { TAU, adEnv, asrEnv, bandpass, buffer, expInterp, foldLoop, highpass, limit, lowpass, midi, mix, noise, pluck, reverb, rng, softclip, tone, waves } from './dsp.mjs'

export const BPM = 104
const beat = 60 / BPM
const bar = beat * 4

// D dorian: D E F G A B C. Notes as MIDI.
const D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, C4 = 60, A3 = 57, C5 = 72, D5 = 74
const R = null // rest

/** 8-bar melody, `[midi, beats]`. Bars sum to 4 beats each. */
const PHRASE_A = [
  [A3, 0.5], [D4, 0.5], [D4, 0.5], [D4, 0.5], [F4, 0.5], [A4, 1], [G4, 0.5],
  [F4, 0.5], [E4, 0.5], [D4, 1], [C4, 0.5], [D4, 0.5], [E4, 1],
  [A3, 0.5], [C4, 0.5], [C4, 0.5], [C4, 0.5], [E4, 0.5], [G4, 1], [F4, 0.5],
  [E4, 0.5], [D4, 0.5], [C4, 1], [D4, 1.5], [R, 0.5],
]
const PHRASE_B = [
  [A4, 0.5], [A4, 0.5], [A4, 0.5], [G4, 0.5], [F4, 0.5], [E4, 1], [F4, 0.5],
  [G4, 0.5], [F4, 0.5], [E4, 1], [D4, 0.5], [E4, 0.5], [F4, 1],
  [G4, 0.5], [G4, 0.5], [G4, 0.5], [F4, 0.5], [E4, 0.5], [C4, 1], [E4, 0.5],
  [D4, 0.5], [C4, 0.5], [A3, 1], [D4, 1.5], [R, 0.5],
]
const PHRASE_B_END = [
  [A4, 0.5], [A4, 0.5], [A4, 0.5], [G4, 0.5], [F4, 0.5], [E4, 1], [F4, 0.5],
  [G4, 0.5], [F4, 0.5], [E4, 1], [D4, 0.5], [E4, 0.5], [F4, 1],
  [G4, 0.5], [A4, 0.5], [C5, 0.5], [A4, 0.5], [G4, 0.5], [F4, 1], [E4, 0.5],
  [D4, 0.5], [C4, 0.5], [A3, 1], [D4, 1.5], [R, 0.5],
]
export const MELODY = [...PHRASE_A, ...PHRASE_B, ...PHRASE_A, ...PHRASE_B_END] // 16 bars

const Dm = { root: 50, tones: [0, 3, 7] }, C = { root: 48, tones: [0, 4, 7] }, F = { root: 53, tones: [0, 4, 7] }, Am = { root: 57, tones: [0, 3, 7] }, G = { root: 55, tones: [0, 4, 7] }
/** One chord per bar for the 16-bar form. */
export const CHORDS = [Dm, Dm, C, Dm, F, Dm, C, Dm, Dm, Dm, C, Dm, F, G, C, Dm]

// ---------------------------------------------------------------- instruments

function fiddle(len, f, r, { tremolo = 0, bright = 1, vib = 0.006 } = {}) {
  const vibDepth = (t) => vib * Math.min(1, Math.max(0, (t - 0.12) / 0.2))
  const freq = (t) => f * (1 + vibDepth(t) * Math.sin(TAU * 5.6 * t))
  const amp = (t) => asrEnv(t, len, 0.045, 0.07) * (1 - tremolo * 0.5 * (1 + Math.sin(TAU * 10.5 * t)))
  const src = tone(len + 0.02, freq, amp, waves.saw)
  let body = lowpass(src, 3200 * bright)
  body = mixInto(body, bandpass(src, 290, 2.5), 0.5)
  body = mixInto(body, bandpass(src, 1050, 2.0), 0.3)
  body = mixInto(body, bandpass(src, 2400, 2.5), 0.18)
  const bow = highpass(noise(len + 0.02, (t) => amp(t) * 0.035, r), 1800)
  return mixInto(body, bow, 1)
}

function mixInto(a, b, g) {
  const out = Float32Array.from(a)
  for (let i = 0; i < out.length && i < b.length; i++) out[i] += b[i] * g
  return out
}

/** Musette accordion: three detuned reeds per note plus a sub-octave reed, lowpassed. */
function accordion(len, f, { stab = false, bright = 1 } = {}) {
  const out = buffer(len + 0.05)
  const amp = stab ? (t) => adEnv(t, 0.01, len, 2.5) : (t) => asrEnv(t, len, 0.04, 0.09) * (0.9 + 0.1 * Math.sin(TAU * 1.3 * t))
  for (const cents of [-9, 0, 9]) mix(out, tone(len, () => f * Math.pow(2, cents / 1200), amp, waves.softSaw), 0, 0.3)
  mix(out, tone(len, () => f / 2, amp, waves.square), 0, 0.12)
  return lowpass(out, 2400 * bright)
}

function bodhran(r, { low = 95, g = 1 } = {}) {
  const out = buffer(0.45)
  mix(out, softclip(tone(0.4, (t) => expInterp(low * 1.8, low * 0.6, Math.min(1, t / 0.12)), (t) => adEnv(t, 0.003, 0.35, 4)), 2), 0, 1)
  mix(out, lowpass(noise(0.06, (t) => adEnv(t, 0.001, 0.05, 4), r), 1800), 0, 0.5)
  return out.map((v) => v * g)
}

function warDrum(r) {
  const out = buffer(1.0)
  mix(out, softclip(tone(0.9, (t) => expInterp(110, 42, Math.min(1, t / 0.2)), (t) => adEnv(t, 0.003, 0.8, 3.5)), 2.5), 0, 1.2)
  mix(out, lowpass(noise(0.25, (t) => adEnv(t, 0.001, 0.2, 4), r), (t) => expInterp(3000, 250, Math.min(1, t / 0.2))), 0, 0.8)
  return out
}

function tambourine(r) {
  const out = buffer(0.12)
  for (let i = 0; i < 4; i++) mix(out, highpass(noise(0.05, (t) => adEnv(t, 0.001, 0.04, 4), r), 6500), i * 0.012, 0.4)
  return out
}

function stomp(r) {
  return lowpass(noise(0.09, (t) => adEnv(t, 0.002, 0.08, 4), r), 350)
}

// ---------------------------------------------------------------- arrangement

/**
 * Render a 32-bar pass (the 16-bar form twice) with the given layers.
 * `variant` 'menu' | 'battle' picks the instrumentation.
 */
function arrange(variant) {
  const r = rng(variant === 'menu' ? 2024 : 1718)
  const BARS = 32
  const LOOP = BARS * bar
  const out = buffer(LOOP + 3)
  const battle = variant === 'battle'

  // ---- melody (fiddle), second pass an octave up on the B phrases
  for (let pass = 0; pass < 2; pass++) {
    let t = pass * 16 * bar
    MELODY.forEach(([n, beats], i) => {
      const len = beats * beat
      if (n !== null) {
        const barIdx = Math.floor((t - pass * 16 * bar) / bar)
        const up = pass === 1 && barIdx % 8 >= 4 ? 12 : 0
        const f = midi(n + up)
        const g = battle ? 0.42 : 0.36
        mix(out, fiddle(len * 0.98, f, r, { tremolo: battle ? 0.35 : 0, bright: battle ? 1.15 : 1 }), t, g * (i % 2 ? 0.9 : 1))
        if (battle && pass === 1) mix(out, fiddle(len * 0.98, f * Math.pow(2, -5 / 12), r, { tremolo: 0.35 }), t, 0.18) // low harmony
      }
      t += len
    })
  }

  // ---- harmony (accordion) + bass + percussion per bar
  for (let b = 0; b < BARS; b++) {
    const chord = CHORDS[b % 16]
    const t0 = b * bar
    const notes = chord.tones.map((s) => chord.root + s)
    if (!battle) {
      // relaxed: sustained chord with a bellows pump on beats 1 and 3
      for (const n of notes) {
        mix(out, accordion(beat * 1.9, midi(n + 12)), t0, 0.16)
        mix(out, accordion(beat * 1.9, midi(n + 12)), t0 + 2 * beat, 0.14)
      }
      // off-beat chord chops (oom-pah)
      for (const bt of [1, 3]) for (const n of notes) mix(out, accordion(beat * 0.4, midi(n + 12), { stab: true }), t0 + bt * beat, 0.09)
    } else {
      // tense: stabbed chords on every off-beat 8th plus a sustained low drone on the root
      for (let e = 1; e < 8; e += 2) for (const n of notes) mix(out, accordion(beat * 0.3, midi(n + 12), { stab: true, bright: 1.2 }), t0 + e * beat * 0.5, 0.1)
      mix(out, accordion(bar * 1.02, midi(chord.root - 12), { bright: 0.6 }), t0, 0.22)
      mix(out, accordion(bar * 1.02, midi(chord.root - 5), { bright: 0.6 }), t0, 0.1)
    }

    // bass: pizzicato cello root/fifth
    mix(out, pluck(1.0, midi(chord.root - 12), r, { brightness: 0.3, decay: 0.995 }), t0, battle ? 0.55 : 0.5)
    mix(out, pluck(1.0, midi(chord.root - 5), r, { brightness: 0.3, decay: 0.995 }), t0 + 2 * beat, 0.42)
    if (battle || b % 2 === 1) mix(out, pluck(0.6, midi(chord.root - 12), r, { brightness: 0.3, decay: 0.994 }), t0 + 3.5 * beat, 0.35)

    // percussion
    if (!battle) {
      mix(out, bodhran(r), t0, 0.55)
      mix(out, bodhran(r, { low: 120, g: 0.6 }), t0 + 1.5 * beat, 0.4)
      mix(out, bodhran(r), t0 + 2 * beat, 0.5)
      mix(out, bodhran(r, { low: 120, g: 0.6 }), t0 + 3.5 * beat, 0.35)
      for (const bt of [1, 3]) mix(out, stomp(r), t0 + bt * beat, 0.7)
      for (let e = 0; e < 8; e++) mix(out, tambourine(r), t0 + e * beat * 0.5, e % 2 ? 0.16 : 0.08)
    } else {
      // war drums: boom on 1 and 3, double hit on "2 &" and "4 &", rolling 16ths in the last bar of each 8
      mix(out, warDrum(r), t0, 0.9)
      mix(out, warDrum(r), t0 + 2 * beat, 0.8)
      for (const bt of [1, 1.5, 3, 3.5]) mix(out, bodhran(r, { low: 85 }), t0 + bt * beat, 0.6)
      for (let e = 0; e < 16; e++) mix(out, tambourine(r), t0 + e * beat * 0.25, e % 4 === 2 ? 0.16 : 0.07)
      if (b % 8 === 7) for (let s = 0; s < 8; s++) mix(out, bodhran(r, { low: 100, g: 0.5 + s * 0.06 }), t0 + 2 * beat + s * beat * 0.25, 0.6)
      for (const bt of [1, 3]) mix(out, stomp(r), t0 + bt * beat, 0.9)
    }
  }

  const wet = reverb(out, { mixLevel: battle ? 0.14 : 0.18, decay: 0.72, tail: 0, size: 1.4, damp: 0.35 })
  return limit(foldLoop(wet, LOOP), 0.92, 1.15)
}

export function musicMenu() {
  return arrange('menu')
}

export function musicBattle() {
  return arrange('battle')
}

/** Sting: drum roll crescendo, accordion Dm stab, fiddle run up to a held A, crash on the downbeat. */
export function musicIntro() {
  const r = rng(99)
  const out = buffer(4.2)
  for (let i = 0; i < 16; i++) mix(out, bodhran(r, { low: 100, g: 0.35 + i * 0.045 }), i * beat * 0.25, 0.7)
  const hit = 16 * beat * 0.25
  mix(out, warDrum(r), hit, 1.1)
  mix(out, warDrum(r), hit + beat, 0.9)
  for (const n of [50, 53, 57, 62]) mix(out, accordion(beat * 2.2, midi(n + 12), { bright: 1.1 }), hit, 0.16)
  mix(out, accordion(beat * 2.2, midi(38), { bright: 0.6 }), hit, 0.25)
  const run = [D4, E4, F4, G4, A4, C5, D5]
  run.forEach((n, i) => mix(out, fiddle(beat * 0.27, midi(n), r), hit - beat * 0.25 * (run.length - i) + beat * 0.01, 0.3))
  mix(out, fiddle(beat * 2.4, midi(A4 + 12), r, { tremolo: 0.3, bright: 1.1 }), hit, 0.42)
  mix(out, pluck(1.5, midi(38), r, { brightness: 0.3, decay: 0.996 }), hit, 0.6)
  return limit(reverb(out, { mixLevel: 0.2, decay: 0.78, tail: 0.8, size: 1.6 }), 0.95, 1.15)
}
