/**
 * Procedural PBR textures for the ship kit, painted into canvases at runtime so the game ships no
 * texture assets and every map is deterministic (seeded noise). Each generator returns a colour map,
 * a tangent-space normal map derived from a height field and a roughness map. Results are cached.
 *
 * All generators degrade to `null` maps when there is no DOM (unit tests, SSR); materials then fall
 * back to flat colours.
 */
import * as THREE from 'three'
import { seededRandom } from '../../vfx/random'

export type Rgb = [number, number, number]

export interface PbrMaps {
  map: THREE.Texture | null
  normalMap: THREE.Texture | null
  roughnessMap: THREE.Texture | null
}

const hasDom = () => typeof document !== 'undefined' && typeof document.createElement === 'function'

/** Tileable value noise on a `cells × cells` lattice. */
export function makeNoise(seed: number, cells = 32) {
  const rnd = seededRandom(seed)
  const grid = new Float32Array(cells * cells)
  for (let i = 0; i < grid.length; i++) grid[i] = rnd()
  const smooth = (t: number) => t * t * (3 - 2 * t)
  const at = (x: number, y: number) => grid[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)]
  /** `x`,`y` in lattice units; returns [0,1]. Tiles every `cells` units. */
  const sample = (x: number, y: number): number => {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = smooth(x - x0)
    const fy = smooth(y - y0)
    const a = at(x0, y0)
    const b = at(x0 + 1, y0)
    const c = at(x0, y0 + 1)
    const d = at(x0 + 1, y0 + 1)
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy
  }
  /** Fractal sum of `octaves` octaves. */
  const fbm = (x: number, y: number, octaves = 4, gain = 0.5): number => {
    let amp = 1
    let sum = 0
    let norm = 0
    for (let o = 0; o < octaves; o++) {
      sum += sample(x, y) * amp
      norm += amp
      x *= 2
      y *= 2
      amp *= gain
    }
    return sum / norm
  }
  return { sample, fbm }
}

export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
export const scale = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k]
export const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)

interface Painter {
  /** Per pixel: write colour (0–255), height (0–1) and roughness (0–1). */
  (x: number, y: number, out: { rgb: Rgb; height: number; rough: number }): void
}

interface BakeOptions {
  width: number
  height: number
  /** Normal strength multiplier. */
  bump?: number
  repeat?: [number, number]
  anisotropy?: number
}

const cache = new Map<string, PbrMaps>()

/** Bakes colour / normal / roughness textures by evaluating `paint` on every texel. */
export function bakeMaps(key: string, opts: BakeOptions, paint: Painter): PbrMaps {
  const cached = cache.get(key)
  if (cached) return cached
  if (!hasDom()) {
    const empty = { map: null, normalMap: null, roughnessMap: null }
    cache.set(key, empty)
    return empty
  }
  const { width: w, height: h } = opts
  const color = new Uint8ClampedArray(new ArrayBuffer(w * h * 4))
  const rough = new Uint8ClampedArray(new ArrayBuffer(w * h * 4))
  const heights = new Float32Array(w * h)
  const out = { rgb: [0, 0, 0] as Rgb, height: 0.5, rough: 0.8 }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out.height = 0.5
      out.rough = 0.8
      paint(x, y, out)
      const i = (y * w + x) * 4
      color[i] = clamp8(out.rgb[0])
      color[i + 1] = clamp8(out.rgb[1])
      color[i + 2] = clamp8(out.rgb[2])
      color[i + 3] = 255
      const r = clamp8(out.rough * 255)
      rough[i] = r
      rough[i + 1] = r
      rough[i + 2] = r
      rough[i + 3] = 255
      heights[y * w + x] = out.height
    }
  }
  const normal = new Uint8ClampedArray(new ArrayBuffer(w * h * 4))
  const strength = (opts.bump ?? 1) * 6
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const hl = heights[y * w + ((x - 1 + w) % w)]
      const hr = heights[y * w + ((x + 1) % w)]
      const hd = heights[((y - 1 + h) % h) * w + x]
      const hu = heights[((y + 1) % h) * w + x]
      let nx = -(hr - hl) * strength
      let ny = -(hu - hd) * strength
      const len = Math.hypot(nx, ny, 1)
      nx /= len
      ny /= len
      const i = (y * w + x) * 4
      normal[i] = clamp8((nx * 0.5 + 0.5) * 255)
      normal[i + 1] = clamp8((ny * 0.5 + 0.5) * 255)
      normal[i + 2] = clamp8((1 / len) * 0.5 * 255 + 127.5)
      normal[i + 3] = 255
    }
  }
  const toTexture = (data: Uint8ClampedArray<ArrayBuffer>, srgb: boolean) => {
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')!
    ctx.putImageData(new ImageData(data, w, h), 0, 0)
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.anisotropy = opts.anisotropy ?? 4
    if (opts.repeat) tex.repeat.set(opts.repeat[0], opts.repeat[1])
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    return tex
  }
  const maps = { map: toTexture(color, true), normalMap: toTexture(normal, false), roughnessMap: toTexture(rough, false) }
  cache.set(key, maps)
  return maps
}

// ───────────────────────────────────────────── wood ─────────────────────────────────────────────

export interface WoodOptions {
  seed: number
  light: Rgb
  dark: Rgb
  /** Plank rows across the texture's v axis. */
  rows?: number
  /** Plank length in texels along u (planks are staggered per row). */
  plankLength?: number
  nails?: boolean
  /** 0 = bare oak … 1 = tarred (darker, glossier, less grain contrast). */
  tar?: number
  /** Grain scale multiplier. */
  grain?: number
  size?: number
  roughness?: number
  /** Painted overlay colour and coverage (0 none … 1 solid). Wear shows wood through along seams. */
  paint?: { color: Rgb; coverage: number }
}

/** Planked wood: staggered planks with caulked seams, nail rows at the butts and fbm grain. */
export function woodPlanks(name: string, o: WoodOptions): PbrMaps {
  const size = o.size ?? 512
  const rows = o.rows ?? 8
  const plankLength = o.plankLength ?? size / 1.5
  const tar = o.tar ?? 0
  const grainScale = o.grain ?? 1
  const baseRough = o.roughness ?? 0.78
  const noise = makeNoise(o.seed, 32)
  const noise2 = makeNoise(o.seed * 7 + 1, 16)
  const rowH = size / rows
  const nail: Rgb = [58, 56, 54]
  return bakeMaps(`wood:${name}`, { width: size, height: size, bump: 1 }, (x, y, out) => {
    const row = Math.floor(y / rowH)
    const stagger = ((row * 0.37 + noise2.sample(row * 3.1, 0.5)) * plankLength) % plankLength
    const px = (x + stagger) % plankLength
    const plank = Math.floor((x + stagger) / plankLength) + row * 101
    const tone = noise2.sample(plank * 1.7 + 0.3, row * 2.3 + 0.7)
    const grain = noise.fbm((x / size) * 32 * 0.7 * grainScale + plank, (y / size) * 32 * 6 * grainScale, 4, 0.55)
    const fine = Math.sin(((y + grain * 40) / rowH) * Math.PI * 9 + plank) * 0.5 + 0.5
    let c = mix(o.light, o.dark, 0.25 + 0.5 * grain + 0.15 * fine)
    c = mix(c, scale(c, 0.78 + tone * 0.44), 0.6)
    let height = 0.5 + (grain - 0.5) * 0.25 + (fine - 0.5) * 0.06
    let rough = baseRough + (grain - 0.5) * 0.2
    // caulked seams between rows and at plank butts
    const seamV = Math.min(y % rowH, rowH - (y % rowH))
    const seamU = Math.min(px, plankLength - px)
    const seam = Math.max(0, 1 - seamV / 2.2) + Math.max(0, 1 - seamU / 2.2)
    if (seam > 0) {
      const k = Math.min(1, seam)
      c = mix(c, [24, 16, 10], 0.85 * k)
      height -= 0.35 * k
      rough += 0.15 * k
    }
    // bevelled plank edge
    const edge = Math.min(seamV, seamU)
    if (edge < 6) height -= (1 - edge / 6) * 0.12
    // nail rows at each butt
    if (o.nails !== false) {
      const nailU = Math.min(Math.abs(px - 9), Math.abs(plankLength - 9 - px))
      const yy = y % rowH
      const nailV = Math.min(Math.abs(yy - rowH * 0.25), Math.abs(yy - rowH * 0.75))
      const d = Math.hypot(nailU, nailV)
      if (d < 2.6) {
        c = mix(nail, [20, 18, 16], d / 2.6)
        height += 0.25 * (1 - d / 2.6)
        rough = 0.45
      }
    }
    if (tar > 0) {
      const t = tar * (0.75 + 0.25 * noise2.fbm(x / 40, y / 40, 2))
      c = mix(c, [22, 16, 11], t)
      rough -= 0.25 * t
    }
    if (o.paint) {
      const wear = noise2.fbm(x / 18 + 9, y / 18 + 3, 3)
      const nearSeam = seam > 0.2 || edge < 4
      const cover = o.paint.coverage - (nearSeam ? 0.35 : 0) - (wear < 0.3 ? 0.5 : 0)
      if (cover > 0) {
        const k = Math.min(1, cover)
        c = mix(c, mix(o.paint.color, scale(o.paint.color, 0.8), wear), k)
        rough = rough * (1 - k) + 0.55 * k
      }
    }
    out.rgb = c
    out.height = height
    out.rough = rough
  })
}

/** Plain (un-planked) wood for spars, yards, barrels: grain only, no seams. */
export function woodPlain(name: string, o: Omit<WoodOptions, 'rows' | 'plankLength' | 'nails'>): PbrMaps {
  const size = o.size ?? 256
  const noise = makeNoise(o.seed, 16)
  const tar = o.tar ?? 0
  const baseRough = o.roughness ?? 0.8
  return bakeMaps(`wood-plain:${name}`, { width: size, height: size, bump: 0.6 }, (x, y, out) => {
    const grain = noise.fbm((x / size) * 16 * 0.5, (y / size) * 16 * 5, 4, 0.55)
    const fine = Math.sin((y / size) * Math.PI * 80 + grain * 20) * 0.5 + 0.5
    let c = mix(o.light, o.dark, 0.3 + 0.5 * grain + 0.15 * fine)
    let rough = baseRough + (grain - 0.5) * 0.15
    if (tar > 0) {
      c = mix(c, [24, 17, 12], tar)
      rough -= 0.25 * tar
    }
    out.rgb = c
    out.height = 0.5 + (grain - 0.5) * 0.15 + (fine - 0.5) * 0.04
    out.rough = rough
  })
}

// ───────────────────────────────────────────── cloth ────────────────────────────────────────────

export interface CanvasOptions {
  seed: number
  base: Rgb
  stain: Rgb
  /** Horizontal seam spacing in texels (sewn panels). */
  seamEvery?: number
  size?: number
  /** How dirty the cloth is, 0–1. */
  grime?: number
}

/** Sailcloth: visible weave, sewn panel seams, water/mildew stains. */
export function canvasWeave(name: string, o: CanvasOptions): PbrMaps {
  const size = o.size ?? 512
  const seamEvery = o.seamEvery ?? size / 6
  const grime = o.grime ?? 0.5
  const noise = makeNoise(o.seed, 16)
  return bakeMaps(`canvas:${name}`, { width: size, height: size, bump: 0.5 }, (x, y, out) => {
    const weave = (Math.sin(x * Math.PI * 0.5) * 0.5 + 0.5) * (Math.sin(y * Math.PI * 0.5) * 0.5 + 0.5)
    const thread = noise.sample(x * 0.9, y * 0.05) * 0.4 + noise.sample(x * 0.05, y * 0.9) * 0.4
    const blotch = noise.fbm((x / size) * 16 * 0.35 + 3, (y / size) * 16 * 0.35, 4)
    let c = mix(o.base, scale(o.base, 0.86), weave * 0.6 + thread * 0.5)
    c = mix(c, o.stain, Math.max(0, blotch - 0.45) * 2 * grime)
    let height = 0.5 + (weave - 0.5) * 0.3 + (thread - 0.4) * 0.15
    let rough = 0.92 - weave * 0.05
    const seam = Math.min(y % seamEvery, seamEvery - (y % seamEvery))
    if (seam < 3) {
      c = mix(c, scale(o.base, 0.7), 0.5 * (1 - seam / 3))
      height += 0.2 * (1 - seam / 3)
      // stitch dots along the seam
      if ((x >> 2) % 2 === 0) height += 0.1
    }
    // reinforced edges (tabling) every full texture height
    const edge = Math.min(y, size - y)
    if (edge < size * 0.03) {
      c = mix(c, scale(o.base, 0.8), 0.4)
      height += 0.15
      rough += 0.03
    }
    out.rgb = c
    out.height = height
    out.rough = rough
  })
}

// ───────────────────────────────────────────── rope / metal ─────────────────────────────────────

/** Three-strand laid rope: the texture wraps around the tube in v, strands twist along u. */
export function ropeTwist(name: string, base: Rgb, seed: number): PbrMaps {
  const size = 128
  const noise = makeNoise(seed, 8)
  return bakeMaps(`rope:${name}`, { width: size, height: size, bump: 1.2 }, (x, y, out) => {
    const u = x / size
    const v = y / size
    // three strands, twisted: phase advances with u
    const strand = Math.sin((v * 3 + u * 2) * Math.PI * 2) * 0.5 + 0.5
    const fibre = noise.sample(u * 8 * 3, v * 8 * 20) * 0.5 + noise.sample(u * 8 * 0.5, v * 8 * 40) * 0.5
    const shade = 0.6 + strand * 0.4
    const c = mix(scale(base, shade * (0.85 + fibre * 0.3)), [50, 40, 28], 0.15 * (1 - strand))
    out.rgb = c
    out.height = 0.3 + strand * 0.6 + (fibre - 0.5) * 0.1
    out.rough = 0.95
  })
}

/** Cast iron: dark, pitted, slightly rusty in the pits. */
export function castIron(name: string, seed: number, rustAmount = 0.35): PbrMaps {
  const size = 256
  const noise = makeNoise(seed, 32)
  const iron: Rgb = [48, 48, 52]
  const rust: Rgb = [112, 62, 34]
  return bakeMaps(`iron:${name}`, { width: size, height: size, bump: 0.8 }, (x, y, out) => {
    const pit = noise.fbm(x / 6, y / 6, 3, 0.6)
    const speck = noise.sample(x * 0.9 + 17, y * 0.9 + 5)
    const rustMask = Math.max(0, noise.fbm(x / 28 + 4, y / 28 + 11, 3) - (1 - rustAmount)) * (1 / Math.max(rustAmount, 0.01))
    let c = mix(iron, scale(iron, 0.7), pit)
    c = mix(c, rust, Math.min(1, rustMask * 1.5))
    out.rgb = mix(c, [20, 20, 22], speck > 0.82 ? 0.5 : 0)
    out.height = 0.5 - (speck > 0.82 ? 0.3 : 0) + (pit - 0.5) * 0.1
    out.rough = 0.48 + pit * 0.2 + rustMask * 0.35
  })
}

/** Polished brass with soft patina streaks and fingermarks. */
export function brass(name: string, seed: number, base: Rgb = [196, 150, 70]): PbrMaps {
  const size = 128
  const noise = makeNoise(seed, 16)
  return bakeMaps(`brass:${name}`, { width: size, height: size, bump: 0.3 }, (x, y, out) => {
    const streak = noise.fbm(x / 10, y / 70, 3)
    const patina = Math.max(0, noise.fbm(x / 30 + 9, y / 30 + 2, 3) - 0.6) * 2.5
    let c = mix(base, scale(base, 1.15), streak)
    c = mix(c, [88, 110, 90], patina * 0.6)
    out.rgb = c
    out.height = 0.5 + (streak - 0.5) * 0.05
    out.rough = 0.22 + streak * 0.12 + patina * 0.4
  })
}

/** Copper hull sheathing: overlapping rectangular plates with nail rows, green verdigris at the edges. */
export function copperPlates(name: string, seed: number): PbrMaps {
  const size = 512
  const noise = makeNoise(seed, 32)
  const plateW = 96
  const plateH = 40
  const copper: Rgb = [176, 96, 62]
  const green: Rgb = [92, 132, 108]
  return bakeMaps(`copper:${name}`, { width: size, height: size, bump: 0.8 }, (x, y, out) => {
    const row = Math.floor(y / plateH)
    const xx = (x + (row % 2) * plateW * 0.5) % plateW
    const yy = y % plateH
    const id = Math.floor((x + (row % 2) * plateW * 0.5) / plateW) + row * 131
    const tone = noise.sample(id * 1.3 + 0.2, row * 2.1 + 0.4)
    const verd = Math.max(0, noise.fbm(x / 40 + 3, y / 40 + 1, 3) - 0.5) * 2
    let c = mix(copper, scale(copper, 0.82 + tone * 0.3), 0.7)
    c = mix(c, green, verd * 0.7)
    let height = 0.5
    const edge = Math.min(xx, yy)
    if (edge < 2) {
      c = scale(c, 0.6)
      height -= 0.3
    }
    const nailU = Math.min(Math.abs(xx - 6), Math.abs(plateW - 6 - xx))
    const nailV = ((yy + 8) % 16) - 8
    const d = Math.hypot(nailU, nailV)
    if (d < 1.8) {
      c = scale(c, 0.7)
      height += 0.2
    }
    out.rgb = c
    out.height = height
    out.rough = 0.4 + verd * 0.45 + (tone - 0.5) * 0.1
  })
}

/** Weed-fouled, barnacled below-the-waterline paint ("white stuff" tallow gone grey). */
export function foulBottom(name: string, seed: number, base: Rgb = [128, 122, 108]): PbrMaps {
  const size = 512
  const noise = makeNoise(seed, 32)
  const weed: Rgb = [58, 86, 52]
  const barnacle: Rgb = [214, 206, 190]
  const planks = woodPlanks(`${name}-planks`, { seed: seed + 3, light: base, dark: scale(base, 0.7), rows: 8, tar: 0.1, nails: false })
  void planks
  return bakeMaps(`foul:${name}`, { width: size, height: size, bump: 1 }, (x, y, out) => {
    const rowH = size / 8
    const seamV = Math.min(y % rowH, rowH - (y % rowH))
    const grime = noise.fbm(x / 60, y / 60, 4)
    const weedMask = Math.max(0, noise.fbm(x / 35 + 7, y / 35 + 2, 3) - 0.55) * 2.2
    let c = mix(base, scale(base, 0.75), grime)
    c = mix(c, weed, Math.min(1, weedMask))
    let height = 0.5 + (grime - 0.5) * 0.1
    let rough = 0.85
    if (seamV < 2) {
      c = scale(c, 0.55)
      height -= 0.3
    }
    // barnacle clusters: small cones
    const bx = Math.floor(x / 12)
    const by = Math.floor(y / 12)
    const r = noise.sample(bx * 3.3 + 0.5, by * 3.7 + 0.5)
    if (r > 0.72) {
      const cx = (bx + 0.5) * 12 + (r - 0.8) * 20
      const cy = (by + 0.5) * 12 + (noise.sample(bx * 1.1, by * 1.9) - 0.5) * 8
      const d = Math.hypot(x - cx, y - cy)
      const rad = 2.5 + r * 3
      if (d < rad) {
        const k = 1 - d / rad
        c = mix(c, barnacle, 0.5 + k * 0.5)
        height += k * 0.5
        rough = 0.7
      }
    }
    out.rgb = c
    out.height = height
    out.rough = rough
  })
}

// ───────────────────────────────────────────── flags ────────────────────────────────────────────

function flagCanvas(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.Texture | null {
  const cached = cache.get(key)
  if (cached) return cached.map
  if (!hasDom()) {
    cache.set(key, { map: null, normalMap: null, roughnessMap: null })
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  draw(ctx)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  cache.set(key, { map: tex, normalMap: null, roughnessMap: null })
  return tex
}

/** Black flag with a white skull over crossed bones. */
export function jollyRoger(): THREE.Texture | null {
  return flagCanvas('flag:jolly-roger', 512, 320, (ctx) => {
    ctx.fillStyle = '#0d0c0b'
    ctx.fillRect(0, 0, 512, 320)
    // subtle weave
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    for (let y = 0; y < 320; y += 4) ctx.fillRect(0, y, 512, 1)
    const cx = 256
    const cy = 150
    ctx.save()
    ctx.translate(cx, cy)
    // crossed bones behind the skull
    ctx.strokeStyle = '#efe9dc'
    ctx.lineWidth = 18
    ctx.lineCap = 'round'
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      ctx.save()
      ctx.rotate(a)
      ctx.beginPath()
      ctx.moveTo(-120, 0)
      ctx.lineTo(120, 0)
      ctx.stroke()
      ctx.fillStyle = '#efe9dc'
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          ctx.beginPath()
          ctx.ellipse(sx * 122, sy * 10, 15, 13, 0, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.restore()
    }
    // skull
    ctx.fillStyle = '#f3eee2'
    ctx.beginPath()
    ctx.ellipse(0, -14, 70, 66, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.roundRect(-44, 20, 88, 44, 14)
    ctx.fill()
    // eye sockets
    ctx.fillStyle = '#0d0c0b'
    ctx.beginPath()
    ctx.ellipse(-28, -14, 19, 23, 0.25, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.ellipse(28, -14, 19, 23, -0.25, 0, Math.PI * 2)
    ctx.fill()
    // nose
    ctx.beginPath()
    ctx.moveTo(0, 8)
    ctx.lineTo(-9, 28)
    ctx.lineTo(9, 28)
    ctx.closePath()
    ctx.fill()
    // teeth gaps
    ctx.lineWidth = 3
    ctx.strokeStyle = '#0d0c0b'
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath()
      ctx.moveTo(i * 11, 42)
      ctx.lineTo(i * 11, 64)
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.moveTo(-40, 44)
    ctx.lineTo(40, 44)
    ctx.stroke()
    ctx.restore()
  })
}

/** Red ensign with a (pre-1801) Union canton. */
export function redEnsign(): THREE.Texture | null {
  return flagCanvas('flag:red-ensign', 512, 256, (ctx) => {
    ctx.fillStyle = '#b5121b'
    ctx.fillRect(0, 0, 512, 256)
    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    for (let y = 0; y < 256; y += 4) ctx.fillRect(0, y, 512, 1)
    const w = 256
    const h = 128
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
    ctx.clip()
    ctx.fillStyle = '#1b3a7a'
    ctx.fillRect(0, 0, w, h)
    // St Andrew saltire
    ctx.strokeStyle = '#f1ede4'
    ctx.lineWidth = 26
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(w, h)
    ctx.moveTo(w, 0)
    ctx.lineTo(0, h)
    ctx.stroke()
    // St George cross, fimbriated
    ctx.strokeStyle = '#f1ede4'
    ctx.lineWidth = 40
    ctx.beginPath()
    ctx.moveTo(w / 2, 0)
    ctx.lineTo(w / 2, h)
    ctx.moveTo(0, h / 2)
    ctx.lineTo(w, h / 2)
    ctx.stroke()
    ctx.strokeStyle = '#c8102e'
    ctx.lineWidth = 24
    ctx.stroke()
    ctx.restore()
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, w - 2, h - 2)
  })
}

/** Long swallow-tailed pennant for the masthead. */
export function pennant(livery: 'pirate' | 'navy'): THREE.Texture | null {
  return flagCanvas(`flag:pennant-${livery}`, 512, 64, (ctx) => {
    ctx.fillStyle = livery === 'pirate' ? '#8c1d1d' : '#f1ede4'
    ctx.fillRect(0, 0, 512, 64)
    if (livery === 'navy') {
      ctx.fillStyle = '#c8102e'
      ctx.fillRect(0, 26, 512, 12)
      ctx.fillStyle = '#1b3a7a'
      ctx.fillRect(0, 0, 60, 64)
    } else {
      ctx.fillStyle = '#0d0c0b'
      ctx.fillRect(0, 0, 70, 64)
    }
  })
}

/** Frosted, slightly green hand-blown window glass (colour only; opacity comes from the material). */
export function windowGlass(): THREE.Texture | null {
  return flagCanvas('glass:window', 64, 64, (ctx) => {
    const g = ctx.createRadialGradient(20, 20, 4, 32, 32, 48)
    g.addColorStop(0, '#dff3ea')
    g.addColorStop(1, '#8fc0b4')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
    ctx.strokeStyle = 'rgba(40,30,20,0.9)'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(32, 0)
    ctx.lineTo(32, 64)
    ctx.moveTo(0, 32)
    ctx.lineTo(64, 32)
    ctx.stroke()
  })
}

/** Number of textures baked so far (for the kit demo stats). */
export const bakedTextureCount = () => cache.size
