import * as THREE from 'three'
import { seededRandom } from '../vfx/random'

/**
 * Procedural canvas textures for the cove dressing (sand/grass grain, fort stone, dock planks,
 * palm fronds, flags, signs). Each is generated once per page and shared.
 */
const cache = new Map<string, THREE.CanvasTexture>()

function canvasTexture(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, rnd: () => number) => void, repeat = true): THREE.CanvasTexture {
  const hit = cache.get(key)
  if (hit) return hit
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  draw(ctx, seededRandom(key.length * 977 + size))
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  cache.set(key, tex)
  return tex
}

/** Grey grain that multiplies the terrain vertex colours. */
export const groundTexture = () =>
  canvasTexture('ground', 256, (ctx, rnd) => {
    ctx.fillStyle = '#9a9a9a'
    ctx.fillRect(0, 0, 256, 256)
    for (let i = 0; i < 9000; i++) {
      const v = 120 + Math.floor(rnd() * 90)
      ctx.fillStyle = `rgb(${v},${v},${v})`
      ctx.fillRect(rnd() * 256, rnd() * 256, 1 + rnd() * 2, 1 + rnd() * 2)
    }
  })

/** Coursed stone blocks with dark mortar. */
export const stoneTexture = () =>
  canvasTexture('stone', 256, (ctx, rnd) => {
    ctx.fillStyle = '#5a5651'
    ctx.fillRect(0, 0, 256, 256)
    const rows = 8
    const h = 256 / rows
    for (let r = 0; r < rows; r++) {
      let x = (r % 2) * 20 - 20
      while (x < 256) {
        const w = 28 + rnd() * 30
        const g = 128 + rnd() * 50
        ctx.fillStyle = `rgb(${g + 8},${g},${g - 10})`
        ctx.fillRect(x + 2, r * h + 2, w - 4, h - 4)
        ctx.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.12})`
        ctx.fillRect(x + 4 + rnd() * (w - 10), r * h + 4, 6, h - 8)
        x += w
      }
    }
  })

/** Weathered deck planks running along +y of the texture. */
export const plankTexture = (key = 'plank', base: [number, number, number] = [120, 88, 55]) =>
  canvasTexture(key, 256, (ctx, rnd) => {
    ctx.fillStyle = `rgb(${base[0] - 30},${base[1] - 25},${base[2] - 18})`
    ctx.fillRect(0, 0, 256, 256)
    const planks = 6
    const w = 256 / planks
    for (let p = 0; p < planks; p++) {
      const t = rnd() * 0.3 - 0.15
      ctx.fillStyle = `rgb(${base[0] * (1 + t)},${base[1] * (1 + t)},${base[2] * (1 + t)})`
      ctx.fillRect(p * w + 1, 0, w - 2, 256)
      for (let g = 0; g < 14; g++) {
        ctx.strokeStyle = `rgba(40,25,10,${0.15 + rnd() * 0.25})`
        ctx.lineWidth = 1
        ctx.beginPath()
        const x = p * w + 3 + rnd() * (w - 6)
        ctx.moveTo(x, 0)
        ctx.bezierCurveTo(x + rnd() * 6 - 3, 90, x + rnd() * 6 - 3, 170, x + rnd() * 4 - 2, 256)
        ctx.stroke()
      }
      // nail heads at the plank ends
      ctx.fillStyle = '#2a2420'
      for (const y of [8, 248]) {
        ctx.beginPath()
        ctx.arc(p * w + w * 0.3, y, 2, 0, Math.PI * 2)
        ctx.arc(p * w + w * 0.7, y, 2, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  })

/** Pinnate palm frond: central rib with leaflets, alpha outside the leaf. */
export const frondTexture = () =>
  canvasTexture(
    'frond',
    256,
    (ctx, rnd) => {
      ctx.clearRect(0, 0, 256, 256)
      const cx = 128
      ctx.strokeStyle = '#4d6b22'
      ctx.lineWidth = 7
      ctx.beginPath()
      ctx.moveTo(cx, 0)
      ctx.lineTo(cx, 256)
      ctx.stroke()
      for (let i = 0; i < 46; i++) {
        const y = 10 + i * 5.3
        const len = 95 * Math.sin(Math.min(1, y / 256) * Math.PI * 0.92) + 8
        const g = 110 + rnd() * 60
        ctx.strokeStyle = `rgb(${50 + rnd() * 30},${g},${35 + rnd() * 25})`
        ctx.lineWidth = 4
        for (const s of [-1, 1]) {
          ctx.beginPath()
          ctx.moveTo(cx, y)
          ctx.quadraticCurveTo(cx + s * len * 0.5, y + 14, cx + s * len, y + 26 + rnd() * 6)
          ctx.stroke()
        }
      }
    },
    false,
  )

/** Jolly Roger: skull and crossed bones on black. */
export const jollyRogerTexture = () =>
  canvasTexture(
    'jolly-roger',
    256,
    (ctx) => {
      ctx.fillStyle = '#111111'
      ctx.fillRect(0, 0, 256, 256)
      ctx.fillStyle = '#f2efe6'
      ctx.beginPath()
      ctx.ellipse(128, 100, 44, 48, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillRect(104, 130, 48, 22)
      ctx.fillStyle = '#111111'
      ctx.beginPath()
      ctx.ellipse(110, 98, 11, 14, 0, 0, Math.PI * 2)
      ctx.ellipse(146, 98, 11, 14, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(128, 112)
      ctx.lineTo(120, 128)
      ctx.lineTo(136, 128)
      ctx.fill()
      for (const x of [112, 124, 136, 148]) ctx.fillRect(x, 140, 3, 10)
      ctx.strokeStyle = '#f2efe6'
      ctx.lineWidth = 12
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(60, 150)
      ctx.lineTo(196, 230)
      ctx.moveTo(196, 150)
      ctx.lineTo(60, 230)
      ctx.stroke()
    },
    false,
  )

/** Hanging tavern sign. */
export const signTexture = (text: string) =>
  canvasTexture(
    `sign:${text}`,
    256,
    (ctx) => {
      ctx.fillStyle = '#4a3320'
      ctx.fillRect(0, 0, 256, 256)
      ctx.fillStyle = '#e8d9b5'
      ctx.fillRect(14, 14, 228, 228)
      ctx.fillStyle = '#3a2a18'
      ctx.font = '700 44px Georgia, serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const lines = text.split('\n')
      lines.forEach((l, i) => ctx.fillText(l, 128, 128 + (i - (lines.length - 1) / 2) * 52))
    },
    false,
  )

/** Torn sailcloth: canvas weave with ragged alpha holes. */
export const tornSailTexture = () =>
  canvasTexture(
    'torn-sail',
    256,
    (ctx, rnd) => {
      ctx.fillStyle = '#a89c84'
      ctx.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 2600; i++) {
        const v = 140 + rnd() * 60
        ctx.fillStyle = `rgba(${v},${v - 10},${v - 30},0.5)`
        ctx.fillRect(rnd() * 256, rnd() * 256, 3, 1)
      }
      ctx.globalCompositeOperation = 'destination-out'
      for (let i = 0; i < 9; i++) {
        ctx.beginPath()
        ctx.ellipse(40 + rnd() * 180, 120 + rnd() * 136, 8 + rnd() * 26, 5 + rnd() * 16, rnd() * 3, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.fillRect(0, 232 - 20 * 0, 256, 24)
    },
    false,
  )
