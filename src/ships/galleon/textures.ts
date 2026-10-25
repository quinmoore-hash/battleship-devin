/**
 * Procedural canvas textures for the galleon (planking, sail cloth, painted side panels, carved gilt, iron,
 * weed/barnacle band). Every texture is seeded so screenshots are reproducible, cached by key, and safe to
 * import without a DOM (`document` missing → `null`, materials fall back to flat colours).
 */
import * as THREE from 'three'
import { seededRandom } from '../../vfx/random'

const cache = new Map<string, THREE.CanvasTexture | null>()

type Ctx = CanvasRenderingContext2D

function makeCanvas(size: number): [HTMLCanvasElement, Ctx] | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  return ctx ? [c, ctx] : null
}

function finish(canvas: HTMLCanvasElement, color: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  if (color) t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

function cached(key: string, build: () => THREE.CanvasTexture | null): THREE.CanvasTexture | null {
  if (cache.has(key)) return cache.get(key)!
  const t = build()
  cache.set(key, t)
  return t
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgb = (c: [number, number, number], k = 1) => `rgb(${Math.round(c[0] * k)},${Math.round(c[1] * k)},${Math.round(c[2] * k)})`
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

export interface PlankOptions {
  /** Base wood colour (hex). */
  base: string
  /** Darker grain / seam colour. */
  dark: string
  /** Highlight colour. */
  light: string
  /** Plank rows across the texture. */
  rows?: number
  /** Planks per row along the texture (joints are staggered). */
  perRow?: number
  nails?: boolean
  seed?: number
  /** `true` returns the greyscale relief map instead of the colour map. */
  bump?: boolean
}

/** Weathered planking with per-plank tone, grain streaks, caulked seams, staggered butt joints and nail rows. */
export function plankTexture(o: PlankOptions): THREE.CanvasTexture | null {
  const key = `plank:${JSON.stringify(o)}`
  return cached(key, () => {
    const size = 512
    const made = makeCanvas(size)
    if (!made) return null
    const [canvas, ctx] = made
    const rows = o.rows ?? 8
    const perRow = o.perRow ?? 3
    const rnd = seededRandom(o.seed ?? 7)
    const base = hexToRgb(o.base)
    const dark = hexToRgb(o.dark)
    const light = hexToRgb(o.light)
    const rowH = size / rows
    const bump = !!o.bump
    ctx.fillStyle = bump ? '#808080' : rgb(base)
    ctx.fillRect(0, 0, size, size)
    for (let r = 0; r < rows; r++) {
      const y0 = r * rowH
      const offset = ((r * 0.37 + rnd() * 0.3) % 1) * (size / perRow)
      for (let p = -1; p < perRow + 1; p++) {
        const x0 = p * (size / perRow) + offset
        const w = size / perRow
        const tone = rnd()
        const col = mix(mix(dark, base, 0.55 + 0.45 * tone), light, rnd() * 0.25)
        ctx.fillStyle = bump ? `rgb(${120 + Math.round(tone * 30)},${120 + Math.round(tone * 30)},${120 + Math.round(tone * 30)})` : rgb(col)
        ctx.fillRect(x0, y0 + 1, w - 2, rowH - 2)
        // grain streaks
        const streaks = 14
        for (let s = 0; s < streaks; s++) {
          const gy = y0 + 2 + rnd() * (rowH - 4)
          const len = w * (0.3 + rnd() * 0.7)
          const gx = x0 + rnd() * (w - len)
          ctx.strokeStyle = bump ? `rgba(${rnd() > 0.5 ? 90 : 160},${rnd() > 0.5 ? 90 : 160},130,0.35)` : `rgba(${dark[0]},${dark[1]},${dark[2]},${0.12 + rnd() * 0.25})`
          ctx.lineWidth = 0.6 + rnd() * 1.2
          ctx.beginPath()
          ctx.moveTo(gx, gy)
          ctx.bezierCurveTo(gx + len * 0.3, gy + (rnd() - 0.5) * 3, gx + len * 0.6, gy + (rnd() - 0.5) * 3, gx + len, gy + (rnd() - 0.5) * 2)
          ctx.stroke()
        }
        // butt joint (dark seam) at the end of the plank
        ctx.fillStyle = bump ? '#303030' : rgb(dark, 0.6)
        ctx.fillRect(x0 + w - 2, y0, 2.5, rowH)
        if (o.nails !== false) {
          ctx.fillStyle = bump ? '#f0f0f0' : '#1d1a17'
          for (const nx of [x0 + 7, x0 + w - 9]) {
            for (const ny of [y0 + rowH * 0.3, y0 + rowH * 0.7]) {
              ctx.beginPath()
              ctx.arc(nx + (rnd() - 0.5) * 1.5, ny + (rnd() - 0.5) * 1.5, 1.6, 0, Math.PI * 2)
              ctx.fill()
            }
          }
        }
      }
      // caulked seam between rows
      ctx.fillStyle = bump ? '#202020' : rgb(dark, 0.55)
      ctx.fillRect(0, y0 - 1, size, 2.5)
    }
    // grime / weathering noise
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * size
      const y = rnd() * size
      const k = rnd()
      ctx.fillStyle = bump ? `rgba(${k > 0.5 ? 200 : 60},${k > 0.5 ? 200 : 60},${k > 0.5 ? 200 : 60},0.08)` : `rgba(${k > 0.5 ? 255 : 0},${k > 0.5 ? 240 : 0},${k > 0.5 ? 220 : 0},${0.03 + rnd() * 0.05})`
      ctx.fillRect(x, y, 1 + rnd() * 3, 1 + rnd() * 2)
    }
    return finish(canvas, !bump)
  })
}

/** Sail cloth: vertical panels with stitched seams, weave noise, reinforced edges and patches. */
export function sailTexture(color: string, seamColor: string, seed = 3, bump = false): THREE.CanvasTexture | null {
  return cached(`sail:${color}:${seamColor}:${seed}:${bump}`, () => {
    const size = 512
    const made = makeCanvas(size)
    if (!made) return null
    const [canvas, ctx] = made
    const rnd = seededRandom(seed)
    const base = hexToRgb(color)
    ctx.fillStyle = bump ? '#808080' : rgb(base)
    ctx.fillRect(0, 0, size, size)
    const panels = 7
    for (let p = 0; p < panels; p++) {
      const x0 = (size / panels) * p
      const tone = 0.93 + rnd() * 0.12
      ctx.fillStyle = bump ? `rgb(${125 + Math.round(rnd() * 8)},128,128)` : rgb(base, tone)
      ctx.fillRect(x0, 0, size / panels, size)
      ctx.strokeStyle = bump ? '#505050' : seamColor
      ctx.lineWidth = 2
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.moveTo(x0 + 3, 0)
      ctx.lineTo(x0 + 3, size)
      ctx.stroke()
      ctx.setLineDash([])
    }
    // weave
    for (let i = 0; i < 9000; i++) {
      const x = rnd() * size
      const y = rnd() * size
      const k = rnd() > 0.5
      ctx.fillStyle = bump ? (k ? 'rgba(170,170,170,0.25)' : 'rgba(90,90,90,0.25)') : k ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'
      ctx.fillRect(x, y, 1, 2 + rnd() * 3)
    }
    // horizontal reef bands
    for (const y of [size * 0.22, size * 0.42]) {
      ctx.strokeStyle = bump ? '#606060' : seamColor
      ctx.lineWidth = 2
      ctx.setLineDash([6, 5])
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(size, y)
      ctx.stroke()
      ctx.setLineDash([])
    }
    // patches
    for (let i = 0; i < 3; i++) {
      const w = 30 + rnd() * 40
      const h = 24 + rnd() * 36
      const x = rnd() * (size - w)
      const y = rnd() * (size - h)
      ctx.fillStyle = bump ? '#9a9a9a' : rgb(base, 0.85 + rnd() * 0.1)
      ctx.fillRect(x, y, w, h)
      ctx.strokeStyle = bump ? '#505050' : seamColor
      ctx.setLineDash([3, 3])
      ctx.strokeRect(x, y, w, h)
      ctx.setLineDash([])
    }
    return finish(canvas, !bump)
  })
}

/**
 * Alpha map for a torn sail: opaque cloth with a ragged lower edge and shot holes whose extent grows with
 * `level` (0 pristine … 1 almost nothing left). v = 1 is the head (yard), v = 0 the foot.
 */
export function tornAlpha(level: number, seed = 11): THREE.CanvasTexture | null {
  const q = Math.round(level * 4) / 4
  return cached(`torn:${q}:${seed}`, () => {
    const size = 256
    const made = makeCanvas(size)
    if (!made) return null
    const [canvas, ctx] = made
    const rnd = seededRandom(seed + Math.round(q * 100))
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, size, size)
    if (q <= 0) return finish(canvas, false)
    ctx.fillStyle = '#000'
    // ragged foot: the cloth hangs in strips whose length shrinks with damage
    const strips = 12
    const footY = size * (1 - 0.15 - 0.75 * q)
    ctx.beginPath()
    ctx.moveTo(0, size)
    ctx.lineTo(0, footY + rnd() * 40)
    for (let i = 0; i <= strips; i++) {
      const x = (size / strips) * i
      const keep = rnd() < 0.5 ? 0 : 1
      ctx.lineTo(x, footY + rnd() * 50 * q + keep * (size - footY) * 0.55 * (1 - q))
      ctx.lineTo(x + size / strips / 2, footY - rnd() * 30 * q)
    }
    ctx.lineTo(size, size)
    ctx.closePath()
    ctx.fill()
    // shot holes
    const holes = Math.round(2 + q * 10)
    for (let i = 0; i < holes; i++) {
      const cx = rnd() * size
      const cy = rnd() * footY
      const r = 6 + rnd() * 18 * q
      ctx.beginPath()
      for (let a = 0; a < 10; a++) {
        const ang = (a / 10) * Math.PI * 2
        const rr = r * (0.6 + rnd() * 0.6)
        ctx.lineTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr)
      }
      ctx.closePath()
      ctx.fill()
    }
    // slashes
    for (let i = 0; i < Math.round(q * 4); i++) {
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 2 + rnd() * 4
      ctx.beginPath()
      const x = rnd() * size
      const y = rnd() * footY
      ctx.moveTo(x, y)
      ctx.lineTo(x + (rnd() - 0.5) * 40, y + 40 + rnd() * 80)
      ctx.stroke()
    }
    return finish(canvas, false)
  })
}

/** Painted gun-stripe panels along the side: framed rectangles with a diamond boss, tiled along u. */
export function panelTexture(bg: string, frame: string, boss: string, seed = 5): THREE.CanvasTexture | null {
  return cached(`panel:${bg}:${frame}:${boss}:${seed}`, () => {
    const w = 512
    const h = 128
    if (typeof document === 'undefined') return null
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const rnd = seededRandom(seed)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)
    const panels = 4
    for (let p = 0; p < panels; p++) {
      const x0 = (w / panels) * p
      const pw = w / panels
      ctx.strokeStyle = frame
      ctx.lineWidth = 6
      ctx.strokeRect(x0 + 10, 12, pw - 20, h - 24)
      ctx.lineWidth = 2
      ctx.strokeRect(x0 + 18, 20, pw - 36, h - 40)
      ctx.fillStyle = boss
      ctx.beginPath()
      ctx.moveTo(x0 + pw / 2, h / 2 - 22)
      ctx.lineTo(x0 + pw / 2 + 16, h / 2)
      ctx.lineTo(x0 + pw / 2, h / 2 + 22)
      ctx.lineTo(x0 + pw / 2 - 16, h / 2)
      ctx.closePath()
      ctx.fill()
      for (const dx of [-pw / 2 + 36, pw / 2 - 36]) {
        ctx.beginPath()
        ctx.arc(x0 + pw / 2 + dx, h / 2, 5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    for (let i = 0; i < 1500; i++) {
      ctx.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'
      ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 2)
    }
    return finish(canvas, true)
  })
}

/** Gilded carving: scrollwork and acanthus leaves in gold over a painted base (stern, beakhead, quarter pieces). */
export function carvedTexture(bg: string, gold: string, seed = 9): THREE.CanvasTexture | null {
  return cached(`carved:${bg}:${gold}:${seed}`, () => {
    const size = 256
    const made = makeCanvas(size)
    if (!made) return null
    const [canvas, ctx] = made
    const rnd = seededRandom(seed)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, size, size)
    ctx.strokeStyle = gold
    ctx.fillStyle = gold
    ctx.lineWidth = 3
    ctx.strokeRect(6, 6, size - 12, size - 12)
    for (let i = 0; i < 10; i++) {
      const cx = 30 + rnd() * (size - 60)
      const cy = 30 + rnd() * (size - 60)
      const r = 10 + rnd() * 18
      ctx.beginPath()
      for (let a = 0; a < Math.PI * 4; a += 0.2) {
        const rr = (r * a) / (Math.PI * 4)
        const x = cx + Math.cos(a) * rr
        const y = cy + Math.sin(a) * rr
        if (a === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.beginPath()
      ctx.ellipse(cx + r, cy, r * 0.9, r * 0.35, rnd() * Math.PI, 0, Math.PI * 2)
      ctx.stroke()
    }
    for (let i = 0; i < 6; i++) {
      const x = rnd() * size
      const y = rnd() * size
      ctx.beginPath()
      ctx.arc(x, y, 4 + rnd() * 3, 0, Math.PI * 2)
      ctx.fill()
    }
    return finish(canvas, true)
  })
}

/** Cast iron: near-black with rust pitting. */
export function ironTexture(seed = 13): THREE.CanvasTexture | null {
  return cached(`iron:${seed}`, () => {
    const size = 128
    const made = makeCanvas(size)
    if (!made) return null
    const [canvas, ctx] = made
    const rnd = seededRandom(seed)
    ctx.fillStyle = '#2b2b2f'
    ctx.fillRect(0, 0, size, size)
    for (let i = 0; i < 1800; i++) {
      const k = rnd()
      ctx.fillStyle = k > 0.85 ? 'rgba(120,70,40,0.35)' : k > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)'
      ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2)
    }
    return finish(canvas, true)
  })
}

/** Below the waterline: tarred/coppered planks fading into a green weed and white barnacle band near v = 1. */
export function barnacleTexture(base: string, seed = 17): THREE.CanvasTexture | null {
  return cached(`barnacle:${base}:${seed}`, () => {
    const size = 256
    const made = makeCanvas(size)
    if (!made) return null
    const [canvas, ctx] = made
    const rnd = seededRandom(seed)
    const b = hexToRgb(base)
    ctx.fillStyle = rgb(b)
    ctx.fillRect(0, 0, size, size)
    for (let r = 0; r < 6; r++) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(0, (size / 6) * r, size, 2)
    }
    // weed gradient toward the top (v=1 is the waterline edge)
    const grad = ctx.createLinearGradient(0, size, 0, 0)
    grad.addColorStop(0, 'rgba(40,70,40,0)')
    grad.addColorStop(0.55, 'rgba(45,80,45,0.35)')
    grad.addColorStop(1, 'rgba(70,100,55,0.75)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    for (let i = 0; i < 700; i++) {
      const y = rnd() ** 2 * size * 0.6
      ctx.fillStyle = rnd() > 0.55 ? 'rgba(235,230,215,0.8)' : 'rgba(60,90,50,0.6)'
      ctx.beginPath()
      ctx.arc(rnd() * size, y, 0.8 + rnd() * 2.2, 0, Math.PI * 2)
      ctx.fill()
    }
    return finish(canvas, true)
  })
}

/** Jolly Roger (pirate) or a red ensign with a canton (navy). */
export function flagTexture(livery: 'pirate' | 'navy'): THREE.CanvasTexture | null {
  return cached(`flag:${livery}`, () => {
    const w = 256
    const h = 160
    if (typeof document === 'undefined') return null
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    if (livery === 'pirate') {
      ctx.fillStyle = '#0d0c0c'
      ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#efe9dc'
      ctx.beginPath()
      ctx.ellipse(w / 2, h * 0.42, 34, 38, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillRect(w / 2 - 18, h * 0.6, 36, 18)
      ctx.fillStyle = '#0d0c0c'
      for (const dx of [-13, 13]) {
        ctx.beginPath()
        ctx.ellipse(w / 2 + dx, h * 0.4, 9, 11, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.beginPath()
      ctx.moveTo(w / 2, h * 0.5)
      ctx.lineTo(w / 2 - 6, h * 0.58)
      ctx.lineTo(w / 2 + 6, h * 0.58)
      ctx.fill()
      for (let i = 0; i < 4; i++) ctx.fillRect(w / 2 - 14 + i * 8, h * 0.6 + 4, 3, 10)
      ctx.strokeStyle = '#efe9dc'
      ctx.lineWidth = 9
      ctx.lineCap = 'round'
      for (const s of [1, -1]) {
        ctx.beginPath()
        ctx.moveTo(w / 2 - s * 62, h * 0.7)
        ctx.lineTo(w / 2 + s * 62, h * 0.9)
        ctx.stroke()
      }
    } else {
      ctx.fillStyle = '#c8102e'
      ctx.fillRect(0, 0, w, h)
      const cw = w * 0.42
      const ch = h * 0.5
      ctx.fillStyle = '#1f3f7a'
      ctx.fillRect(0, 0, cw, ch)
      ctx.strokeStyle = '#f4f1ea'
      ctx.lineWidth = 9
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(cw, ch)
      ctx.moveTo(cw, 0)
      ctx.lineTo(0, ch)
      ctx.stroke()
      ctx.lineWidth = 14
      ctx.beginPath()
      ctx.moveTo(cw / 2, 0)
      ctx.lineTo(cw / 2, ch)
      ctx.moveTo(0, ch / 2)
      ctx.lineTo(cw, ch / 2)
      ctx.stroke()
      ctx.strokeStyle = '#c8102e'
      ctx.lineWidth = 7
      ctx.stroke()
    }
    const t = finish(canvas, true)
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
    return t
  })
}
