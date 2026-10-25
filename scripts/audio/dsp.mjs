/**
 * Tiny offline DSP toolkit shared by the audio generators (pure Node, no deps).
 * Everything works on mono Float32Array sample buffers at SR Hz.
 */
export const SR = 44100
export const TAU = Math.PI * 2

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const sec = (s) => Math.round(s * SR)
export const buffer = (seconds) => new Float32Array(sec(seconds))
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
export const lerp = (a, b, t) => a + (b - a) * t
export const expInterp = (a, b, t) => a * Math.pow(b / a, t)
export const midi = (n) => 440 * Math.pow(2, (n - 69) / 12)
export const dB = (db) => Math.pow(10, db / 20)

/** Add `src` into `dst` starting at `at` seconds. */
export function mix(dst, src, at = 0, gain = 1) {
  const start = sec(at)
  for (let i = 0; i < src.length && start + i < dst.length; i++) if (start + i >= 0) dst[start + i] += src[i] * gain
  return dst
}

/** Multiply two buffers sample-wise (ring modulation / amplitude shaping). */
export function multiply(a, b) {
  const out = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] * (b[i % b.length] ?? 0)
  return out
}

export function gain(src, g) {
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = src[i] * (typeof g === 'function' ? g(i / SR) : g)
  return out
}

/** Exponential-ish decay envelope with a short linear attack. */
export function adEnv(t, attack, decay, curve = 4) {
  if (t < 0) return 0
  if (t < attack) return t / attack
  const d = (t - attack) / decay
  return d >= 1 ? 0 : Math.exp(-curve * d) * (1 - d)
}

/** Attack / sustain / release envelope for a note of `len` seconds. */
export function asrEnv(t, len, attack = 0.02, release = 0.08) {
  if (t < 0 || t > len) return 0
  const a = attack > 0 ? Math.min(1, t / attack) : 1
  const r = release > 0 ? Math.min(1, (len - t) / release) : 1
  return Math.min(a, r)
}

/** Piecewise-linear envelope from `[time, value]` points. */
export function envelope(points) {
  return (t) => {
    if (t <= points[0][0]) return points[0][1]
    for (let i = 1; i < points.length; i++) {
      const [t1, v1] = points[i]
      if (t <= t1) {
        const [t0, v0] = points[i - 1]
        return lerp(v0, v1, (t - t0) / (t1 - t0))
      }
    }
    return points[points.length - 1][1]
  }
}

/** Render a waveform. `freq(t)` in Hz, `amp(t)` 0..1, `wave(phase 0..1)`. */
export function tone(duration, freq, amp, wave = (p) => Math.sin(TAU * p)) {
  const out = buffer(duration)
  let phase = 0
  for (let i = 0; i < out.length; i++) {
    const t = i / SR
    out[i] = wave(phase) * amp(t)
    phase = (phase + freq(t) / SR) % 1
  }
  return out
}

export const waves = {
  sine: (p) => Math.sin(TAU * p),
  tri: (p) => 1 - 4 * Math.abs(Math.round(p - 0.25) - (p - 0.25)),
  saw: (p) => 2 * p - 1,
  square: (p) => (p < 0.5 ? 1 : -1),
  pulse: (width) => (p) => (p < width ? 1 : -1),
  /** Band-limited-ish saw: 12 harmonics. */
  softSaw: (p) => {
    let v = 0
    for (let h = 1; h <= 12; h++) v += Math.sin(TAU * h * p) / h
    return v * 0.5
  },
  brass: (p) => {
    let v = 0
    for (let h = 1; h <= 6; h++) v += Math.sin(TAU * h * p) / h
    return v * 0.6
  },
}

export function noise(duration, amp, random) {
  const out = buffer(duration)
  for (let i = 0; i < out.length; i++) out[i] = (random() * 2 - 1) * (typeof amp === 'function' ? amp(i / SR) : amp)
  return out
}

/** Pink-ish noise (Paul Kellet's filter) — far more natural than white for wind, surf and fire. */
export function pinkNoise(duration, amp, random) {
  const out = buffer(duration)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < out.length; i++) {
    const white = random() * 2 - 1
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.969 * b2 + white * 0.153852
    b3 = 0.8665 * b3 + white * 0.3104856
    b4 = 0.55 * b4 + white * 0.5329522
    b5 = -0.7616 * b5 - white * 0.016898
    const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
    b6 = white * 0.115926
    out[i] = pink * (typeof amp === 'function' ? amp(i / SR) : amp)
  }
  return out
}

/** One-pole low-pass; `cutoff` may be a number or a function of time. */
export function lowpass(src, cutoff, passes = 1) {
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

export function highpass(src, cutoff, passes = 1) {
  let out = src
  for (let p = 0; p < passes; p++) {
    const res = new Float32Array(out.length)
    let y = 0
    for (let i = 0; i < out.length; i++) {
      const fc = typeof cutoff === 'function' ? cutoff(i / SR) : cutoff
      const a = 1 - Math.exp((-TAU * fc) / SR)
      y += a * (out[i] - y)
      res[i] = out[i] - y
    }
    out = res
  }
  return out
}

/** Biquad band-pass with a time-varying centre frequency (coefficients refreshed every 32 samples). */
export function bandpass(src, center, q = 1.5) {
  const out = new Float32Array(src.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  let b0 = 0, b2 = 0, a1 = 0, a2 = 0
  for (let i = 0; i < src.length; i++) {
    if (i % 32 === 0) {
      const fc = clamp(typeof center === 'function' ? center(i / SR) : center, 20, SR / 2 - 100)
      const w0 = (TAU * fc) / SR
      const alpha = Math.sin(w0) / (2 * q)
      const a0 = 1 + alpha
      b0 = alpha / a0
      b2 = -alpha / a0
      a1 = (-2 * Math.cos(w0)) / a0
      a2 = (1 - alpha) / a0
    }
    const x0 = src[i]
    const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1; x1 = x0; y2 = y1; y1 = y0
    out[i] = y0
  }
  return out
}

/** Resonant 2-pole low-pass (Chamberlin SVF). `res` 0..1. */
export function resonantLowpass(src, cutoff, res = 0.3) {
  const out = new Float32Array(src.length)
  let low = 0, band = 0
  const damp = 2 * (1 - res)
  for (let i = 0; i < src.length; i++) {
    const fc = clamp(typeof cutoff === 'function' ? cutoff(i / SR) : cutoff, 20, SR / 4)
    const f = 2 * Math.sin((Math.PI * fc) / SR)
    const high = src[i] - low - damp * band
    band += f * high
    low += f * band
    out[i] = low
  }
  return out
}

/** Feedback comb filter: adds a pitched resonance at `freq` (wood/metal ring). */
export function comb(src, freq, feedback = 0.9, damp = 0.3) {
  const n = Math.max(2, Math.round(SR / freq))
  const buf = new Float32Array(n)
  const out = new Float32Array(src.length)
  let idx = 0
  let last = 0
  for (let i = 0; i < src.length; i++) {
    const y = buf[idx]
    last = y * (1 - damp) + last * damp
    const v = src[i] + last * feedback
    buf[idx] = v
    out[i] = y
    idx = (idx + 1) % n
  }
  return out
}

/** Karplus-Strong plucked string. `brightness` 0..1 keeps more highs (nylon ~0.5, pizzicato ~0.3). */
export function pluck(duration, freq, random, { brightness = 0.5, decay = 0.996, gain: g = 1 } = {}) {
  const out = buffer(duration)
  const period = Math.max(2, Math.round(SR / freq))
  const line = new Float32Array(period)
  for (let i = 0; i < period; i++) line[i] = random() * 2 - 1
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
    out[i] = cur * g
    idx = (idx + 1) % period
  }
  return out
}

/** Schroeder-style reverb: 4 parallel combs into 2 allpasses. `size` scales the delay lines (1 = room, 2.5 = open bay). */
export function reverb(src, { mixLevel = 0.25, decay = 0.75, tail = 1.2, size = 1, damp = 0.2 } = {}) {
  const out = new Float32Array(src.length + sec(tail))
  const combs = [1116, 1188, 1277, 1356].map((n) => ({ buf: new Float32Array(Math.round(n * size)), i: 0, lp: 0 }))
  const allpasses = [556, 441].map((n) => ({ buf: new Float32Array(Math.round(n * size)), i: 0 }))
  for (let i = 0; i < out.length; i++) {
    const x = i < src.length ? src[i] : 0
    let wet = 0
    for (const c of combs) {
      const y = c.buf[c.i]
      c.lp = y * (1 - damp) + c.lp * damp
      c.buf[c.i] = x + c.lp * decay
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

/** Simple feedback echo (distant cannon / thunder slap-backs). */
export function echo(src, delaySec, feedback = 0.4, repeats = 3, wet = 0.5) {
  const out = new Float32Array(src.length + sec(delaySec) * repeats)
  mix(out, src, 0, 1)
  let g = wet
  for (let r = 1; r <= repeats; r++) {
    mix(out, src, delaySec * r, g)
    g *= feedback
  }
  return out
}

export function softclip(src, drive = 1.5) {
  const out = new Float32Array(src.length)
  const norm = Math.tanh(drive)
  for (let i = 0; i < src.length; i++) out[i] = Math.tanh(src[i] * drive) / norm
  return out
}

export function normalize(src, peak = 0.9) {
  let max = 0
  for (const v of src) max = Math.max(max, Math.abs(v))
  if (max === 0) return src
  const g = peak / max
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = src[i] * g
  return out
}

/** Peak-aware soft limiter: louder average level without clipping. */
export function limit(src, peak = 0.95, drive = 1.2) {
  return normalize(softclip(normalize(src, 1), drive), peak)
}

export function fadeEdges(src, inSec = 0.002, outSec = 0.02) {
  const out = Float32Array.from(src)
  const n1 = sec(inSec), n2 = sec(outSec)
  for (let i = 0; i < n1 && i < out.length; i++) out[i] *= i / n1
  for (let i = 0; i < n2 && i < out.length; i++) out[out.length - 1 - i] *= i / n2
  return out
}

/** Trim trailing near-silence so SFX files stay tiny. */
export function trimTail(src, threshold = 0.002, pad = 0.03) {
  let end = src.length - 1
  while (end > 0 && Math.abs(src[end]) < threshold) end--
  return src.subarray(0, Math.min(src.length, end + sec(pad)))
}

/**
 * Make a seamless loop: everything rendered after `loopSeconds` (ringing tails) is folded back
 * onto the start. With `crossfade`, the head is faded in while the tail fades out (for continuous beds).
 */
export function foldLoop(src, loopSeconds, crossfade = false) {
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

/** Slowly varying random control signal (0..1) for gusts, flicker, swell. `rate` ≈ changes per second. */
export function wander(duration, rate, random, smooth = 0.5) {
  const out = buffer(duration)
  const step = Math.max(1, Math.round(SR / rate))
  let target = random()
  let cur = target
  const a = 1 - Math.exp(-1 / (SR * smooth))
  for (let i = 0; i < out.length; i++) {
    if (i % step === 0) target = random()
    cur += a * (target - cur)
    out[i] = cur
  }
  return out
}

export function wavBytes(samples) {
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
