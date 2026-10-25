import * as THREE from 'three'
import { seededRandom } from '../random'

const cache = new Map<string, THREE.CanvasTexture | null>()

function canvasTexture(key: string, size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture | null {
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  paint(ctx, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  cache.set(key, tex)
  return tex
}

/** Weathered plank grain: long streaks, knots and a few dark checks. Grain runs along x. */
export function woodTexture(seed: number, base: string, dark: string): THREE.CanvasTexture | null {
  return canvasTexture(`wood:${seed}:${base}:${dark}`, 256, (ctx, size) => {
    const rnd = seededRandom(seed)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, size, size)
    ctx.globalAlpha = 0.28
    for (let i = 0; i < 160; i++) {
      const y = rnd() * size
      const w = 0.6 + rnd() * 1.8
      ctx.strokeStyle = rnd() < 0.6 ? dark : '#00000055'
      ctx.lineWidth = w
      ctx.beginPath()
      ctx.moveTo(0, y)
      const wob = (rnd() - 0.5) * 10
      ctx.bezierCurveTo(size * 0.3, y + wob, size * 0.6, y - wob, size, y + (rnd() - 0.5) * 6)
      ctx.stroke()
    }
    ctx.globalAlpha = 0.5
    for (let k = 0; k < 3; k++) {
      const x = rnd() * size
      const y = rnd() * size
      const r = 5 + rnd() * 8
      const g = ctx.createRadialGradient(x, y, 1, x, y, r)
      g.addColorStop(0, dark)
      g.addColorStop(0.6, dark + 'aa')
      g.addColorStop(1, 'transparent')
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    ctx.globalAlpha = 0.35
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = rnd() < 0.5 ? '#ffffff' : '#000000'
      ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 3, 1)
    }
    ctx.globalAlpha = 1
  })
}

/** Grey bump map paired with `woodTexture` (same grain, no colour). */
export function woodBump(seed: number): THREE.CanvasTexture | null {
  const tex = canvasTexture(`woodbump:${seed}`, 256, (ctx, size) => {
    const rnd = seededRandom(seed)
    ctx.fillStyle = '#808080'
    ctx.fillRect(0, 0, size, size)
    ctx.globalAlpha = 0.5
    for (let i = 0; i < 160; i++) {
      const y = rnd() * size
      ctx.strokeStyle = rnd() < 0.6 ? '#404040' : '#b0b0b0'
      ctx.lineWidth = 0.6 + rnd() * 1.8
      ctx.beginPath()
      ctx.moveTo(0, y)
      const wob = (rnd() - 0.5) * 10
      ctx.bezierCurveTo(size * 0.3, y + wob, size * 0.6, y - wob, size, y + (rnd() - 0.5) * 6)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  })
  if (tex) tex.colorSpace = THREE.NoColorSpace
  return tex
}

/** Coarse woven cloth (torn sail scraps). */
export function clothTexture(base: string, thread: string): THREE.CanvasTexture | null {
  return canvasTexture(`cloth:${base}:${thread}`, 128, (ctx, size) => {
    ctx.fillStyle = base
    ctx.fillRect(0, 0, size, size)
    ctx.globalAlpha = 0.22
    ctx.strokeStyle = thread
    ctx.lineWidth = 1
    for (let i = 0; i < size; i += 3) {
      ctx.beginPath()
      ctx.moveTo(i, 0)
      ctx.lineTo(i, size)
      ctx.moveTo(0, i)
      ctx.lineTo(size, i)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  })
}
