/**
 * Procedural canvas textures for the brigantine (planks, canvas weave, rope twist, flags, netting, scorch).
 * All randomness is seeded so screenshots are reproducible. Returns `null` outside a browser so the pure
 * modules stay importable from Vitest.
 */
import * as THREE from 'three'
import { seededRandom } from '../../vfx/random'

type Ctx = CanvasRenderingContext2D

function canvas(w: number, h: number): { c: HTMLCanvasElement; ctx: Ctx } | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) return null
  return { c, ctx }
}

function finish(c: HTMLCanvasElement, srgb: boolean, repeat: [number, number] = [1, 1]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat[0], repeat[1])
  t.anisotropy = 4
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.needsUpdate = true
  return t
}

const hex = (r: number, g: number, b: number) => `rgb(${Math.round(Math.max(0, Math.min(255, r)))},${Math.round(Math.max(0, Math.min(255, g)))},${Math.round(Math.max(0, Math.min(255, b)))})`

function parse(color: string): [number, number, number] {
  const c = new THREE.Color(color)
  return [c.r * 255, c.g * 255, c.b * 255]
}

export interface PlankOptions {
  /** Base wood colour. */
  color: string
  /** Rows of planks across the texture height. */
  rows?: number
  /** Brightness variation between planks, 0..1. */
  variation?: number
  /** Draw nail heads along plank ends and at intervals. */
  nails?: boolean
  /** Dark caulking seams between planks. */
  seam?: string
  seed?: number
  size?: number
}

export interface PlankMaps {
  map: THREE.Texture
  bumpMap: THREE.Texture
  roughnessMap: THREE.Texture
}

/** Horizontal planks with grain, staggered butt joints, caulked seams and nail rows. */
export function plankTextures(o: PlankOptions): PlankMaps | null {
  const size = o.size ?? 512
  const col = canvas(size, size)
  const bmp = canvas(size, size)
  const rgh = canvas(size, size)
  if (!col || !bmp || !rgh) return null
  const rows = o.rows ?? 10
  const rnd = seededRandom(o.seed ?? 7)
  const [br, bg, bb] = parse(o.color)
  const variation = o.variation ?? 0.18
  const rowH = size / rows
  const ctx = col.ctx
  const bctx = bmp.ctx
  const rctx = rgh.ctx
  bctx.fillStyle = '#808080'
  bctx.fillRect(0, 0, size, size)
  rctx.fillStyle = '#b8b8b8'
  rctx.fillRect(0, 0, size, size)

  for (let r = 0; r < rows; r++) {
    const y0 = r * rowH
    const shade = 1 + (rnd() - 0.5) * 2 * variation
    // each row is split into 2–3 planks with staggered joints
    const joints = [0]
    let x = rnd() * size * 0.5
    while (x < size) {
      joints.push(x)
      x += size * (0.4 + rnd() * 0.4)
    }
    joints.push(size)
    for (let j = 0; j < joints.length - 1; j++) {
      const x0 = joints[j]
      const x1 = joints[j + 1]
      const ps = shade * (1 + (rnd() - 0.5) * variation)
      ctx.fillStyle = hex(br * ps, bg * ps, bb * ps)
      ctx.fillRect(x0, y0, x1 - x0, rowH)
      // grain: long wavy strokes
      const grainN = 14
      for (let g = 0; g < grainN; g++) {
        const gy = y0 + rowH * (0.08 + 0.84 * (g + rnd() * 0.6) / grainN)
        const dark = rnd() < 0.5
        const k = dark ? 0.82 - rnd() * 0.1 : 1.08 + rnd() * 0.08
        ctx.strokeStyle = hex(br * ps * k, bg * ps * k, bb * ps * k)
        ctx.lineWidth = 0.6 + rnd() * 1.2
        ctx.globalAlpha = 0.35 + rnd() * 0.3
        ctx.beginPath()
        const amp = 1 + rnd() * 2.5
        const freq = 0.01 + rnd() * 0.02
        for (let gx = x0; gx <= x1; gx += 6) {
          const yy = gy + Math.sin(gx * freq + g) * amp
          if (gx === x0) ctx.moveTo(gx, yy)
          else ctx.lineTo(gx, yy)
        }
        ctx.stroke()
        bctx.strokeStyle = dark ? '#6a6a6a' : '#9a9a9a'
        bctx.lineWidth = ctx.lineWidth
        bctx.globalAlpha = 0.5
        bctx.beginPath()
        for (let gx = x0; gx <= x1; gx += 6) {
          const yy = gy + Math.sin(gx * freq + g) * amp
          if (gx === x0) bctx.moveTo(gx, yy)
          else bctx.lineTo(gx, yy)
        }
        bctx.stroke()
      }
      ctx.globalAlpha = 1
      bctx.globalAlpha = 1
      // knots
      if (rnd() < 0.3) {
        const kx = x0 + (x1 - x0) * (0.2 + rnd() * 0.6)
        const ky = y0 + rowH * (0.3 + rnd() * 0.4)
        const kr = rowH * (0.1 + rnd() * 0.12)
        const grad = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr)
        grad.addColorStop(0, hex(br * 0.45, bg * 0.4, bb * 0.35))
        grad.addColorStop(0.6, hex(br * 0.7, bg * 0.65, bb * 0.6))
        grad.addColorStop(1, hex(br * ps, bg * ps, bb * ps))
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.ellipse(kx, ky, kr * 1.4, kr, 0, 0, Math.PI * 2)
        ctx.fill()
      }
      // plank edge highlight / shadow + butt joint
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.fillRect(x0, y0 + rowH - 1.5, x1 - x0, 1.5)
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.fillRect(x0, y0, x1 - x0, 1)
      if (j > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        ctx.fillRect(x0 - 1, y0, 2, rowH)
        bctx.fillStyle = '#404040'
        bctx.fillRect(x0 - 1.5, y0, 3, rowH)
      }
      // nails
      if (o.nails !== false) {
        const nailAt = (nx: number) => {
          for (const ny of [y0 + rowH * 0.28, y0 + rowH * 0.72]) {
            ctx.fillStyle = 'rgba(20,16,12,0.9)'
            ctx.beginPath()
            ctx.arc(nx, ny, 1.6, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = 'rgba(160,150,130,0.6)'
            ctx.beginPath()
            ctx.arc(nx - 0.5, ny - 0.5, 0.7, 0, Math.PI * 2)
            ctx.fill()
            bctx.fillStyle = '#c8c8c8'
            bctx.beginPath()
            bctx.arc(nx, ny, 1.8, 0, Math.PI * 2)
            bctx.fill()
            rctx.fillStyle = '#505050'
            rctx.beginPath()
            rctx.arc(nx, ny, 2.2, 0, Math.PI * 2)
            rctx.fill()
          }
        }
        nailAt(x0 + 5)
        nailAt(x1 - 5)
        const span = size / 3
        for (let nx = x0 + span; nx < x1 - 20; nx += span) nailAt(nx)
      }
    }
    // seam between rows
    ctx.fillStyle = o.seam ?? 'rgba(10,8,6,0.85)'
    ctx.fillRect(0, y0 + rowH - 2.5, size, 2.5)
    bctx.fillStyle = '#303030'
    bctx.fillRect(0, y0 + rowH - 3, size, 3)
    rctx.fillStyle = '#e0e0e0'
    rctx.fillRect(0, y0 + rowH - 3, size, 3)
  }
  // weathering: faint vertical streaks
  ctx.globalAlpha = 0.08
  for (let i = 0; i < 40; i++) {
    const sx = rnd() * size
    ctx.fillStyle = rnd() < 0.5 ? '#000' : '#fff'
    ctx.fillRect(sx, 0, 1 + rnd() * 6, size)
  }
  ctx.globalAlpha = 1
  return { map: finish(col.c, true), bumpMap: finish(bmp.c, false), roughnessMap: finish(rgh.c, false) }
}

/** Sailcloth: woven texture, vertical panel seams, reef bands and dirt. `color` is the cloth colour. */
export function sailclothTextures(color: string, seed = 3): { map: THREE.Texture; bumpMap: THREE.Texture } | null {
  const size = 512
  const col = canvas(size, size)
  const bmp = canvas(size, size)
  if (!col || !bmp) return null
  const rnd = seededRandom(seed)
  const [r, g, b] = parse(color)
  const { ctx } = col
  const bctx = bmp.ctx
  ctx.fillStyle = hex(r, g, b)
  ctx.fillRect(0, 0, size, size)
  bctx.fillStyle = '#808080'
  bctx.fillRect(0, 0, size, size)
  // weave
  const img = ctx.getImageData(0, 0, size, size)
  const d = img.data
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const weave = ((x >> 1) + (y >> 1)) % 2 === 0 ? 1 : -1
      const n = (rnd() - 0.5) * 10 + weave * 5
      d[i] = Math.max(0, Math.min(255, d[i] + n))
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n))
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n))
    }
  }
  ctx.putImageData(img, 0, 0)
  // panel seams (vertical cloths ~ 60px) with double stitching
  const dark = r + g + b > 300 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.12)'
  const light = r + g + b > 300 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.06)'
  for (let x = 0; x < size; x += 64) {
    ctx.fillStyle = dark
    ctx.fillRect(x, 0, 2, size)
    ctx.fillStyle = light
    ctx.fillRect(x + 3, 0, 1, size)
    bctx.fillStyle = '#5a5a5a'
    bctx.fillRect(x, 0, 2, size)
    bctx.fillStyle = '#a0a0a0'
    bctx.fillRect(x + 3, 0, 1, size)
  }
  // reef bands: two horizontal reinforced bands with reef points
  for (const y of [size * 0.3, size * 0.55]) {
    ctx.fillStyle = dark
    ctx.fillRect(0, y, size, 3)
    for (let x = 16; x < size; x += 32) {
      ctx.fillStyle = 'rgba(90,70,40,0.8)'
      ctx.fillRect(x, y + 3, 2, 14)
    }
  }
  // stains
  for (let i = 0; i < 14; i++) {
    const sx = rnd() * size
    const sy = rnd() * size
    const sr = 20 + rnd() * 70
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr)
    grad.addColorStop(0, r + g + b > 300 ? 'rgba(110,90,60,0.18)' : 'rgba(0,0,0,0.25)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = grad
    ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2)
  }
  // bolt rope along the bottom edge
  ctx.fillStyle = 'rgba(70,55,35,0.9)'
  ctx.fillRect(0, size - 5, size, 5)
  return { map: finish(col.c, true), bumpMap: finish(bmp.c, false) }
}

/** Twisted three-strand rope, tiles along v. */
export function ropeTextures(color: string): { map: THREE.Texture; bumpMap: THREE.Texture } | null {
  const w = 32
  const h = 64
  const col = canvas(w, h)
  const bmp = canvas(w, h)
  if (!col || !bmp) return null
  const [r, g, b] = parse(color)
  const { ctx } = col
  const bctx = bmp.ctx
  ctx.fillStyle = hex(r * 0.55, g * 0.55, b * 0.55)
  ctx.fillRect(0, 0, w, h)
  bctx.fillStyle = '#404040'
  bctx.fillRect(0, 0, w, h)
  for (let k = 0; k < 3; k++) {
    ctx.strokeStyle = hex(r, g, b)
    ctx.lineWidth = 9
    ctx.lineCap = 'round'
    bctx.strokeStyle = '#b0b0b0'
    bctx.lineWidth = 9
    for (const off of [-h, 0, h]) {
      ctx.beginPath()
      ctx.moveTo(-4, off + (k * h) / 3)
      ctx.lineTo(w + 4, off + (k * h) / 3 + h * 0.5)
      ctx.stroke()
      bctx.beginPath()
      bctx.moveTo(-4, off + (k * h) / 3)
      bctx.lineTo(w + 4, off + (k * h) / 3 + h * 0.5)
      bctx.stroke()
    }
    ctx.strokeStyle = hex(r * 1.25, g * 1.2, b * 1.15)
    ctx.lineWidth = 2
    for (const off of [-h, 0, h]) {
      ctx.beginPath()
      ctx.moveTo(-4, off + (k * h) / 3 - 2)
      ctx.lineTo(w + 4, off + (k * h) / 3 + h * 0.5 - 2)
      ctx.stroke()
    }
  }
  return { map: finish(col.c, true, [1, 8]), bumpMap: finish(bmp.c, false, [1, 8]) }
}

/** Jolly Roger (skull and crossed cutlasses on black) or the red ensign with a Union canton. */
export function flagTexture(kind: 'jolly-roger' | 'red-ensign'): THREE.Texture | null {
  const w = 512
  const h = 320
  const c = canvas(w, h)
  if (!c) return null
  const { ctx } = c
  if (kind === 'jolly-roger') {
    ctx.fillStyle = '#0c0b0a'
    ctx.fillRect(0, 0, w, h)
    // worn cloth
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    for (let i = 0; i < w; i += 12) ctx.fillRect(i, 0, 3, h)
    const cx = w * 0.5
    const cy = h * 0.42
    const bone = '#ece6d6'
    // crossed cutlasses behind the skull
    ctx.save()
    ctx.translate(cx, cy + 40)
    for (const s of [1, -1]) {
      ctx.save()
      ctx.rotate(s * 0.65)
      ctx.fillStyle = bone
      ctx.fillRect(-150, -8, 300, 16) // blade
      ctx.fillStyle = '#c9b48a'
      ctx.fillRect(-150, -16, 24, 32) // guard
      ctx.fillStyle = '#5a3d1e'
      ctx.fillRect(-190, -9, 44, 18) // grip
      ctx.fillStyle = bone
      ctx.beginPath()
      ctx.moveTo(150, -8)
      ctx.lineTo(176, -22)
      ctx.lineTo(150, 8)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
    ctx.restore()
    // skull
    ctx.fillStyle = bone
    ctx.beginPath()
    ctx.ellipse(cx, cy, 78, 70, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillRect(cx - 48, cy + 40, 96, 42)
    ctx.fillStyle = '#0c0b0a'
    for (const s of [-1, 1]) {
      ctx.beginPath()
      ctx.ellipse(cx + s * 30, cy - 4, 20, 25, s * 0.2, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.beginPath()
    ctx.moveTo(cx, cy + 20)
    ctx.lineTo(cx - 10, cy + 42)
    ctx.lineTo(cx + 10, cy + 42)
    ctx.closePath()
    ctx.fill()
    for (let i = -3; i <= 3; i++) ctx.fillRect(cx + i * 13 - 1, cy + 50, 2, 32)
    ctx.fillRect(cx - 48, cy + 66, 96, 2)
    // cheekbone shading
    ctx.fillStyle = 'rgba(0,0,0,0.12)'
    ctx.beginPath()
    ctx.ellipse(cx, cy + 36, 56, 12, 0, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.fillStyle = '#c1121f'
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(0,0,0,0.05)'
    for (let i = 0; i < w; i += 12) ctx.fillRect(i, 0, 3, h)
    // Union canton
    const cw = w * 0.5
    const ch = h * 0.5
    ctx.fillStyle = '#0a2a6b'
    ctx.fillRect(0, 0, cw, ch)
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, cw, ch)
    ctx.clip()
    ctx.strokeStyle = '#f4f1e6'
    ctx.lineWidth = 30
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(cw, ch)
    ctx.moveTo(cw, 0)
    ctx.lineTo(0, ch)
    ctx.stroke()
    ctx.strokeStyle = '#c1121f'
    ctx.lineWidth = 10
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(cw, ch)
    ctx.moveTo(cw, 0)
    ctx.lineTo(0, ch)
    ctx.stroke()
    ctx.fillStyle = '#f4f1e6'
    ctx.fillRect(cw / 2 - 26, 0, 52, ch)
    ctx.fillRect(0, ch / 2 - 26, cw, 52)
    ctx.fillStyle = '#c1121f'
    ctx.fillRect(cw / 2 - 15, 0, 30, ch)
    ctx.fillRect(0, ch / 2 - 15, cw, 30)
    ctx.restore()
  }
  // frayed fly edge
  ctx.clearRect(w - 6, 0, 6, h)
  const t = finish(c.c, true)
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  return t
}

/** Rope netting (boarding net / hammock netting): alpha-cut diamond mesh. */
export function nettingTexture(): THREE.Texture | null {
  const s = 128
  const c = canvas(s, s)
  if (!c) return null
  const { ctx } = c
  ctx.clearRect(0, 0, s, s)
  ctx.strokeStyle = '#8a7555'
  ctx.lineWidth = 5
  ctx.beginPath()
  for (const off of [-s, 0, s]) {
    ctx.moveTo(off, 0)
    ctx.lineTo(off + s, s)
    ctx.moveTo(off + s, 0)
    ctx.lineTo(off, s)
  }
  ctx.stroke()
  return finish(c.c, true)
}

/** Scorched deck decal: dark radial burn with soft ragged edge (alpha). */
export function scorchTexture(seed = 11): THREE.Texture | null {
  const s = 256
  const c = canvas(s, s)
  if (!c) return null
  const rnd = seededRandom(seed)
  const { ctx } = c
  ctx.clearRect(0, 0, s, s)
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2
    const d = rnd() * s * 0.22
    const cx = s / 2 + Math.cos(a) * d
    const cy = s / 2 + Math.sin(a) * d
    const r = s * (0.12 + rnd() * 0.22)
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, 'rgba(8,5,3,0.95)')
    g.addColorStop(0.6, 'rgba(20,12,6,0.6)')
    g.addColorStop(1, 'rgba(30,20,10,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)
  }
  const t = finish(c.c, true)
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  return t
}

/** Mullioned stern window: dark glass panes behind a gilt frame. */
export function windowTexture(frame: string): THREE.Texture | null {
  const w = 128
  const h = 128
  const c = canvas(w, h)
  if (!c) return null
  const { ctx } = c
  const g = ctx.createLinearGradient(0, 0, w, h)
  g.addColorStop(0, '#1d3340')
  g.addColorStop(0.5, '#3d6a7a')
  g.addColorStop(1, '#152430')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  ctx.fillRect(10, 8, 30, 40)
  ctx.fillStyle = frame
  ctx.fillRect(0, 0, w, 8)
  ctx.fillRect(0, h - 8, w, 8)
  ctx.fillRect(0, 0, 8, h)
  ctx.fillRect(w - 8, 0, 8, h)
  ctx.fillRect(w / 2 - 3, 0, 6, h)
  ctx.fillRect(0, h / 2 - 3, w, 6)
  const t = finish(c.c, true)
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
  return t
}

/** Brass / iron speckle roughness. */
export function metalTextures(base: string, speck: string, seed = 5): { map: THREE.Texture; roughnessMap: THREE.Texture } | null {
  const s = 128
  const col = canvas(s, s)
  const rgh = canvas(s, s)
  if (!col || !rgh) return null
  const rnd = seededRandom(seed)
  col.ctx.fillStyle = base
  col.ctx.fillRect(0, 0, s, s)
  rgh.ctx.fillStyle = '#909090'
  rgh.ctx.fillRect(0, 0, s, s)
  for (let i = 0; i < 900; i++) {
    const x = rnd() * s
    const y = rnd() * s
    const r = rnd() * 2.2
    col.ctx.fillStyle = speck
    col.ctx.globalAlpha = 0.25 + rnd() * 0.4
    col.ctx.beginPath()
    col.ctx.arc(x, y, r, 0, Math.PI * 2)
    col.ctx.fill()
    rgh.ctx.fillStyle = rnd() < 0.5 ? '#c0c0c0' : '#606060'
    rgh.ctx.beginPath()
    rgh.ctx.arc(x, y, r, 0, Math.PI * 2)
    rgh.ctx.fill()
  }
  return { map: finish(col.c, true, [2, 2]), roughnessMap: finish(rgh.c, false, [2, 2]) }
}
