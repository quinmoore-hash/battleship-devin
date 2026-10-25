import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type { Vec3 } from '../../scene/layout'
import { seededRandom } from '../random'
import { normalize } from './ballistics'
import { DEFAULT_WIND, dragDistance, perpendicularBasis, useReducedMotion } from './motion'
import { SpriteCloud, type SpriteCloudHandle } from './SpriteCloud'
import { smokeTexture } from './textures'
import { useEffectTimeline } from './timeline'

export interface CannonSmokeProps {
  position: Vec3
  direction: Vec3
  seed?: number
  /** Seconds until the last puff has dissipated. Default 3 (reduced motion: 1.8). */
  duration?: number
  delay?: number
  /** World-space drift applied to every puff (units per second). */
  wind?: Vec3
  scale?: number
  onDone?: () => void
}

interface Puff {
  delay: number
  ox: number
  oy: number
  oz: number
  vx: number
  vy: number
  vz: number
  life: number
  size: number
  rot: number
  spin: number
  tint: number
  /** 0 = billowing puff, 1 = smoke-ring segment. */
  ring: number
  /** Angle around the barrel axis for ring segments. */
  angle: number
}

const RING = 12

/**
 * Thick white-grey powder smoke: a fast jet of billowing puffs that slow down, expand and drift
 * downwind, plus a smoke ring that rolls off the muzzle. One instanced draw call, analytic motion
 * (no per-frame allocation, deterministic per seed).
 */
export function CannonSmoke({ position, direction, seed = 1, duration, delay = 0, wind = DEFAULT_WIND, scale = 1, onDone }: CannonSmokeProps) {
  const reduced = useReducedMotion()
  const total = duration ?? (reduced ? 1.8 : 3)
  const dir = useMemo(() => normalize(direction), [direction])
  const basis = useMemo(() => perpendicularBasis(dir), [dir])
  const puffCount = reduced ? 12 : 26
  const puffs = useMemo<Puff[]>(() => {
    const rnd = seededRandom(seed * 31 + 7)
    const list: Puff[] = []
    for (let i = 0; i < puffCount; i++) {
      const a = rnd() * Math.PI * 2
      const spread = Math.pow(rnd(), 1.5) * 0.9
      const along = 0.05 + rnd() * 0.35
      const speed = 2.5 + rnd() * 5
      list.push({
        delay: rnd() * 0.16,
        ox: dir[0] * along + (rnd() - 0.5) * 0.08,
        oy: dir[1] * along + (rnd() - 0.5) * 0.08,
        oz: dir[2] * along + (rnd() - 0.5) * 0.08,
        vx: (dir[0] + basis.u[0] * Math.cos(a) * spread + basis.v[0] * Math.sin(a) * spread) * speed,
        vy: (dir[1] + basis.u[1] * Math.cos(a) * spread + basis.v[1] * Math.sin(a) * spread) * speed + 0.3 + rnd() * 0.5,
        vz: (dir[2] + basis.u[2] * Math.cos(a) * spread + basis.v[2] * Math.sin(a) * spread) * speed,
        life: total * (0.55 + rnd() * 0.45),
        size: 0.55 + rnd() * 0.6,
        rot: rnd() * Math.PI * 2,
        spin: (rnd() - 0.5) * 1.2,
        tint: rnd(),
        ring: 0,
        angle: 0,
      })
    }
    for (let i = 0; i < RING; i++) {
      const angle = (i / RING) * Math.PI * 2 + rnd() * 0.2
      list.push({
        delay: 0.02,
        ox: dir[0] * 0.3,
        oy: dir[1] * 0.3,
        oz: dir[2] * 0.3,
        vx: dir[0] * 1.6,
        vy: dir[1] * 1.6 + 0.15,
        vz: dir[2] * 1.6,
        life: total * 0.6,
        size: 0.4 + rnd() * 0.15,
        rot: rnd() * Math.PI * 2,
        spin: (rnd() - 0.5) * 0.8,
        tint: 0.6 + rnd() * 0.4,
        ring: 1,
        angle,
      })
    }
    return list
  }, [seed, puffCount, dir, basis, total])

  const tl = useEffectTimeline(delay + total, { onDone })
  const cloud = useRef<SpriteCloudHandle>(null)

  useFrame(() => {
    const c = cloud.current
    if (!c) return
    const t = tl.t - delay
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i]
      const age = t - p.delay
      if (age < 0 || age > p.life) {
        c.hide(i)
        continue
      }
      const k = age / p.life
      const d = dragDistance(2.4, age)
      let x = position[0] + p.ox * scale + p.vx * d * scale + wind[0] * age
      let y = position[1] + p.oy * scale + p.vy * d * scale + wind[1] * age + 0.12 * age * age
      let z = position[2] + p.oz * scale + p.vz * d * scale + wind[2] * age
      let size: number
      let alpha: number
      if (p.ring) {
        const r = (0.12 + 0.9 * (1 - Math.exp(-age * 2.2))) * scale
        x += (basis.u[0] * Math.cos(p.angle) + basis.v[0] * Math.sin(p.angle)) * r
        y += (basis.u[1] * Math.cos(p.angle) + basis.v[1] * Math.sin(p.angle)) * r
        z += (basis.u[2] * Math.cos(p.angle) + basis.v[2] * Math.sin(p.angle)) * r
        size = p.size * scale * (0.6 + 1.6 * k)
        alpha = Math.min(1, age / 0.06) * Math.pow(1 - k, 1.4) * 0.75
      } else {
        size = p.size * scale * (0.3 + 1.9 * (1 - Math.exp(-age * 1.4)) + 0.18 * age)
        alpha = Math.min(1, age / 0.1) * Math.pow(1 - k, 1.3) * 0.95
      }
      c.write(i, x, y, z, size, alpha, p.rot + p.spin * age, p.tint)
    }
    c.commit()
  })

  return <SpriteCloud ref={cloud} count={puffs.length} map={smokeTexture()} colorA="#7d7a74" colorB="#f1eee6" shading={0.6} renderOrder={12} />
}
