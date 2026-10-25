import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { seededRandom } from '../random'
import { normalize } from './ballistics'
import { dragDistance, perpendicularBasis, useReducedMotion } from './motion'
import { SpriteCloud, type SpriteCloudHandle } from './SpriteCloud'
import { glowTexture } from './textures'
import { useEffectTimeline } from './timeline'

export interface MuzzleFlashProps {
  /** World position of the muzzle. */
  position: Vec3
  /** World direction the gun fires (normalised inside). */
  direction: Vec3
  seed?: number
  /** Seconds to wait before firing (broadsides stagger their guns). */
  delay?: number
  scale?: number
  onDone?: () => void
}

const FLASH_DURATION = 0.34
const TONGUES = 5
const tmpQ = new THREE.Quaternion()
const tmpV = new THREE.Vector3()
const Z = new THREE.Vector3(0, 0, 1)

/**
 * Bright, very short additive flash at the muzzle: a white-hot core, a tongue of fire along the barrel axis,
 * a cone of sparks that fall with gravity, and a point-light pulse that lights the ship's side.
 */
export function MuzzleFlash({ position, direction, seed = 1, delay = 0, scale = 1, onDone }: MuzzleFlashProps) {
  const reduced = useReducedMotion()
  const dir = useMemo(() => normalize(direction), [direction])
  const basis = useMemo(() => perpendicularBasis(dir), [dir])
  const sparkCount = reduced ? 10 : 30
  const life = reduced ? 0.2 : FLASH_DURATION
  const sparks = useMemo(() => {
    const rnd = seededRandom(seed * 7 + 13)
    return Array.from({ length: sparkCount }, () => {
      const a = rnd() * Math.PI * 2
      const r = Math.pow(rnd(), 0.7) * 0.45
      return {
        vx: dir[0] + basis.u[0] * Math.cos(a) * r + basis.v[0] * Math.sin(a) * r,
        vy: dir[1] + basis.u[1] * Math.cos(a) * r + basis.v[1] * Math.sin(a) * r,
        vz: dir[2] + basis.u[2] * Math.cos(a) * r + basis.v[2] * Math.sin(a) * r,
        speed: 5 + rnd() * 11,
        life: 0.18 + rnd() * 0.3,
        size: 0.035 + rnd() * 0.06,
        tint: rnd(),
      }
    })
  }, [seed, sparkCount, dir, basis])

  const tl = useEffectTimeline(delay + Math.max(life, 0.5), { onDone })
  const cloud = useRef<SpriteCloudHandle>(null)
  const light = useRef<THREE.PointLight>(null)
  const cone = useRef<THREE.Mesh>(null)
  const quat = useMemo(() => tmpQ.setFromUnitVectors(Z, tmpV.set(dir[0], dir[1], dir[2])).clone(), [dir])

  useFrame(() => {
    const c = cloud.current
    if (!c) return
    const t = tl.t - delay
    const k = Math.min(1, Math.max(0, t / life))
    const visible = t >= 0 && t < life
    // envelope: instant on, fast exponential decay
    const env = visible ? Math.exp(-k * 5.5) * (k < 0.08 ? k / 0.08 : 1) : 0
    const grow = 1 + k * 1.4
    // core + tongues along the barrel axis
    for (let i = 0; i < TONGUES; i++) {
      const d = (i / (TONGUES - 1)) * 1.5 * scale * grow
      const size = (i === 0 ? 0.95 : 0.7 - i * 0.08) * scale * grow
      c.write(i, position[0] + dir[0] * d, position[1] + dir[1] * d, position[2] + dir[2] * d, size, env * (i === 0 ? 1 : 0.8), i * 1.3 + k * 2, Math.min(1, i / 3))
    }
    for (let i = 0; i < sparks.length; i++) {
      const s = sparks[i]
      const age = t
      const j = TONGUES + i
      if (age < 0 || age > s.life) {
        c.hide(j)
        continue
      }
      const d = dragDistance(4, age) * s.speed * scale
      const fall = -4.9 * age * age
      const alpha = (1 - age / s.life) * 0.9
      c.write(j, position[0] + s.vx * d, position[1] + s.vy * d + fall, position[2] + s.vz * d, s.size * scale * (1 + age * 2), alpha, 0, s.tint)
    }
    c.commit()
    if (light.current) light.current.intensity = env * (reduced ? 40 : 90) * scale
    if (cone.current) {
      const m = cone.current.material as THREE.MeshBasicMaterial
      m.opacity = env * 0.55
      cone.current.visible = env > 0.01
      cone.current.scale.set(grow, grow, 0.7 + k * 1.2)
    }
  })

  return (
    <group>
      <SpriteCloud ref={cloud} count={TONGUES + sparks.length} map={glowTexture()} blending="additive" colorA="#fff6d6" colorB="#ff7a1a" renderOrder={20} />
      <pointLight ref={light} position={position} color="#ffb050" intensity={0} distance={11 * scale} decay={2} />
      <group position={position} quaternion={quat}>
        <mesh ref={cone} rotation-x={-Math.PI / 2} position={[0, 0, 0.55 * scale]} visible={false}>
          <coneGeometry args={[0.22 * scale, 1.1 * scale, 14, 1, true]} />
          <meshBasicMaterial color="#ffb347" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}
