#!/usr/bin/env node
/**
 * Procedurally generates every sound shipped in public/assets/audio.
 * Pure Node DSP (no samples, no npm deps); ffmpeg on PATH is used to encode OGG + MP3.
 *
 *   node scripts/generate-audio.mjs            # regenerate everything
 *   node scripts/generate-audio.mjs --wav      # also keep the WAV intermediates next to the encoded files
 *
 * Output is deterministic (seeded RNG) so re-running produces identical files.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 44100
const OUT_DIR = resolve(fileURLToPath(import.meta.url), '../../public/assets/audio')
const KEEP_WAV = process.argv.includes('--wav')
const TAU = Math.PI * 2

// ---------------------------------------------------------------- utilities

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sec = (s) => Math.round(s * SR)
const buffer = (seconds) => new Float32Array(sec(seconds))
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const expInterp = (a, b, t) => a * Math.pow(b / a, t)
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12)

/** Add `src` into `dst` starting at `at` seconds. */
function mix(dst, src, at = 0, gain = 1) {
  const start = sec(at)
  for (let i = 0; i < src.length && start + i < dst.length; i++) dst[start + i] += src[i] * gain
  return dst
}

/** Exponential-ish decay envelope with a short linear attack. */
function adEnv(t, attack, decay, curve = 4) {
  if (t < 0) return 0
  if (t < attack) return t / attack
  const d = (t - attack) / decay
  return d >= 1 ? 0 : Math.exp(-curve * d) * (1 - d)
}

/** Render a waveform. `freq(t)` in Hz, `amp(t)` 0..1, `wave(phase 0..1)`. */
function tone(duration, freq, amp, wave = (p) => Math.sin(TAU * p)) {
  const out = buffer(duration)
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    out[i] = wave(phase) * amp(t)
    phase = (phase + freq(t) / SR) % 1
  }
  return out
}

const waves = {
  sine: (p) => Math.sin(TAU * p),
  tri: (p) => 1 - 4 * Math.abs(Math.round(p - 0.25) - (p - 0.25)),
  saw: (p) => 2 * p - 1,
  square: (p) => (p < 0.5 ? 1 : -1),
  /** Marimba: strong fundamental plus the 4th partial that gives bars their "woody" ring. */
  marimba: (p) => Math.sin(TAU * p) + 0.35 * Math.sin(TAU * 4 * p) + 0.08 * Math.sin(TAU * 10 * p),
  /** Soft brass-ish: a few decaying harmonics. */
  brass: (p) => {
    let v = 0
    for (let h = 1; h <= 6; h++) v += Math.sin(TAU * h * p) / h
    return v * 0.6
  },
}

function noise(duration, amp, random) {
  const out = buffer(duration)
  for (let i = 0; i < out.length; i++) out[i] = (random() * 2 - 1) * amp(i / SR)
  return out
}

/** One-pole low-pass; `cutoff` may be a number or a function of time. */
function lowpass(src, cutoff, passes = 1) {
  let out = src
  for (let p = 0; p < passes; p++) {
    const res = new Float32Array(out.length)
    let y = 0
    for (let i = 0; i < out.length; i++) {
      const fc = typeof cutoff === 'function' ? cutoff(i / SR) : cutoff
      const a = 1 - Math.exp((-TAU * fc) / SR)
      y += a * (out[i] - y)
      res[i] = y
    }
    out = res
  }
  return out
}

function highpass(src, cutoff) {
  const out = new Float32Array(src.length)
  let y = 0
  for (let i = 0; i < src.length; i++) {
    const fc = typeof cutoff === 'function' ? cutoff(i / SR) : cutoff
    const a = 1 - Math.exp((-TAU * fc) / SR)
    y += a * (src[i] - y)
    out[i] = src[i] - y
  }
  return out
}

/** Biquad band-pass with a time-varying centre frequency (coefficients refreshed every 32 samples). */
function bandpass(src, center, q = 1.5) {
  const out = new Float32Array(src.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0
  for (let i = 0; i < src.length; i++) {
    if (i % 32 === 0) {
      const fc = clamp(typeof center === 'function' ? center(i / SR) : center, 20, SR / 2 - 100)
      const w0 = (TAU * fc) / SR
      const alpha = Math.sin(w0) / (2 * q)
      const a0 = 1 + alpha
      b0 = alpha / a0
      b1 = 0
      b2 = -alpha / a0
      a1 = (-2 * Math.cos(w0)) / a0
      a2 = (1 - alpha) / a0
    }
    const x0 = src[i]
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1; x1 = x0; y2 = y1; y1 = y0
    out[i] = y0
  }
  return out
}

/** Karplus-Strong plucked string. `brightness` 0..1 keeps more highs (nylon ~0.5, pizzicato ~0.3). */
function pluck(duration, freq, random, { brightness = 0.5, decay = 0.996, gain = 1 } = {}) {
  const out = buffer(duration)
  const period = Math.max(2, Math.round(SR / freq))
  const line = new Float32Array(period)
  for (let i = 0; i < period; i++) line[i] = random() * 2 - 1
  // Pre-filter the excitation so very high strings don't sound like white noise.
  let prev = 0
  for (let i = 0; i < period; i++) {
    prev = prev * (1 - brightness) + line[i] * brightness
    line[i] = prev
  }
  let idx = 0
  let last = 0
  for (let i = 0; i < out.length; i++) {
    const cur = line[idx]
    const next = line[(idx + 1) % period]
    const v = decay * (0.5 * (cur + next) * (1 - brightness * 0.3) + last * brightness * 0.3)
    line[idx] = v
    last = v
    out[i] = cur * gain
    idx = (idx + 1) % period
  }
  return out
}

/** Schroeder-style reverb: 4 parallel combs into 2 allpasses. */
function reverb(src, { mixLevel = 0.25, decay = 0.75, tail = 1.2 } = {}) {
  const out = new Float32Array(src.length + sec(tail))
  const combs = [1116, 1188, 1277, 1356].map((n) => ({ buf: new Float32Array(n), i: 0 }))
  const allpasses = [556, 441].map((n) => ({ buf: new Float32Array(n), i: 0 }))
  for (let i = 0; i < out.length; i++) {
    const x = i < src.length ? src[i] : 0
    let wet = 0
    for (const c of combs) {
      const y = c.buf[c.i]
      c.buf[c.i] = x + y * decay
      c.i = (c.i + 1) % c.buf.length
      wet += y
    }
    wet *= 0.25
    for (const a of allpasses) {
      const bufOut = a.buf[a.i]
      const v = wet + bufOut * 0.5
      a.buf[a.i] = v
      a.i = (a.i + 1) % a.buf.length
      wet = bufOut - 0.5 * v
    }
    out[i] = x * (1 - mixLevel) + wet * mixLevel
  }
  return out
}

function softclip(src, drive = 1.5) {
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = Math.tanh(src[i] * drive) / Math.tanh(drive)
  return out
}

function normalize(src, peak = 0.9) {
  let max = 0
  for (const v of src) max = Math.max(max, Math.abs(v))
  if (max === 0) return src
  const g = peak / max
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = src[i] * g
  return out
}

function fadeEdges(src, inSec = 0.002, outSec = 0.02) {
  const out = Float32Array.from(src)
  const n1 = sec(inSec), n2 = sec(outSec)
  for (let i = 0; i < n1 && i < out.length; i++) out[i] *= i / n1
  for (let i = 0; i < n2 && i < out.length; i++) out[out.length - 1 - i] *= i / n2
  return out
}

/** Trim trailing near-silence so SFX files stay tiny. */
function trimTail(src, threshold = 0.002, pad = 0.03) {
  let end = src.length - 1
  while (end > 0 && Math.abs(src[end]) < threshold) end--
  return src.subarray(0, Math.min(src.length, end + sec(pad)))
}

/**
 * Make a seamless loop: everything rendered after `loopSeconds` (ringing tails) is folded back
 * onto the start. With `crossfade`, the head is faded in while the tail fades out (for continuous beds).
 */
function foldLoop(src, loopSeconds, crossfade = false) {
  const n = sec(loopSeconds)
  const out = Float32Array.from(src.subarray(0, n))
  const tail = src.length - n
  for (let i = 0; i < tail && i < n; i++) {
    const t = i / tail
    if (crossfade) {
      out[i] = out[i] * Math.sin((t * Math.PI) / 2) + src[n + i] * Math.cos((t * Math.PI) / 2)
    } else {
      out[i] += src[n + i]
    }
  }
  return out
}

function wavBytes(samples) {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(clamp(samples[i], -1, 1) * 32767), i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(SR, 24)
  header.writeUInt32LE(SR * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

// ---------------------------------------------------------------- SFX

function fire(seed) {
  const r = rng(seed)
  const out = buffer(0.9)
  const pitch = 0.9 + r() * 0.25
  // whoosh: filtered noise sweeping up then down
  const whoosh = bandpass(
    noise(0.55, (t) => adEnv(t, 0.12, 0.4, 3), r),
    (t) => pitch * (500 + 2600 * Math.sin(Math.min(1, t / 0.45) * Math.PI)),
    1.2,
  )
  mix(out, whoosh, 0, 0.9)
  // pebble launch thump
  const thump = tone(0.35, (t) => expInterp(150, 42, Math.min(1, t / 0.3)) * pitch, (t) => adEnv(t, 0.004, 0.3, 5))
  mix(out, softclip(thump, 2), 0.1, 0.9)
  // tiny click of the sling releasing
  mix(out, highpass(noise(0.02, (t) => adEnv(t, 0.001, 0.02), r), 3000), 0.09, 0.4)
  return normalize(fadeEdges(trimTail(reverb(out, { mixLevel: 0.12, tail: 0.3 }))), 0.85)
}

function hit(seed) {
  const r = rng(seed)
  const out = buffer(1.6)
  const size = 0.9 + r() * 0.2
  // low boom
  const boom = tone(1.0, (t) => expInterp(95, 30, Math.min(1, t / 0.6)) / size, (t) => adEnv(t, 0.003, 0.9, 4))
  mix(out, softclip(boom, 2.5), 0, 1)
  // explosion body: noise with closing low-pass
  const body = lowpass(noise(0.8, (t) => adEnv(t, 0.002, 0.6, 4), r), (t) => expInterp(4500, 180, Math.min(1, t / 0.7)))
  mix(out, body, 0, 1.2)
  // crackle: random impulses fading out
  for (let i = 0; i < 45; i++) {
    const at = 0.05 + r() * 1.1
    const crack = bandpass(noise(0.012, (t) => adEnv(t, 0.0005, 0.01), r), 1800 + r() * 3500, 2)
    mix(out, crack, at, 1.6 * (1 - at / 1.3) * (0.5 + r()))
  }
  return normalize(fadeEdges(trimTail(reverb(out, { mixLevel: 0.2, tail: 0.5 }))), 0.95)
}

function miss(seed) {
  const r = rng(seed)
  const out = buffer(1.1)
  const size = 0.9 + r() * 0.2
  // classic water "bloop": fast rising sine
  const bloop = tone(0.16, (t) => expInterp(260, 950, Math.min(1, t / 0.14)) * size, (t) => adEnv(t, 0.005, 0.15, 3))
  mix(out, bloop, 0.015, 0.7)
  // splash: band-passed noise
  const splash = bandpass(noise(0.7, (t) => adEnv(t, 0.015, 0.55, 3.5), r), (t) => (2600 - 1400 * Math.min(1, t / 0.6)) * size, 0.9)
  mix(out, lowpass(splash, 6000), 0, 1)
  // droplets falling back
  const drops = 3 + Math.floor(r() * 3)
  for (let i = 0; i < drops; i++) {
    const at = 0.2 + r() * 0.55
    const f = 700 + r() * 900
    const drop = tone(0.07, (t) => expInterp(f, f * 1.9, Math.min(1, t / 0.06)), (t) => adEnv(t, 0.003, 0.06, 3))
    mix(out, drop, at, 0.22 * (1 - at / 1.1))
  }
  return normalize(fadeEdges(trimTail(reverb(out, { mixLevel: 0.15, tail: 0.4 }))), 0.85)
}

function sunk() {
  const r = rng(707)
  const out = buffer(3.0)
  // deep rumble
  const rumble = lowpass(noise(2.2, (t) => adEnv(t, 0.15, 2.0, 2.5), r), 110, 2)
  mix(out, rumble, 0, 3.5)
  const sub = tone(2.0, (t) => 44 + 6 * Math.sin(TAU * 1.7 * t), (t) => adEnv(t, 0.1, 1.8, 3))
  mix(out, sub, 0.05, 0.6)
  // bubbles rising
  for (let i = 0; i < 14; i++) {
    const at = 0.35 + r() * 1.7
    const f = 280 + r() * 700
    const b = tone(0.09, (t) => expInterp(f, f * 1.7, Math.min(1, t / 0.08)), (t) => adEnv(t, 0.004, 0.08, 3))
    mix(out, b, at, 0.25)
  }
  // sad otter squeak: descending glide with vibrato
  const squeak = tone(
    0.6,
    (t) => expInterp(1350, 620, Math.min(1, t / 0.55)) * (1 + 0.025 * Math.sin(TAU * 7 * t)),
    (t) => adEnv(t, 0.04, 0.55, 2.5),
    (p) => Math.sin(TAU * p) + 0.5 * Math.sin(TAU * 2 * p) + 0.25 * Math.sin(TAU * 3 * p),
  )
  mix(out, bandpass(squeak, (t) => 1500 - 600 * Math.min(1, t / 0.5), 1.1), 1.25, 0.9)
  return normalize(fadeEdges(trimTail(reverb(out, { mixLevel: 0.25, tail: 0.8 }))), 0.95)
}

function victory() {
  const r = rng(99)
  const out = buffer(3.6)
  const stab = (note, at, len, gain = 0.5) => {
    const n = lowpass(
      tone(len, () => midi(note), (t) => adEnv(t, 0.01, len * 0.95, 2.5), waves.brass),
      (t) => 3500 * adEnv(t, 0.01, len, 1) + 600,
    )
    mix(out, n, at, gain)
  }
  // fanfare: C5 E5 G5 . C6 (ta-ta-ta-daaa) then a bright chord
  const q = 0.14
  stab(72, 0, q)
  stab(76, q, q)
  stab(79, q * 2, q)
  stab(84, q * 3, 0.7, 0.55)
  for (const n of [72, 76, 79, 84, 88]) stab(n, 0.9, 1.6, 0.28)
  // marimba sparkle
  for (const [i, n] of [84, 88, 91, 96].entries()) {
    mix(out, tone(0.5, () => midi(n), (t) => adEnv(t, 0.002, 0.45, 5), waves.marimba), 0.95 + i * 0.09, 0.22)
  }
  // happy otter chirps
  for (let i = 0; i < 3; i++) {
    const f = 1500 + i * 250
    const chirp = tone(0.11, (t) => expInterp(f, f * 1.9, Math.min(1, t / 0.1)), (t) => adEnv(t, 0.01, 0.1, 2), (p) => Math.sin(TAU * p) + 0.3 * Math.sin(TAU * 2 * p))
    mix(out, chirp, 1.9 + i * 0.16 + r() * 0.01, 0.35)
  }
  return normalize(fadeEdges(trimTail(reverb(out, { mixLevel: 0.3, decay: 0.8, tail: 1.2 }))), 0.95)
}

function defeat() {
  const out = buffer(2.6)
  const womp = (note, at, len, bend = 0.82) => {
    const n = lowpass(
      tone(len, (t) => midi(note) * expInterp(1, bend, Math.min(1, t / len)), (t) => adEnv(t, 0.02, len, 2), waves.saw),
      (t) => expInterp(2200, 150, Math.min(1, t / len)),
    )
    mix(out, n, at, 0.6)
    mix(out, tone(len, (t) => (midi(note) / 2) * expInterp(1, bend, Math.min(1, t / len)), (t) => adEnv(t, 0.02, len, 2)), at, 0.4)
  }
  womp(57, 0, 0.5)
  womp(53, 0.45, 0.5)
  womp(50, 0.9, 0.5)
  womp(45, 1.35, 1.1, 0.7)
  return normalize(fadeEdges(trimTail(reverb(out, { mixLevel: 0.2, tail: 0.6 }))), 0.9)
}

function uiClick() {
  const r = rng(5)
  const out = buffer(0.15)
  mix(out, tone(0.08, (t) => expInterp(950, 380, Math.min(1, t / 0.07)), (t) => adEnv(t, 0.002, 0.07, 4)), 0, 0.8)
  mix(out, highpass(noise(0.01, (t) => adEnv(t, 0.0005, 0.008), r), 4000), 0, 0.25)
  return normalize(fadeEdges(trimTail(out)), 0.6)
}

function place() {
  const r = rng(11)
  const out = buffer(0.4)
  // wooden body: two quick-decaying resonances
  mix(out, tone(0.2, () => 190, (t) => adEnv(t, 0.001, 0.14, 6)), 0, 0.8)
  mix(out, tone(0.12, () => 520, (t) => adEnv(t, 0.001, 0.08, 7)), 0, 0.35)
  // knock transient
  mix(out, bandpass(noise(0.03, (t) => adEnv(t, 0.0005, 0.025, 3), r), 1300, 1.2), 0, 1.5)
  // low thud
  mix(out, tone(0.18, (t) => expInterp(110, 70, Math.min(1, t / 0.15)), (t) => adEnv(t, 0.002, 0.15, 5)), 0.003, 0.6)
  return normalize(fadeEdges(trimTail(out)), 0.8)
}

// ---------------------------------------------------------------- music

/**
 * 64-second seamless loop at 120 BPM, C major: ukulele strums (Karplus-Strong), marimba melody,
 * pizzicato bass, shaker + woodblock. Light and playful, like a sunny afternoon on the river.
 */
function music() {
  const r = rng(2024)
  const BPM = 120
  const beat = 60 / BPM
  const bar = beat * 4
  const BARS = 32
  const LOOP = BARS * bar
  const out = buffer(LOOP + 3)

  // chord progression (midi roots + quality), 16 bars repeated with a turnaround
  const C = { root: 60, tones: [0, 4, 7] }
  const G = { root: 67, tones: [0, 4, 7] }
  const Am = { root: 69, tones: [0, 3, 7] }
  const F = { root: 65, tones: [0, 4, 7] }
  const Dm = { root: 62, tones: [0, 3, 7] }
  const Em = { root: 64, tones: [0, 3, 7] }
  const phrase = [C, G, Am, F, C, G, F, G, C, Em, Am, F, Dm, G, C, C]
  const chords = [...phrase, ...phrase]

  // ukulele voicings (GCEA tuning, C4-ish register)
  const uke = (chord) => chord.tones.map((t) => chord.root + t).concat([chord.root + 12])
  const strumPattern = [
    { at: 0, dir: 1 }, { at: 1, dir: 1 }, { at: 1.5, dir: -1 }, { at: 2.5, dir: -1 }, { at: 3, dir: 1 }, { at: 3.5, dir: -1 },
  ]

  for (let b = 0; b < BARS; b++) {
    const chord = chords[b]
    const t0 = b * bar
    const notes = uke(chord)
    for (const s of strumPattern) {
      const ordered = s.dir > 0 ? notes : [...notes].reverse()
      const accent = s.at % 1 === 0 ? 1 : 0.7
      ordered.forEach((n, i) => {
        const str = pluck(1.2, midi(n), r, { brightness: 0.55, decay: 0.9965 })
        mix(out, str, t0 + s.at * beat + i * 0.011, 0.09 * accent)
      })
    }
    // pizzicato bass: root on 1, fifth on 3, occasional octave pickup on 4.5
    const bassRoot = chord.root - 24
    mix(out, pluck(0.9, midi(bassRoot), r, { brightness: 0.3, decay: 0.995 }), t0, 0.5)
    mix(out, pluck(0.9, midi(bassRoot + 7), r, { brightness: 0.3, decay: 0.995 }), t0 + 2 * beat, 0.4)
    if (b % 4 === 3) mix(out, pluck(0.5, midi(bassRoot + 12), r, { brightness: 0.3, decay: 0.994 }), t0 + 3.5 * beat, 0.3)

    // percussion: shaker on 8ths (accent off-beats), woodblock on 2 and 4
    for (let e = 0; e < 8; e++) {
      const sh = highpass(noise(0.06, (t) => adEnv(t, 0.004, 0.05, 4), r), 6000)
      mix(out, sh, t0 + e * beat * 0.5, e % 2 ? 0.075 : 0.045)
    }
    for (const bt of [1, 3]) {
      const wb = tone(0.08, () => 1100, (t) => adEnv(t, 0.001, 0.06, 6))
      mix(out, wb, t0 + bt * beat, 0.08)
    }
  }

  // marimba melody: chord tones on strong 8ths, stepwise scale motion otherwise, rests sometimes.
  const scale = [0, 2, 4, 5, 7, 9, 11]
  let degree = 7 // E5-ish start (index into extended scale)
  const degToMidi = (d) => 60 + 12 * Math.floor(d / 7) + scale[((d % 7) + 7) % 7]
  const melodyRng = rng(777)
  for (let b = 0; b < BARS; b++) {
    const chord = chords[b]
    const chordPcs = chord.tones.map((t) => (chord.root + t) % 12)
    // second half of each 16-bar phrase is busier; bars 15/31 rest to breathe
    const density = b % 16 === 15 ? 0.2 : b % 16 >= 8 ? 0.75 : 0.55
    for (let e = 0; e < 8; e++) {
      if (melodyRng() > density && e !== 0) continue
      const strong = e % 2 === 0
      let candidates = []
      for (const step of [-2, -1, 0, 1, 2]) {
        const d = degree + step
        const m = degToMidi(d)
        if (m < 67 || m > 88) continue
        const isChord = chordPcs.includes(m % 12)
        if (strong && !isChord) continue
        candidates.push({ d, w: step === 0 ? 0.6 : 1 / Math.abs(step) + (isChord ? 0.3 : 0) })
      }
      if (!candidates.length) candidates = [{ d: degree, w: 1 }]
      let pick = melodyRng() * candidates.reduce((s, c) => s + c.w, 0)
      for (const c of candidates) {
        pick -= c.w
        if (pick <= 0) { degree = c.d; break }
      }
      const len = strong && e === 0 ? 0.9 : 0.55
      const m = tone(len, () => midi(degToMidi(degree)), (t) => adEnv(t, 0.002, len * 0.95, 5), waves.marimba)
      mix(out, m, b * bar + e * beat * 0.5, strong ? 0.26 : 0.19)
    }
  }

  const looped = foldLoop(reverb(out, { mixLevel: 0.18, decay: 0.7, tail: 0 }), LOOP)
  return normalize(looped, 0.9)
}

// ---------------------------------------------------------------- ambience

/** 40-second seamless loop: lapping river water with distant birds. */
function ambience() {
  const r = rng(4242)
  const LOOP = 40
  const XF = 3
  const out = buffer(LOOP + XF)

  // continuous water bed: low-passed noise with slow multi-LFO swell
  const bed = lowpass(
    noise(LOOP + XF, (t) => 0.55 + 0.25 * Math.sin(TAU * 0.11 * t) + 0.15 * Math.sin(TAU * 0.23 * t + 1) + 0.1 * Math.sin(TAU * 0.05 * t + 2), r),
    (t) => 420 + 160 * Math.sin(TAU * 0.09 * t),
    2,
  )
  mix(out, bed, 0, 1.4)
  // brighter ripple layer
  mix(out, bandpass(noise(LOOP + XF, (t) => 0.4 + 0.3 * Math.sin(TAU * 0.17 * t + 0.5), r), 1400, 0.8), 0, 0.12)

  // individual laps / small waves
  let t = 0.5
  while (t < LOOP) {
    const len = 0.9 + r() * 0.9
    const lap = bandpass(noise(len, (x) => adEnv(x, len * 0.35, len * 0.65, 2), r), (x) => 900 + 1400 * (x / len), 0.9)
    mix(out, lowpass(lap, 3500), t, 0.22 + r() * 0.12)
    t += 1.6 + r() * 2.4
  }

  // distant birds: short FM chirp phrases
  const chirp = (f0, f1, len) => tone(len, (x) => expInterp(f0, f1, Math.min(1, x / len)), (x) => adEnv(x, len * 0.25, len * 0.75, 2))
  t = 2
  while (t < LOOP - 1) {
    const kind = Math.floor(r() * 3)
    const n = 2 + Math.floor(r() * 4)
    const base = 2200 + r() * 1800
    for (let i = 0; i < n; i++) {
      const f0 = base * (kind === 1 ? 1.25 : 1)
      const f1 = kind === 2 ? f0 * 0.75 : f0 * 1.35
      const len = kind === 0 ? 0.07 : 0.11
      mix(out, chirp(f0, f1, len), t + i * (len + 0.05 + r() * 0.04), 0.045 + r() * 0.03)
    }
    t += 3 + r() * 5
  }

  return normalize(foldLoop(out, LOOP, true), 0.7)
}

// ---------------------------------------------------------------- render + encode

const SOUNDS = {
  'fire-1': () => fire(1), 'fire-2': () => fire(2), 'fire-3': () => fire(3),
  'hit-1': () => hit(21), 'hit-2': () => hit(22), 'hit-3': () => hit(23),
  'miss-1': () => miss(31), 'miss-2': () => miss(32), 'miss-3': () => miss(33),
  sunk, victory, defeat, 'ui-click': uiClick, place,
}
const LOOPS = { music, ambience }

function encode(name, samples, tmp, { oggQ, mp3Kbps }) {
  const wav = join(tmp, `${name}.wav`)
  writeFileSync(wav, wavBytes(samples))
  if (KEEP_WAV) writeFileSync(join(OUT_DIR, `${name}.wav`), wavBytes(samples))
  const ogg = join(OUT_DIR, `${name}.ogg`)
  const mp3 = join(OUT_DIR, `${name}.mp3`)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis', '-q:a', String(oggQ), ogg])
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', `${mp3Kbps}k`, mp3])
  return { name, seconds: samples.length / SR, ogg: statSync(ogg).size, mp3: statSync(mp3).size }
}

mkdirSync(OUT_DIR, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), 'battleship-audio-'))
const report = []
try {
  for (const [name, make] of Object.entries(SOUNDS)) {
    process.stdout.write(`rendering ${name}... `)
    report.push(encode(name, make(), tmp, { oggQ: 3, mp3Kbps: 96 }))
    console.log('ok')
  }
  for (const [name, make] of Object.entries(LOOPS)) {
    process.stdout.write(`rendering ${name}... `)
    report.push(encode(name, make(), tmp, { oggQ: name === 'music' ? 2 : 1, mp3Kbps: name === 'music' ? 80 : 64 }))
    console.log('ok')
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`
console.log('\n| file | length | ogg | mp3 |\n| --- | --- | --- | --- |')
let total = 0
for (const row of report) {
  total += row.ogg + row.mp3
  console.log(`| ${row.name} | ${row.seconds.toFixed(2)} s | ${kb(row.ogg)} | ${kb(row.mp3)} |`)
}
console.log(`\nTotal (ogg + mp3): ${kb(total)}`)
