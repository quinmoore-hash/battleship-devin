import * as THREE from 'three'
import { seededRandom } from '../random'

/**
 * Procedural canvas textures shared by the cannon effects. All are generated once per page, from fixed
 * seeds, so screenshots are reproducible. In environments without a DOM (unit tests) a 1×1 texture is
 * returned instead.
 */

/** Tileable value-noise fBm in [0, 1] on a `size`² grid. */
export function noiseField(size: number, seed: number, octaves = 4, baseCells = 4): Float32Array {
  const out = new Float32Array(size * size)
  let amp = 1
  let total = 0
  let cells = baseCells
  for (let o = 0; o < octaves; o++) {
    const rnd = seededRandom(seed + o * 7919)
    const lattice = new Float32Array(cells * cells)
    for (let i = 0; i < lattice.length; i++) lattice[i] = rnd()
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells
      const y0 = Math.floor(fy)
      const ty = smooth(fy - y0)
      const y1 = (y0 + 1) % cells
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells
        const x0 = Math.floor(fx)
        const tx = smooth(fx - x0)
        const x1 = (x0 + 1) % cells
        const a = lattice[y0 * cells + x0]
        const b = lattice[y0 * cells + x1]
        const c = lattice[y1 * cells + x0]
        const d = lattice[y1 * cells + x1]
        const v = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty
        out[y * size + x] += v * amp
      }
    }
    total += amp
    amp *= 0.5
    cells *= 2
  }
  for (let i = 0; i < out.length; i++) out[i] /= total
  return out
}

const smooth = (t: number) => t * t * (3 - 2 * t)

function canvasTexture(size: number, paint: (data: Uint8ClampedArray) => void, opts: { repeat?: boolean } = {}): THREE.Texture {
  if (typeof document === 'undefined') {
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
    t.needsUpdate = true
    return t
  }
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(size, size)
  paint(img.data)
  ctx.putImageData(img, 0, 0)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  if (opts.repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}

const cache = new Map<string, THREE.Texture>()
const memo = (key: string, make: () => THREE.Texture): THREE.Texture => {
  let t = cache.get(key)
  if (!t) {
    t = make()
    cache.set(key, t)
  }
  return t
}

/** Wispy smoke puff: noise-broken radial falloff, white RGB, shape in alpha. */
export const smokeTexture = (): THREE.Texture =>
  memo('smoke', () => {
    const size = 128
    const noise = noiseField(size, 11, 4, 3)
    return canvasTexture(size, (d) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x
          const dx = (x + 0.5) / size - 0.5
          const dy = (y + 0.5) / size - 0.5
          const r = Math.hypot(dx, dy) * 2
          const n = noise[i]
          const edge = Math.max(0, 1 - r / (0.72 + n * 0.3))
          const a = Math.pow(edge, 1.6) * (0.55 + n * 0.6)
          const shade = 200 + n * 55
          d[i * 4] = shade
          d[i * 4 + 1] = shade
          d[i * 4 + 2] = shade
          d[i * 4 + 3] = Math.min(255, a * 255)
        }
      }
    })
  })

/** Soft radial glow for flashes, sparks and heat. */
export const glowTexture = (): THREE.Texture =>
  memo('glow', () => {
    const size = 64
    return canvasTexture(size, (d) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x
          const dx = (x + 0.5) / size - 0.5
          const dy = (y + 0.5) / size - 0.5
          const r = Math.hypot(dx, dy) * 2
          const a = Math.exp(-r * r * 5) * (1 - Math.min(1, r))
          d[i * 4] = 255
          d[i * 4 + 1] = 255
          d[i * 4 + 2] = 255
          d[i * 4 + 3] = Math.min(255, a * 255)
        }
      }
    })
  })

/** Water droplet / spray sprite: bright core with a highlight, soft edge. */
export const sprayTexture = (): THREE.Texture =>
  memo('spray', () => {
    const size = 64
    const noise = noiseField(size, 23, 3, 4)
    return canvasTexture(size, (d) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x
          const dx = (x + 0.5) / size - 0.5
          const dy = (y + 0.5) / size - 0.5
          const r = Math.hypot(dx, dy) * 2
          const edge = Math.max(0, 1 - r / (0.8 + noise[i] * 0.2))
          const a = Math.pow(edge, 1.3) * (0.7 + noise[i] * 0.3)
          const hl = Math.exp(-((dx + 0.12) ** 2 + (dy - 0.12) ** 2) * 60)
          const c = 225 + hl * 30
          d[i * 4] = c
          d[i * 4 + 1] = c + 4
          d[i * 4 + 2] = 255
          d[i * 4 + 3] = Math.min(255, a * 255)
        }
      }
    })
  })

/** Tileable RGBA noise (R: fBm, G: finer fBm, B: coarse, A: 255) for shaders. */
export const noiseTexture = (): THREE.Texture =>
  memo('noise', () => {
    const size = 256
    const a = noiseField(size, 101, 5, 4)
    const b = noiseField(size, 202, 4, 8)
    const c = noiseField(size, 303, 3, 2)
    const t = canvasTexture(
      size,
      (d) => {
        for (let i = 0; i < size * size; i++) {
          d[i * 4] = a[i] * 255
          d[i * 4 + 1] = b[i] * 255
          d[i * 4 + 2] = c[i] * 255
          d[i * 4 + 3] = 255
        }
      },
      { repeat: true },
    )
    t.colorSpace = THREE.NoColorSpace
    return t
  })

/** Pitted cast iron: used as bump + roughness map on the cannonball. */
export const ironTexture = (): THREE.Texture =>
  memo('iron', () => {
    const size = 128
    const n = noiseField(size, 404, 4, 6)
    const rnd = seededRandom(405)
    const pits = Array.from({ length: 40 }, () => [rnd() * size, rnd() * size, 1.5 + rnd() * 3])
    const t = canvasTexture(
      size,
      (d) => {
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const i = y * size + x
            let v = 0.55 + (n[i] - 0.5) * 0.5
            for (const [px, py, pr] of pits) {
              const dx = Math.min(Math.abs(x - px), size - Math.abs(x - px))
              const dy = Math.min(Math.abs(y - py), size - Math.abs(y - py))
              const dd = Math.hypot(dx, dy) / pr
              if (dd < 1) v -= (1 - dd) * 0.5
            }
            const c = Math.max(0, Math.min(255, v * 255))
            d[i * 4] = c
            d[i * 4 + 1] = c
            d[i * 4 + 2] = c
            d[i * 4 + 3] = 255
          }
        }
      },
      { repeat: true },
    )
    t.colorSpace = THREE.NoColorSpace
    return t
  })
