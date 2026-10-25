/**
 * Procedural canvas textures and the Man-o’-War livery materials. Everything is generated once per livery
 * and cached; nothing here runs at import time, so the module is safe under Vitest/SSR.
 */
import * as THREE from 'three'
import { seededRandom } from '../../vfx/random'
import type { Livery } from '../types'

type RGB = [number, number, number]

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const css = ([r, g, b]: RGB, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = c.height = size
  return [c, c.getContext('2d')!]
}

function finish(c: HTMLCanvasElement, srgb = true, anisotropy = 4): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.anisotropy = anisotropy
  return t
}

/** Tangent-space normal map from a height field (OpenGL convention, +y up). */
function normalFromHeight(height: Float32Array, size: number, strength: number): THREE.CanvasTexture {
  const [c, ctx] = canvas(size)
  const img = ctx.createImageData(size, size)
  const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength
      const len = Math.hypot(dx, dy, 1)
      const o = (y * size + x) * 4
      img.data[o] = ((-dx / len) * 0.5 + 0.5) * 255
      img.data[o + 1] = ((dy / len) * 0.5 + 0.5) * 255
      img.data[o + 2] = (1 / len) * 0.5 * 255 + 127
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return finish(c, false)
}

export interface PlankOptions {
  size?: number
  rows: number
  /** Joints per texture width. */
  joints: number
  base: string
  dark: string
  light: string
  seam?: string
  nails?: boolean
  seed: number
  grain?: number
  normalStrength?: number
}

export interface TextureSet {
  map: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
}

/** Planking: staggered boards with per-board tint, wavy grain, seams and nail heads; normal map from the same height field. */
export function plankTextures({ size = 512, rows, joints, base, dark, light, seam = '#0b0806', nails = true, seed, grain = 0.5, normalStrength = 2.2 }: PlankOptions): TextureSet {
  const [c, ctx] = canvas(size)
  const rand = seededRandom(seed)
  const height = new Float32Array(size * size)
  const rowH = size / rows
  const jointW = size / joints
  const B = hex(base)
  const D = hex(dark)
  const L = hex(light)
  for (let r = 0; r < rows; r++) {
    const offset = ((r * 0.37 + rand() * 0.3) % 1) * jointW
    const y0 = r * rowH
    for (let j = -1; j <= joints; j++) {
      const x0 = j * jointW + offset
      const tint = rand()
      const col = tint < 0.5 ? mix(B, D, (0.5 - tint) * 0.9) : mix(B, L, (tint - 0.5) * 0.9)
      ctx.fillStyle = css(col)
      ctx.fillRect(x0, y0, jointW + 1, rowH + 1)
      // grain streaks
      const streaks = 10 + Math.floor(rand() * 10)
      for (let s = 0; s < streaks; s++) {
        const gy = y0 + rand() * rowH
        const amp = rand() * 1.5
        const ph = rand() * 6
        const darkStreak = rand() < 0.6
        ctx.strokeStyle = css(darkStreak ? D : L, (0.08 + rand() * 0.16) * grain)
        ctx.lineWidth = 0.6 + rand() * 1.2
        ctx.beginPath()
        for (let x = x0; x <= x0 + jointW; x += 4) {
          const yy = gy + Math.sin(x * 0.05 + ph) * amp
          if (x === x0) ctx.moveTo(x, yy)
          else ctx.lineTo(x, yy)
        }
        ctx.stroke()
      }
      // knot now and then
      if (rand() < 0.12) {
        const kx = x0 + jointW * (0.2 + rand() * 0.6)
        const ky = y0 + rowH * (0.3 + rand() * 0.4)
        const kr = 1.5 + rand() * 2.5
        const grd = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr * 2)
        grd.addColorStop(0, css(D, 0.9))
        grd.addColorStop(1, css(D, 0))
        ctx.fillStyle = grd
        ctx.fillRect(kx - kr * 2, ky - kr * 2, kr * 4, kr * 4)
      }
      // seams
      ctx.fillStyle = seam
      ctx.fillRect(x0 - 0.5, y0, 1.6, rowH)
      for (let yy = Math.max(0, y0 | 0); yy < Math.min(size, (y0 + rowH) | 0); yy++) {
        for (let xx = Math.max(0, (x0 - 1) | 0); xx <= Math.min(size - 1, (x0 + 1) | 0); xx++) height[yy * size + xx] = -1
      }
      if (nails) {
        for (const nx of [x0 + 4, x0 + jointW - 4]) {
          for (const ny of [y0 + rowH * 0.3, y0 + rowH * 0.7]) {
            ctx.fillStyle = 'rgba(20,16,12,0.9)'
            ctx.beginPath()
            ctx.arc(nx, ny, 1.4, 0, Math.PI * 2)
            ctx.fill()
            ctx.fillStyle = 'rgba(200,190,170,0.5)'
            ctx.beginPath()
            ctx.arc(nx - 0.4, ny - 0.4, 0.5, 0, Math.PI * 2)
            ctx.fill()
            const ix = nx | 0
            const iy = ny | 0
            if (ix > 0 && iy > 0 && ix < size - 1 && iy < size - 1) {
              height[iy * size + ix] = 1
              height[iy * size + ix + 1] = 0.5
              height[iy * size + ix - 1] = 0.5
              height[(iy + 1) * size + ix] = 0.5
              height[(iy - 1) * size + ix] = 0.5
            }
          }
        }
      }
    }
    // row seam
    ctx.fillStyle = seam
    ctx.fillRect(0, y0 - 0.5, size, 1.8)
    const sy = y0 | 0
    for (let xx = 0; xx < size; xx++) {
      height[((sy + size) % size) * size + xx] = -1
      height[((sy + 1) % size) * size + xx] = -0.6
    }
  }
  // fine grain bumps in the height field
  for (let i = 0; i < size * size; i += 7) height[i] += (rand() - 0.5) * 0.08
  return { map: finish(c), normalMap: normalFromHeight(height, size, normalStrength) }
}

/** Woven canvas with panel seams and a few stains. */
export function canvasTexture(base: string, seam: string, seed: number, size = 256): THREE.CanvasTexture {
  const [c, ctx] = canvas(size)
  const rand = seededRandom(seed)
  const B = hex(base)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  const img = ctx.getImageData(0, 0, size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const px = (i / 4) % size
    const py = Math.floor(i / 4 / size)
    const weave = ((px % 2) + (py % 2)) % 2 === 0 ? 1 : -1
    const n = (rand() - 0.5) * 18 + weave * 5
    img.data[i] = Math.max(0, Math.min(255, B[0] + n))
    img.data[i + 1] = Math.max(0, Math.min(255, B[1] + n))
    img.data[i + 2] = Math.max(0, Math.min(255, B[2] + n))
  }
  ctx.putImageData(img, 0, 0)
  const panels = 6
  ctx.strokeStyle = seam
  ctx.lineWidth = 1.2
  for (let p = 1; p < panels; p++) {
    const x = (p * size) / panels
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, size)
    ctx.stroke()
    ctx.beginPath()
    ctx.setLineDash([3, 3])
    ctx.moveTo(x + 3, 0)
    ctx.lineTo(x + 3, size)
    ctx.stroke()
    ctx.setLineDash([])
  }
  for (let s = 0; s < 6; s++) {
    const sx = rand() * size
    const sy = rand() * size
    const r = 10 + rand() * 30
    const grd = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
    grd.addColorStop(0, 'rgba(60,40,20,0.12)')
    grd.addColorStop(1, 'rgba(60,40,20,0)')
    ctx.fillStyle = grd
    ctx.fillRect(sx - r, sy - r, r * 2, r * 2)
  }
  return finish(c)
}

/** Laid rope: diagonal strands. Tiles along v. */
export function ropeTexture(base: string, dark: string, size = 64): THREE.CanvasTexture {
  const [c, ctx] = canvas(size)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  ctx.strokeStyle = dark
  ctx.lineWidth = size / 6
  for (let i = -2; i < 4; i++) {
    ctx.beginPath()
    ctx.moveTo(-size, i * (size / 2) + size)
    ctx.lineTo(size * 2, i * (size / 2) - size)
    ctx.stroke()
  }
  return finish(c)
}

/** Speckled metal (iron / brass): fine noise and a few scratches. */
export function metalTexture(base: string, speck: string, seed: number, scratches = 12, size = 128): THREE.CanvasTexture {
  const [c, ctx] = canvas(size)
  const rand = seededRandom(seed)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = speck
  for (let i = 0; i < size * 12; i++) {
    ctx.globalAlpha = rand() * 0.35
    ctx.fillRect(rand() * size, rand() * size, 1, 1)
  }
  ctx.globalAlpha = 0.25
  ctx.strokeStyle = speck
  for (let i = 0; i < scratches; i++) {
    ctx.beginPath()
    const x = rand() * size
    const y = rand() * size
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rand() - 0.5) * 40, y + (rand() - 0.5) * 10)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  return finish(c)
}

/** Below-waterline skin: copper plates (navy) or tarred planks with a barnacle/weed fringe (pirate). */
export function bottomTextures(livery: Livery, seed: number): TextureSet {
  if (livery === 'navy') {
    return plankTextures({ rows: 10, joints: 6, base: '#9c6a48', dark: '#5f8a6a', light: '#c98c62', seam: '#3f2a1c', seed, grain: 0.25, nails: true, normalStrength: 1.6 })
  }
  return plankTextures({ rows: 8, joints: 4, base: '#241d18', dark: '#2f4a3a', light: '#3a2f27', seam: '#090706', seed, grain: 0.35, nails: false })
}

export interface ManOWarMaterials {
  hull: THREE.MeshStandardMaterial
  hullBelow: THREE.MeshStandardMaterial
  wale: THREE.MeshStandardMaterial
  stripe: THREE.MeshStandardMaterial
  deck: THREE.MeshStandardMaterial
  deckDark: THREE.MeshStandardMaterial
  spar: THREE.MeshStandardMaterial
  trim: THREE.MeshStandardMaterial
  gold: THREE.MeshStandardMaterial
  iron: THREE.MeshStandardMaterial
  rope: THREE.MeshStandardMaterial
  sail: THREE.MeshStandardMaterial
  sailScorched: THREE.MeshStandardMaterial
  glass: THREE.MeshPhysicalMaterial
  lanternGlass: THREE.MeshStandardMaterial
  flame: THREE.MeshBasicMaterial
  char: THREE.MeshStandardMaterial
  splinter: THREE.MeshStandardMaterial
  lidInner: THREE.MeshStandardMaterial
  portDark: THREE.MeshBasicMaterial
  figure: THREE.MeshStandardMaterial
  waterline: THREE.MeshStandardMaterial
  /** Shared uniform the model bumps every frame to flutter the sails. */
  time: { value: number }
}

const CACHE = new Map<Livery, ManOWarMaterials>()

const PALETTE: Record<Livery, { hull: [string, string, string]; wale: string; stripe: string; deck: [string, string, string]; trim: string; sail: string; sailSeam: string; rope: [string, string]; figure: string; glassEmissive: string }> = {
  pirate: {
    hull: ['#4d3625', '#2c1d13', '#64492f'],
    wale: '#120c08',
    stripe: '#6e1414',
    deck: ['#8f7250', '#6a5238', '#ad8f66'],
    trim: '#8c1d1d',
    sail: '#1e1b19',
    sailSeam: '#0c0a09',
    rope: ['#5e4d35', '#3c3022'],
    figure: '#6e5a38',
    glassEmissive: '#ff9a3c',
  },
  navy: {
    hull: ['#b98a56', '#8c6338', '#d4a86f'],
    wale: '#14100d',
    stripe: '#d9b24c',
    deck: ['#c2a67c', '#9c8260', '#dcc39a'],
    trim: '#1f3f7a',
    sail: '#e9dcc0',
    sailSeam: '#c7b89a',
    rope: ['#8a7355', '#5f4d36'],
    figure: '#e2b64a',
    glassEmissive: '#ffb860',
  },
}

const SAIL_VERTEX_FLUTTER = /* glsl */ `
  #include <begin_vertex>
  transformed += normal * sin(uTime * 2.6 + position.y * 5.0 + position.x * 3.0 + position.z * 2.0) * aFlutter * 0.03;
`

function sailMaterial(map: THREE.Texture, color: string, time: { value: number }, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) {
  const m = new THREE.MeshStandardMaterial({ map, color, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, ...extra })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aFlutter;')
      .replace('#include <begin_vertex>', SAIL_VERTEX_FLUTTER)
  }
  m.customProgramCacheKey = () => 'mow-sail'
  return m
}

/** Materials for one livery (cached). Must be called from render/effects, never at import time. */
export function manOWarMaterials(livery: Livery): ManOWarMaterials {
  const cached = CACHE.get(livery)
  if (cached) return cached
  const p = PALETTE[livery]
  const seed = livery === 'pirate' ? 11 : 23
  const time = { value: 0 }

  const hullTex = plankTextures({ rows: 9, joints: 4, base: p.hull[0], dark: p.hull[1], light: p.hull[2], seed, grain: 0.6 })
  hullTex.map.repeat.set(2.4, 3)
  hullTex.normalMap.repeat.set(2.4, 3)
  const bottomTex = bottomTextures(livery, seed + 1)
  bottomTex.map.repeat.set(2.4, 1.2)
  bottomTex.normalMap.repeat.set(2.4, 1.2)
  const deckTex = plankTextures({ rows: 14, joints: 2, base: p.deck[0], dark: p.deck[1], light: p.deck[2], seam: '#2a211a', seed: seed + 2, grain: 0.45, normalStrength: 1.8 })
  const sparTex = plankTextures({ rows: 1, joints: 1, base: p.deck[0], dark: p.deck[1], light: p.deck[2], seam: p.deck[1], nails: false, seed: seed + 3, grain: 0.8, size: 128, normalStrength: 0.8 })
  const stripeNormal = hullTex.normalMap.clone()
  stripeNormal.repeat.set(4, 0.6)
  const sailTex = canvasTexture(p.sail, p.sailSeam, seed + 5)
  const ropeTex = ropeTexture(p.rope[0], p.rope[1])
  const ironTex = metalTexture('#2b2a2c', '#6a6468', seed + 6)
  const brassTex = metalTexture(livery === 'pirate' ? '#9c7a3a' : '#d2a94e', '#fff2c0', seed + 7, 20)

  const std = (params: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...params })

  const m: ManOWarMaterials = {
    hull: std({ map: hullTex.map, normalMap: hullTex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughness: livery === 'pirate' ? 0.72 : 0.62 }),
    hullBelow: std({ map: bottomTex.map, normalMap: bottomTex.normalMap, roughness: livery === 'pirate' ? 0.95 : 0.55, metalness: livery === 'pirate' ? 0 : 0.35 }),
    wale: std({ color: p.wale, roughness: 0.55, map: sparTex.map, normalMap: sparTex.normalMap }),
    stripe: std({ color: p.stripe, normalMap: stripeNormal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.6 }),
    deck: std({ map: deckTex.map, normalMap: deckTex.normalMap, roughness: 0.85 }),
    deckDark: std({ map: deckTex.map, normalMap: deckTex.normalMap, color: '#8a7a68', roughness: 0.85 }),
    spar: std({ map: sparTex.map, normalMap: sparTex.normalMap, color: livery === 'pirate' ? '#8d7556' : '#c3a67d', roughness: 0.7 }),
    trim: std({ color: p.trim, roughness: 0.5 }),
    gold: std({ map: brassTex, roughness: 0.32, metalness: 0.85 }),
    iron: std({ map: ironTex, roughness: 0.48, metalness: 0.75 }),
    rope: std({ map: ropeTex, roughness: 1 }),
    sail: sailMaterial(sailTex, '#ffffff', time),
    sailScorched: sailMaterial(sailTex, '#4a3a2c', time, { roughness: 1 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: '#9fcfe2',
      roughness: 0.12,
      metalness: 0.1,
      transparent: true,
      opacity: 0.55,
      emissive: p.glassEmissive,
      emissiveIntensity: 0.35,
      depthWrite: false,
    }),
    lanternGlass: std({ color: '#ffd9a0', transparent: true, opacity: 0.6, emissive: '#ff9a2c', emissiveIntensity: 1.6, roughness: 0.2, depthWrite: false }),
    flame: new THREE.MeshBasicMaterial({ color: '#ffd27a', toneMapped: false }),
    char: std({ color: '#0d0907', roughness: 1, emissive: '#ff3800', emissiveIntensity: 0.25 }),
    splinter: std({ color: '#2b1a0e', roughness: 0.95 }),
    lidInner: std({ color: livery === 'pirate' ? '#7a1515' : '#9c1b1b', roughness: 0.6 }),
    portDark: new THREE.MeshBasicMaterial({ color: '#07050a', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    figure: std({ color: p.figure, roughness: livery === 'pirate' ? 0.5 : 0.3, metalness: livery === 'pirate' ? 0.6 : 0.8 }),
    waterline: std({ color: livery === 'pirate' ? '#4b5a44' : '#c8c4b0', roughness: 1 }),
    time,
  }
  CACHE.set(livery, m)
  return m
}
