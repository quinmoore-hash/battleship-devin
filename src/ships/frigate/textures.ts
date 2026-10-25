/**
 * Procedural canvas textures for the frigate: planked wood (hull strakes / deck), copper sheathing with
 * verdigris, the barnacle waterline band, sail canvas, hammock-netting cloth, gratings, flags and the
 * charred-deck decal. All randomness is seeded so screenshots are reproducible.
 */
import * as THREE from 'three'
import { seededRandom } from '../../vfx/random'
import type { Livery } from '../types'

export interface TexturePair {
  map: THREE.CanvasTexture
  bump?: THREE.CanvasTexture
}

const cache = new Map<string, TexturePair>()

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d canvas unavailable')
  return [c, ctx]
}

function finish(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 4
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex)
  c.offsetHSL(0, 0, amount)
  return `#${c.getHexString()}`
}

export interface PlankOptions {
  /** Base wood colour and darker seam colour. */
  color: string
  seam: string
  /** Number of plank rows across the tile. */
  rows: number
  /** Plank length as a fraction of the tile width. */
  plankLen: number
  seed: number
  size?: number
  nails?: boolean
  /** Horizontal strakes (hull) or planks running along +u (deck) — the same thing; `vertical` rotates 90°. */
  vertical?: boolean
  /** Tone variation between planks (0..1). */
  variance?: number
}

/** Tiled plank texture with grain, seams, staggered butt joints and nail heads. Also returns a bump map. */
export function plankTexture(o: PlankOptions): TexturePair {
  const key = `plank:${JSON.stringify(o)}`
  const hit = cache.get(key)
  if (hit) return hit
  const size = o.size ?? 512
  const rnd = seededRandom(o.seed)
  const [c, ctx] = canvas(size)
  const [bc, bctx] = canvas(size)
  const rowH = size / o.rows
  const plankW = size * o.plankLen
  const variance = o.variance ?? 0.08
  ctx.fillStyle = o.color
  ctx.fillRect(0, 0, size, size)
  bctx.fillStyle = '#808080'
  bctx.fillRect(0, 0, size, size)
  for (let r = 0; r < o.rows; r++) {
    const y0 = r * rowH
    const offset = ((r % 2) * 0.5 + rnd() * 0.3) * plankW
    for (let x0 = -plankW + offset; x0 < size; x0 += plankW) {
      const tone = (rnd() - 0.5) * 2 * variance
      ctx.fillStyle = shade(o.color, tone)
      ctx.fillRect(x0, y0, plankW, rowH)
      bctx.fillStyle = `rgb(${128 + tone * 60},${128 + tone * 60},${128 + tone * 60})`
      bctx.fillRect(x0, y0, plankW, rowH)
      // grain: wavy thin lines along the plank
      const lines = 6 + Math.floor(rnd() * 6)
      for (let i = 0; i < lines; i++) {
        const gy = y0 + rowH * (0.08 + 0.84 * rnd())
        const amp = rowH * 0.08 * rnd()
        const dark = rnd() < 0.5
        ctx.strokeStyle = shade(o.color, tone + (dark ? -0.08 - rnd() * 0.08 : 0.05 + rnd() * 0.04))
        ctx.globalAlpha = 0.55
        ctx.lineWidth = 0.6 + rnd() * 1.2
        ctx.beginPath()
        for (let gx = x0; gx <= x0 + plankW; gx += 8) {
          const yy = gy + Math.sin(gx * 0.03 + i) * amp
          if (gx === x0) ctx.moveTo(gx, yy)
          else ctx.lineTo(gx, yy)
        }
        ctx.stroke()
        bctx.strokeStyle = dark ? '#6a6a6a' : '#949494'
        bctx.globalAlpha = 0.5
        bctx.lineWidth = ctx.lineWidth
        bctx.beginPath()
        for (let gx = x0; gx <= x0 + plankW; gx += 8) {
          const yy = gy + Math.sin(gx * 0.03 + i) * amp
          if (gx === x0) bctx.moveTo(gx, yy)
          else bctx.lineTo(gx, yy)
        }
        bctx.stroke()
        ctx.globalAlpha = 1
        bctx.globalAlpha = 1
      }
      // butt joint
      ctx.fillStyle = o.seam
      ctx.fillRect(x0 + plankW - 1.5, y0, 2.5, rowH)
      bctx.fillStyle = '#303030'
      bctx.fillRect(x0 + plankW - 1.5, y0, 2.5, rowH)
      if (o.nails) {
        ctx.fillStyle = '#1a1512'
        bctx.fillStyle = '#404040'
        for (const nx of [x0 + 7, x0 + plankW - 9]) {
          for (const ny of [y0 + rowH * 0.28, y0 + rowH * 0.72]) {
            ctx.beginPath()
            ctx.arc(nx, ny, Math.max(1.2, rowH * 0.045), 0, Math.PI * 2)
            ctx.fill()
            bctx.beginPath()
            bctx.arc(nx, ny, Math.max(1.2, rowH * 0.045), 0, Math.PI * 2)
            bctx.fill()
          }
        }
      }
    }
    // seam between rows (caulking)
    ctx.fillStyle = o.seam
    ctx.fillRect(0, y0 + rowH - 1.5, size, 2.5)
    bctx.fillStyle = '#282828'
    bctx.fillRect(0, y0 + rowH - 1.5, size, 2.5)
  }
  // weathering speckle
  ctx.globalAlpha = 0.12
  for (let i = 0; i < size * 1.5; i++) {
    ctx.fillStyle = rnd() < 0.5 ? '#000' : '#fff'
    ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1)
  }
  ctx.globalAlpha = 1
  if (o.vertical) {
    for (const cv of [c, bc]) {
      const [rc, rctx] = canvas(size)
      rctx.translate(size / 2, size / 2)
      rctx.rotate(Math.PI / 2)
      rctx.drawImage(cv, -size / 2, -size / 2)
      cv.getContext('2d')?.drawImage(rc, 0, 0)
    }
  }
  const pair = { map: finish(c), bump: finish(bc, false) }
  cache.set(key, pair)
  return pair
}

/** Copper sheathing: staggered plates, nail rows, verdigris blooms. */
export function copperTexture(seed = 7, size = 512): TexturePair {
  const key = `copper:${seed}:${size}`
  const hit = cache.get(key)
  if (hit) return hit
  const rnd = seededRandom(seed)
  const [c, ctx] = canvas(size)
  const [bc, bctx] = canvas(size)
  const base = '#8d4f30'
  const rows = 6
  const cols = 4
  const ph = size / rows
  const pw = size / cols
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  bctx.fillStyle = '#808080'
  bctx.fillRect(0, 0, size, size)
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * pw * 0.5
    for (let x0 = -pw + off; x0 < size; x0 += pw) {
      const t = (rnd() - 0.5) * 0.14
      const grad = ctx.createLinearGradient(x0, r * ph, x0 + pw, r * ph + ph)
      grad.addColorStop(0, shade(base, t + 0.05))
      grad.addColorStop(1, shade(base, t - 0.05))
      ctx.fillStyle = grad
      ctx.fillRect(x0, r * ph, pw, ph)
      ctx.strokeStyle = '#4a2818'
      ctx.lineWidth = 2
      ctx.strokeRect(x0 + 1, r * ph + 1, pw - 2, ph - 2)
      bctx.strokeStyle = '#404040'
      bctx.lineWidth = 2.5
      bctx.strokeRect(x0 + 1, r * ph + 1, pw - 2, ph - 2)
      // nail rows
      ctx.fillStyle = '#5a3320'
      bctx.fillStyle = '#b0b0b0'
      for (let i = 1; i < 7; i++) {
        for (const [nx, ny] of [
          [x0 + (pw * i) / 7, r * ph + 5],
          [x0 + (pw * i) / 7, r * ph + ph - 5],
        ]) {
          ctx.beginPath()
          ctx.arc(nx, ny, 1.6, 0, Math.PI * 2)
          ctx.fill()
          bctx.beginPath()
          bctx.arc(nx, ny, 1.6, 0, Math.PI * 2)
          bctx.fill()
        }
      }
    }
  }
  // verdigris
  for (let i = 0; i < 70; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const rr = 6 + rnd() * 34
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr)
    g.addColorStop(0, `rgba(90,150,120,${0.35 + rnd() * 0.4})`)
    g.addColorStop(1, 'rgba(90,150,120,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2)
  }
  const pair = { map: finish(c), bump: finish(bc, false) }
  cache.set(key, pair)
  return pair
}

/** Waterline band: slime, weed streaks and barnacle clusters (tiles along u). */
export function waterlineTexture(seed = 11, size = 256): TexturePair {
  const key = `waterline:${seed}`
  const hit = cache.get(key)
  if (hit) return hit
  const rnd = seededRandom(seed)
  const [c, ctx] = canvas(size)
  const [bc, bctx] = canvas(size)
  const g = ctx.createLinearGradient(0, 0, 0, size)
  g.addColorStop(0, '#5f6b4a')
  g.addColorStop(0.55, '#3e4a36')
  g.addColorStop(1, '#6a4a30')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  bctx.fillStyle = '#707070'
  bctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 140; i++) {
    const x = rnd() * size
    const y = size * (0.1 + rnd() * 0.8)
    const r = 1.5 + rnd() * 4
    ctx.fillStyle = rnd() < 0.6 ? '#d9d2c2' : '#b7b1a3'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#6b665b'
    ctx.beginPath()
    ctx.arc(x, y, r * 0.35, 0, Math.PI * 2)
    ctx.fill()
    bctx.fillStyle = '#e0e0e0'
    bctx.beginPath()
    bctx.arc(x, y, r, 0, Math.PI * 2)
    bctx.fill()
  }
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = `rgba(60,90,50,${0.3 + rnd() * 0.4})`
    ctx.lineWidth = 1 + rnd() * 2
    const x = rnd() * size
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x + (rnd() - 0.5) * 20, size * (0.4 + rnd() * 0.6))
    ctx.stroke()
  }
  const pair = { map: finish(c), bump: finish(bc, false) }
  cache.set(key, pair)
  return pair
}

/** Sail cloth: vertical panel seams, two reef bands, weave noise and stains. */
export function sailTexture(livery: Livery, size = 512): TexturePair {
  const key = `sail:${livery}`
  const hit = cache.get(key)
  if (hit) return hit
  const rnd = seededRandom(livery === 'pirate' ? 21 : 22)
  const [c, ctx] = canvas(size)
  const base = livery === 'pirate' ? '#232120' : '#e6dcc4'
  const seam = livery === 'pirate' ? '#3a3633' : '#b9ad92'
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  // weave
  ctx.globalAlpha = 0.07
  for (let y = 0; y < size; y += 2) {
    ctx.fillStyle = y % 4 === 0 ? '#000' : '#fff'
    ctx.fillRect(0, y, size, 1)
  }
  for (let x = 0; x < size; x += 2) {
    ctx.fillStyle = x % 4 === 0 ? '#000' : '#fff'
    ctx.fillRect(x, 0, 1, size)
  }
  ctx.globalAlpha = 1
  const panels = 7
  for (let i = 1; i < panels; i++) {
    const x = (size * i) / panels
    ctx.fillStyle = seam
    ctx.fillRect(x - 1.5, 0, 3, size)
    ctx.fillStyle = livery === 'pirate' ? '#1a1817' : '#d8ceb6'
    ctx.fillRect(x + 1.5, 0, 1, size)
  }
  for (const fy of [0.22, 0.4]) {
    ctx.fillStyle = seam
    ctx.fillRect(0, size * fy - 2, size, 4)
    // reef points
    ctx.fillStyle = livery === 'pirate' ? '#5b4a35' : '#8c7a5c'
    for (let x = size / 28; x < size; x += size / 14) ctx.fillRect(x - 1, size * fy + 3, 2, size * 0.035)
  }
  // stains & wear
  for (let i = 0; i < 24; i++) {
    const x = rnd() * size
    const y = rnd() * size
    const r = 10 + rnd() * 60
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const dark = rnd() < 0.6
    const col = livery === 'pirate' ? (dark ? '0,0,0' : '120,110,95') : dark ? '110,90,60' : '255,250,235'
    g.addColorStop(0, `rgba(${col},${0.1 + rnd() * 0.15})`)
    g.addColorStop(1, `rgba(${col},0)`)
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  const pair = { map: finish(c) }
  cache.set(key, pair)
  return pair
}

/** Hammock-netting roll: canvas with a diamond net overlay. */
export function nettingTexture(livery: Livery, size = 256): TexturePair {
  const key = `net:${livery}`
  const hit = cache.get(key)
  if (hit) return hit
  const [c, ctx] = canvas(size)
  ctx.fillStyle = livery === 'pirate' ? '#4a443c' : '#d2c7ad'
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = livery === 'pirate' ? '#2a2622' : '#7d6d50'
  ctx.lineWidth = 2
  const step = size / 8
  for (let i = -size; i < size * 2; i += step) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + size, size)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(i + size, 0)
    ctx.lineTo(i, size)
    ctx.stroke()
  }
  const pair = { map: finish(c) }
  cache.set(key, pair)
  return pair
}

/** Hatch grating: wooden bars over a dark hold. */
export function gratingTexture(size = 128): TexturePair {
  const key = 'grating'
  const hit = cache.get(key)
  if (hit) return hit
  const [c, ctx] = canvas(size)
  ctx.fillStyle = '#0d0906'
  ctx.fillRect(0, 0, size, size)
  const n = 6
  const bar = size / n
  ctx.fillStyle = '#7a5c3a'
  for (let i = 0; i < n; i++) {
    ctx.fillRect(i * bar, 0, bar * 0.42, size)
    ctx.fillRect(0, i * bar, size, bar * 0.42)
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'
  for (let i = 0; i < n; i++) ctx.fillRect(i * bar + bar * 0.3, 0, bar * 0.12, size)
  const pair = { map: finish(c) }
  cache.set(key, pair)
  return pair
}

/** Jolly Roger (pirate) or a red ensign with a Union canton (navy). 2:1 aspect. */
export function flagTexture(livery: Livery): TexturePair {
  const key = `flag:${livery}`
  const hit = cache.get(key)
  if (hit) return hit
  const w = 512
  const h = 256
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2d canvas unavailable')
  if (livery === 'pirate') {
    ctx.fillStyle = '#0c0c0e'
    ctx.fillRect(0, 0, w, h)
    const cx = w / 2
    const cy = h * 0.42
    ctx.fillStyle = '#efe9dc'
    // bones
    ctx.save()
    ctx.translate(cx, h * 0.68)
    for (const a of [Math.PI / 5, -Math.PI / 5]) {
      ctx.save()
      ctx.rotate(a)
      ctx.fillRect(-110, -9, 220, 18)
      for (const ex of [-110, 110]) {
        ctx.beginPath()
        ctx.arc(ex, -9, 11, 0, Math.PI * 2)
        ctx.arc(ex, 9, 11, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
    }
    ctx.restore()
    // skull
    ctx.beginPath()
    ctx.ellipse(cx, cy, 62, 56, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(cx - 40, cy + 30, 80, 38)
    ctx.fillStyle = '#0c0c0e'
    ctx.beginPath()
    ctx.ellipse(cx - 24, cy - 2, 16, 20, 0.2, 0, Math.PI * 2)
    ctx.ellipse(cx + 24, cy - 2, 16, 20, -0.2, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(cx, cy + 22)
    ctx.lineTo(cx - 8, cy + 38)
    ctx.lineTo(cx + 8, cy + 38)
    ctx.fill()
    for (let i = -3; i <= 3; i++) ctx.fillRect(cx + i * 11 - 1.5, cy + 46, 3, 20)
  } else {
    ctx.fillStyle = '#b5121b'
    ctx.fillRect(0, 0, w, h)
    const cw = w / 2
    const ch = h / 2
    ctx.fillStyle = '#1b2f6b'
    ctx.fillRect(0, 0, cw, ch)
    ctx.strokeStyle = '#f2f2f2'
    ctx.lineWidth = 22
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(cw, ch)
    ctx.moveTo(cw, 0)
    ctx.lineTo(0, ch)
    ctx.stroke()
    ctx.strokeStyle = '#b5121b'
    ctx.lineWidth = 8
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(cw, ch)
    ctx.moveTo(cw, 0)
    ctx.lineTo(0, ch)
    ctx.stroke()
    ctx.fillStyle = '#f2f2f2'
    ctx.fillRect(cw / 2 - 20, 0, 40, ch)
    ctx.fillRect(0, ch / 2 - 20, cw, 40)
    ctx.fillStyle = '#b5121b'
    ctx.fillRect(cw / 2 - 12, 0, 24, ch)
    ctx.fillRect(0, ch / 2 - 12, cw, 24)
  }
  // cloth wear
  ctx.globalAlpha = 0.08
  for (let y = 0; y < h; y += 3) {
    ctx.fillStyle = y % 6 === 0 ? '#000' : '#fff'
    ctx.fillRect(0, y, w, 1)
  }
  ctx.globalAlpha = 1
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  t.anisotropy = 4
  const pair = { map: t }
  cache.set(key, pair)
  return pair
}

/** Soft-edged charred patch (alpha) laid over the deck of a hit cell. */
export function charTexture(seed = 5, size = 256): TexturePair {
  const key = `char:${seed}`
  const hit = cache.get(key)
  if (hit) return hit
  const rnd = seededRandom(seed)
  const [c, ctx] = canvas(size)
  ctx.clearRect(0, 0, size, size)
  const cx = size / 2
  const cy = size / 2
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2
    const d = rnd() * size * 0.22
    const r = size * (0.12 + rnd() * 0.22)
    const x = cx + Math.cos(a) * d
    const y = cy + Math.sin(a) * d
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'rgba(8,5,3,0.95)')
    g.addColorStop(0.6, 'rgba(14,9,5,0.6)')
    g.addColorStop(1, 'rgba(20,12,6,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  // embers / ash flecks
  for (let i = 0; i < 60; i++) {
    const a = rnd() * Math.PI * 2
    const d = rnd() * size * 0.3
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(120,110,100,0.5)' : 'rgba(60,40,25,0.7)'
    ctx.fillRect(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 2 + rnd() * 3, 1 + rnd() * 2)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  const pair = { map: t }
  cache.set(key, pair)
  return pair
}
