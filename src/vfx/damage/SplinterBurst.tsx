import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { BOARD_LAYOUT, type Vec3 } from '../../scene/layout'
import { ParticleBurst } from '../ParticleFx'
import { makeBurst, particleAt, burstDuration } from '../particles'
import { attachParams, makeSpriteMaterial, spriteQuad } from './sprites'
import { makeSplinters, splinterAt, splinterDuration } from './splinters'
import { useReducedMotion } from './useReducedMotion'
import { scaleCount, useParticlesScale } from '../../perf/store'

export interface SplinterBurstProps {
  position: Vec3
  /** Outward normal of the hull face that was hit. */
  normal: Vec3
  seed?: number
  count?: number
  /** World height of the water the shards land on. */
  waterY?: number
  /** Called once the last shard has sunk; unmount the burst then. */
  onDone?: () => void
}

const tmpObj = new THREE.Object3D()
const tmpColor = new THREE.Color()
const WOOD = ['#8a5a2b', '#a06c35', '#6e4520', '#c48a4a', '#5a3a1c'].map((c) => new THREE.Color(c))
const CHAR = new THREE.Color('#1b120b')

/**
 * Cannonball hit on timber: a spray of spinning plank shards and knots that arc out along the hit
 * normal, splash into the water, bob for a moment and sink; plus a dust puff and a few embers.
 */
export function SplinterBurst({ position, normal, seed = 1, count, waterY = BOARD_LAYOUT.surfaceY, onDone }: SplinterBurstProps) {
  const reduced = useReducedMotion()
  const particles = useParticlesScale()
  const n = count ?? scaleCount(reduced ? 18 : 42, particles)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dust = useRef<THREE.InstancedMesh>(null)
  const shards = useMemo(() => makeSplinters({ seed, count: n, normal, size: reduced ? 0.9 : 1 }), [seed, n, normal, reduced])
  const relWater = waterY - position[1]
  const total = useMemo(() => splinterDuration(shards, relWater), [shards, relWater])
  const dustParts = useMemo(
    () => makeBurst({ count: reduced ? 4 : 8, seed: seed + 11, speed: [0.3, 1.1], up: [0.3, 1.0], size: [0.35, 0.7], life: [0.9, 1.6], spread: 0.15, stagger: 0.1 }),
    [seed, reduced],
  )
  const dustTotal = useMemo(() => burstDuration(dustParts), [dustParts])
  const dustMat = useMemo(() => makeSpriteMaterial('smoke', { color: '#8d7a62', opacity: 0.55 }), [])
  useEffect(() => () => dustMat.dispose(), [dustMat])
  const start = useRef<number | null>(null)
  const done = useRef(false)
  const nrm = useMemo(() => new THREE.Vector3(...normal).normalize(), [normal])

  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m || done.current) return
    if (start.current === null) {
      start.current = clock.elapsedTime
      shards.forEach((s, i) => {
        tmpColor.copy(s.tint > 0.8 ? CHAR : WOOD[Math.floor(s.tint * 1.25 * WOOD.length) % WOOD.length])
        m.setColorAt(i, tmpColor)
      })
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    const t = clock.elapsedTime - start.current
    let alive = 0
    for (let i = 0; i < shards.length; i++) {
      const s = splinterAt(shards[i], t, relWater)
      if (!s || s.alpha <= 0) {
        tmpObj.position.set(0, -1000, 0)
        tmpObj.scale.setScalar(0.0001)
      } else {
        alive++
        const sh = shards[i]
        tmpObj.position.set(s.x, s.y, s.z)
        tmpObj.rotation.set(s.rx, s.ry, s.rz)
        tmpObj.scale.set(sh.sx, sh.sy * Math.max(0.2, s.alpha), sh.sz)
      }
      tmpObj.updateMatrix()
      m.setMatrixAt(i, tmpObj.matrix)
    }
    m.instanceMatrix.needsUpdate = true

    const d = dust.current
    if (d) {
      const a = attachParams(d, dustParts.length)
      dustMat.uniforms.uTime.value = clock.elapsedTime
      for (let i = 0; i < dustParts.length; i++) {
        const p = dustParts[i]
        const s = particleAt(p, t, -0.4, 1.5)
        if (!s) {
          tmpObj.position.set(0, -1000, 0)
          tmpObj.scale.setScalar(0.0001)
          a.setXYZW(i, 0, 0, 0, 0)
        } else {
          tmpObj.position.set(s.x + nrm.x * 0.3 * s.age, s.y + 0.1, s.z + nrm.z * 0.3 * s.age)
          tmpObj.scale.setScalar(p.size * (0.5 + s.age * 1.4))
          a.setXYZW(i, Math.max(0, 1 - s.age) * 0.9, i * 1.3 + s.age * 0.5, p.tint, 0)
        }
        tmpObj.rotation.set(0, 0, 0)
        tmpObj.updateMatrix()
        d.setMatrixAt(i, tmpObj.matrix)
      }
      d.instanceMatrix.needsUpdate = true
      a.needsUpdate = true
    }

    if (alive === 0 && t > total && t > dustTotal) {
      done.current = true
      m.visible = false
      if (d) d.visible = false
      onDone?.()
    }
  })

  return (
    <group position={position}>
      <instancedMesh ref={mesh} args={[undefined, undefined, shards.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" roughness={0.85} metalness={0} />
      </instancedMesh>
      <instancedMesh ref={dust} args={[spriteQuad(), dustMat, dustParts.length]} frustumCulled={false} renderOrder={19} />
      <ParticleBurst
        count={reduced ? 4 : 10}
        seed={seed + 5}
        speed={[1, 3]}
        up={[1.5, 4]}
        size={[0.02, 0.045]}
        life={[0.5, 1.1]}
        colors={['#ffb14a', '#ff7a1a', '#ffd27a']}
        gravity={-5}
        drag={0.8}
        emissive
        position={[nrm.x * 0.1, 0.05, nrm.z * 0.1]}
      />
    </group>
  )
}
