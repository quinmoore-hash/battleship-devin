/**
 * Procedural canvas textures for the Sloop: plank runs with grain + nail rows, canvas weave with seams,
 * tattered-sail alpha, flags. Seeded so screenshots are reproducible. Browser only (needs a 2D canvas);
 * every builder is lazy so importing this module in node is safe.
 */
import * as THREE from 'three'
import { seededRandom } from '../../vfx/random'

const cache = new Map<string, THREE.Texture>()

function canvas(size: number, h = size): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = size
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  return [c, ctx]
}

function tex(c: HTMLCanvasElement, srgb = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}

function memo<T extends THREE.Texture>(key: string, make: () => T): T {
  const hit = cache.get(key)
  if (hit) return hit as T
  const t = make()
  cache.set(key, t)
  return t
}

const hex = (c: THREE.Color) => '#' + c.getHexString()
const mix = (a: string, b: string, t: number) => hex(new THREE.Color(a).lerp(new THREE.Color(b), t))

export interface PlankOptions {
  seed: number
  /** Base plank colour and two grain tones. */
  base: string
  dark: string
  light: string
  /** Plank rows across the texture (v) and how often a plank ends along u. */
  rows: number
  /** Nail/treenail pairs along each plank. */
  nails?: number
  /** Extra streaky weathering (tar runs, salt). */
  streaks?: number
  size?: number
}

/** Colour map of horizontal planks: grain, butt joints staggered row by row, caulked seams, nail heads. */
export function plankTexture(o: PlankOptions): THREE.CanvasTexture {
  return memo(`plank:${JSON.stringify(o)}`, () => {
    const size = o.size ?? 512
    const [c, ctx] = canvas(size)
    const rnd = seededRandom(o.seed)
    const rowH = size / o.rows
    ctx.fillStyle = o.base
    ctx.fillRect(0, 0, size, size)
    for (let r = 0; r < o.rows; r++) {
      const y0 = r * rowH
      const shade = (rnd() - 0.5) * 0.18
      ctx.fillStyle = mix(o.base, shade > 0 ? o.light : o.dark, Math.abs(shade) * 3)
      ctx.fillRect(0, y0, size, rowH)
      // grain: long wavy strokes
      const lines = 10 + Math.floor(rnd() * 8)
      for (let i = 0; i < lines; i++) {
        const y = y0 + rowH * (0.08 + 0.84 * rnd())
        const amp = rowH * 0.08 * rnd()
        const freq = 0.004 + rnd() * 0.01
        const tone = rnd() < 0.5 ? o.dark : o.light
        ctx.strokeStyle = mix(o.base, tone, 0.35 + rnd() * 0.4)
        ctx.globalAlpha = 0.25 + rnd() * 0.4
        ctx.lineWidth = 0.6 + rnd() * 1.2
        ctx.beginPath()
        for (let x = 0; x <= size; x += 6) ctx.lineTo(x, y + Math.sin(x * freq + rnd() * 0.1 + i) * amp)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      // knots
      if (rnd() < 0.45) {
        const kx = rnd() * size
        const ky = y0 + rowH * (0.3 + 0.4 * rnd())
        const kr = rowH * (0.08 + rnd() * 0.08)
        const grad = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr * 2.2)
        grad.addColorStop(0, mix(o.dark, '#000', 0.4))
        grad.addColorStop(0.5, o.dark)
        grad.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.ellipse(kx, ky, kr * 2.2, kr * 1.3, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      // butt joints: staggered per row
      const joints = 1 + Math.floor(rnd() * 2)
      const offset = rnd() * size
      ctx.strokeStyle = mix(o.dark, '#000', 0.6)
      ctx.lineWidth = 1.4
      for (let j = 0; j < joints; j++) {
        const x = (offset + (j * size) / joints) % size
        ctx.beginPath()
        ctx.moveTo(x, y0)
        ctx.lineTo(x, y0 + rowH)
        ctx.stroke()
        // nails either side of the joint
        ctx.fillStyle = '#1a1612'
        ctx.beginPath()
        ctx.arc(x - 4, y0 + rowH * 0.3, 1.4, 0, Math.PI * 2)
        ctx.arc(x + 4, y0 + rowH * 0.7, 1.4, 0, Math.PI * 2)
        ctx.fill()
      }
      // seam between planks (caulking, dark) with a light bevel line
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, y0 + rowH - 2, size, 2)
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.fillRect(0, y0, size, 1)
      // treenail rows
      const nails = o.nails ?? 0
      ctx.fillStyle = 'rgba(20,16,12,0.8)'
      for (let i = 0; i < nails; i++) {
        const x = ((i + 0.5) / nails) * size + (rnd() - 0.5) * 3
        ctx.beginPath()
        ctx.arc(x, y0 + rowH * 0.28, 1.3, 0, Math.PI * 2)
        ctx.arc(x + 2, y0 + rowH * 0.72, 1.3, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    // weathering streaks running down (v direction)
    const streaks = o.streaks ?? 0
    for (let i = 0; i < streaks; i++) {
      const x = rnd() * size
      const w = 2 + rnd() * 10
      const grad = ctx.createLinearGradient(x, 0, x + w, 0)
      grad.addColorStop(0, 'rgba(0,0,0,0)')
      grad.addColorStop(0.5, `rgba(0,0,0,${0.08 + rnd() * 0.15})`)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.fillRect(x, 0, w, size)
    }
    return tex(c)
  })
}

/** Grey-scale bump map matching `plankTexture` seams/grain (shared by all plank materials of a seed). */
export function plankBump(rows: number, seed: number, size = 512): THREE.CanvasTexture {
  return memo(`plankbump:${rows}:${seed}`, () => {
    const [c, ctx] = canvas(size)
    const rnd = seededRandom(seed * 7 + 1)
    const rowH = size / rows
    ctx.fillStyle = '#808080'
    ctx.fillRect(0, 0, size, size)
    for (let r = 0; r < rows; r++) {
      const y0 = r * rowH
      ctx.fillStyle = `rgb(${120 + Math.floor(rnd() * 24)},${120 + Math.floor(rnd() * 24)},${120 + Math.floor(rnd() * 24)})`
      ctx.fillRect(0, y0, size, rowH)
      for (let i = 0; i < 12; i++) {
        const y = y0 + rowH * rnd()
        ctx.strokeStyle = `rgba(${rnd() < 0.5 ? 60 : 200},${rnd() < 0.5 ? 60 : 200},${rnd() < 0.5 ? 60 : 200},0.25)`
        ctx.lineWidth = 1
        ctx.beginPath()
        for (let x = 0; x <= size; x += 8) ctx.lineTo(x, y + Math.sin(x * 0.01 + i) * 2)
        ctx.stroke()
      }
      ctx.fillStyle = '#202020'
      ctx.fillRect(0, y0 + rowH - 3, size, 3)
      ctx.fillStyle = '#d0d0d0'
      ctx.fillRect(0, y0, size, 1)
    }
    return tex(c, false)
  })
}

/** Below-waterline finish: anti-fouling base with barnacle clusters and a weed fringe at the top (v → 1). */
export function antifoulTexture(seed: number, base: string, barnacle: string, weed: string): THREE.CanvasTexture {
  return memo(`antifoul:${seed}:${base}:${barnacle}:${weed}`, () => {
    const size = 512
    const [c, ctx] = canvas(size)
    const rnd = seededRandom(seed)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, size, size)
    // plank seams still show through the paint
    for (let r = 0; r < 10; r++) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'
      ctx.fillRect(0, (r * size) / 10 - 1, size, 2)
    }
    // barnacles: clusters of small discs, denser toward the waterline
    for (let i = 0; i < 1400; i++) {
      const y = size * (1 - Math.pow(rnd(), 0.5))
      const x = rnd() * size
      const r = 1 + rnd() * 3.5
      ctx.fillStyle = mix(barnacle, '#ffffff', rnd() * 0.3)
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.beginPath()
      ctx.arc(x, y, r * 0.35, 0, Math.PI * 2)
      ctx.fill()
    }
    // weed and slime fringe just below the waterline
    for (let i = 0; i < 240; i++) {
      const x = rnd() * size
      const len = 10 + rnd() * 50
      ctx.strokeStyle = mix(weed, '#000', rnd() * 0.4)
      ctx.globalAlpha = 0.5 + rnd() * 0.4
      ctx.lineWidth = 1 + rnd() * 2.5
      ctx.beginPath()
      ctx.moveTo(x, size)
      ctx.quadraticCurveTo(x + (rnd() - 0.5) * 14, size - len * 0.6, x + (rnd() - 0.5) * 20, size - len)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
    return tex(c)
  })
}

/** Sail cloth: woven canvas with vertical seams between cloths, stains and reinforcing bands at the edges. */
export function canvasTexture(seed: number, base: string, seam: string, stain: string): THREE.CanvasTexture {
  return memo(`canvas:${seed}:${base}:${seam}:${stain}`, () => {
    const size = 512
    const [c, ctx] = canvas(size)
    const rnd = seededRandom(seed)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, size, size)
    // weave
    for (let y = 0; y < size; y += 2) {
      ctx.fillStyle = `rgba(0,0,0,${0.03 + 0.05 * rnd()})`
      ctx.fillRect(0, y, size, 1)
    }
    for (let x = 0; x < size; x += 2) {
      ctx.fillStyle = `rgba(255,255,255,${0.02 + 0.05 * rnd()})`
      ctx.fillRect(x, 0, 1, size)
    }
    // stains / mildew blotches
    for (let i = 0; i < 26; i++) {
      const x = rnd() * size
      const y = rnd() * size
      const r = 20 + rnd() * 70
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, mix(stain, base, 0.3))
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = 0.18 + rnd() * 0.2
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    ctx.globalAlpha = 1
    // cloth seams (vertical), double stitched
    const cloths = 7
    for (let i = 1; i < cloths; i++) {
      const x = (i / cloths) * size
      ctx.fillStyle = seam
      ctx.globalAlpha = 0.55
      ctx.fillRect(x - 3, 0, 6, size)
      ctx.globalAlpha = 0.9
      ctx.fillStyle = mix(seam, '#000', 0.4)
      for (let y = 0; y < size; y += 7) {
        ctx.fillRect(x - 4, y, 1.5, 3)
        ctx.fillRect(x + 3, y + 3, 1.5, 3)
      }
    }
    ctx.globalAlpha = 1
    // reef bands with reef points (horizontal)
    for (const yy of [size * 0.62, size * 0.8]) {
      ctx.fillStyle = seam
      ctx.globalAlpha = 0.5
      ctx.fillRect(0, yy - 4, size, 8)
      ctx.globalAlpha = 1
      ctx.fillStyle = mix(seam, '#000', 0.5)
      for (let x = 16; x < size; x += 36) ctx.fillRect(x, yy - 10, 3, 20)
    }
    return tex(c)
  })
}

/**
 * Alpha map for shredding: mostly opaque with low-alpha blotches that grow as `alphaTest` rises, so one
 * texture gives a continuous "torn" ramp. Alpha stays high along the luff (u → 0) so remnants cling to the mast.
 */
export function tatterAlpha(seed: number): THREE.CanvasTexture {
  return memo(`tatter:${seed}`, () => {
    const size = 256
    const [c, ctx] = canvas(size)
    const rnd = seededRandom(seed)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, size, size)
    // ragged rips: each is a cluster of stretched, rotated blotches so the edges read as torn cloth
    for (let i = 0; i < 26; i++) {
      const cx = size * (0.12 + 0.88 * rnd())
      const cy = rnd() * size
      const core = 0.05 + rnd() * 0.3
      const n = 3 + Math.floor(rnd() * 4)
      for (let k = 0; k < n; k++) {
        const x = cx + (rnd() - 0.5) * 26
        const y = cy + (rnd() - 0.5) * 26
        const r = 4 + rnd() * 18
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(rnd() * Math.PI)
        ctx.scale(1, 0.35 + rnd() * 0.9)
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
        g.addColorStop(0, `rgba(0,0,0,${1 - core})`)
        g.addColorStop(0.55, `rgba(0,0,0,${0.5 - core * 0.5})`)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.fillRect(-r, -r, r * 2, r * 2)
        ctx.restore()
      }
    }
    // jagged leech: the trailing edge (u → 1) and foot (v → 0) go first
    const edge = ctx.createLinearGradient(size * 0.7, 0, size, 0)
    edge.addColorStop(0, 'rgba(0,0,0,0)')
    edge.addColorStop(1, 'rgba(0,0,0,0.45)')
    ctx.fillStyle = edge
    ctx.fillRect(0, 0, size, size)
    const foot = ctx.createLinearGradient(0, size, 0, size * 0.65)
    foot.addColorStop(0, 'rgba(0,0,0,0.4)')
    foot.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = foot
    ctx.fillRect(0, 0, size, size)
    const t = tex(c, false, false)
    return t
  })
}

/** Jolly Roger: skull over crossed bones on black. Drawn with canvas primitives, no assets. */
export function jollyRogerTexture(): THREE.CanvasTexture {
  return memo('flag:jolly-roger', () => {
    const w = 512
    const h = 320
    const [c, ctx] = canvas(w, h)
    ctx.fillStyle = '#0c0b0a'
    ctx.fillRect(0, 0, w, h)
    // cloth weave
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = 'rgba(255,255,255,0.035)'
      ctx.fillRect(0, y, w, 1)
    }
    const cx = w * 0.5
    const cy = h * 0.42
    ctx.fillStyle = '#efe9dc'
    ctx.strokeStyle = '#efe9dc'
    ctx.lineCap = 'round'
    // crossed bones
    ctx.lineWidth = 16
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      ctx.save()
      ctx.translate(cx, h * 0.62)
      ctx.rotate(a)
      ctx.beginPath()
      ctx.moveTo(-120, 0)
      ctx.lineTo(120, 0)
      ctx.stroke()
      for (const e of [-120, 120]) {
        ctx.beginPath()
        ctx.arc(e, -11, 13, 0, Math.PI * 2)
        ctx.arc(e, 11, 13, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
    // skull
    ctx.beginPath()
    ctx.ellipse(cx, cy, 70, 64, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(cx - 44, cy + 30, 88, 46)
    ctx.beginPath()
    ctx.roundRect(cx - 44, cy + 30, 88, 50, 14)
    ctx.fill()
    ctx.fillStyle = '#0c0b0a'
    for (const s of [-1, 1]) {
      ctx.beginPath()
      ctx.ellipse(cx + s * 28, cy - 4, 20, 24, s * 0.25, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.beginPath()
    ctx.moveTo(cx, cy + 20)
    ctx.lineTo(cx - 10, cy + 42)
    ctx.lineTo(cx + 10, cy + 42)
    ctx.fill()
    for (let i = -3; i <= 3; i++) {
      ctx.fillRect(cx + i * 12 - 1.5, cy + 58, 3, 20)
    }
    return tex(c, true, false)
  })
}

/** Red Ensign: red field with the pre-1801 Union canton (St George over St Andrew). */
export function redEnsignTexture(): THREE.CanvasTexture {
  return memo('flag:red-ensign', () => {
    const w = 512
    const h = 320
    const [c, ctx] = canvas(w, h)
    ctx.fillStyle = '#b4141f'
    ctx.fillRect(0, 0, w, h)
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.05)'
      ctx.fillRect(0, y, w, 1)
    }
    const cw = w * 0.42
    const ch = h * 0.5
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, cw, ch)
    ctx.clip()
    ctx.fillStyle = '#1b2f6b'
    ctx.fillRect(0, 0, cw, ch)
    ctx.strokeStyle = '#f2f0ea'
    ctx.lineWidth = 18
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(cw, ch)
    ctx.moveTo(cw, 0)
    ctx.lineTo(0, ch)
    ctx.stroke()
    ctx.lineWidth = 30
    ctx.beginPath()
    ctx.moveTo(cw / 2, 0)
    ctx.lineTo(cw / 2, ch)
    ctx.moveTo(0, ch / 2)
    ctx.lineTo(cw, ch / 2)
    ctx.stroke()
    ctx.strokeStyle = '#c8102e'
    ctx.lineWidth = 16
    ctx.stroke()
    ctx.restore()
    return tex(c, true, false)
  })
}

/** Scorched deck decal: soot cloud with a hot core, alpha fades out at the edge. */
export function charTexture(seed: number): THREE.CanvasTexture {
  return memo(`char:${seed}`, () => {
    const size = 256
    const [c, ctx] = canvas(size)
    const rnd = seededRandom(seed)
    ctx.clearRect(0, 0, size, size)
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2
      const d = rnd() * size * 0.3
      const x = size / 2 + Math.cos(a) * d
      const y = size / 2 + Math.sin(a) * d
      const r = size * (0.12 + rnd() * 0.22)
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, 'rgba(8,5,3,0.95)')
      g.addColorStop(0.6, 'rgba(14,9,5,0.6)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    return tex(c, true, false)
  })
}
