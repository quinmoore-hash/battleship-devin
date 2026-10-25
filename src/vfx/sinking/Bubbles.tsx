import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useGameStore } from '../../store/gameStore'
import { bubbleIntensity, bubbleState, type BubbleOptions } from './bubbles'

const tmp = new THREE.Object3D()

export interface BubblesProps {
  progress: number
  length: number
  beam: number
  seed?: number
  count?: number
  timeScale?: number
  /** Live water level; bubbles break through here. */
  waterY?: number
}

/**
 * Air escaping the hull: small spheres rise (hidden by the water until they break the surface),
 * dome up, pop, and leave a short-lived ring. One InstancedMesh for bubbles, one for rings.
 */
export function Bubbles({ progress, length, beam, seed = 1, count = 64, timeScale = 1, waterY = 0 }: BubblesProps) {
  const reduced = useGameStore((s) => s.settings.reducedMotion)
  const bubbles = useRef<THREE.InstancedMesh>(null)
  const rings = useRef<THREE.InstancedMesh>(null)
  const n = reduced ? Math.ceil(count / 2) : count
  const opts = useMemo<BubbleOptions>(() => ({ count: n, seed, length, beam, period: 2.4, depth: 0.7 }), [n, seed, length, beam])
  const t = useRef(0)
  const ringGeom = useMemo(() => new THREE.RingGeometry(0.55, 1, 20), [])

  useFrame((_, delta) => {
    const b = bubbles.current
    const r = rings.current
    if (!b || !r) return
    t.current += Math.min(delta, 0.1) * timeScale
    const alive = Math.floor(n * bubbleIntensity(progress))
    for (let i = 0; i < n; i++) {
      if (i >= alive) {
        tmp.position.set(0, -50, 0)
        tmp.scale.setScalar(0.0001)
        tmp.rotation.set(0, 0, 0)
        tmp.updateMatrix()
        b.setMatrixAt(i, tmp.matrix)
        r.setMatrixAt(i, tmp.matrix)
        continue
      }
      const s = bubbleState(i, t.current, opts)
      tmp.position.set(s.x, waterY + s.y, s.z)
      tmp.rotation.set(0, 0, 0)
      tmp.scale.setScalar(Math.max(0.0001, s.scale * 0.035))
      tmp.updateMatrix()
      b.setMatrixAt(i, tmp.matrix)
      tmp.position.set(s.x, waterY + 0.015, s.z)
      tmp.rotation.set(-Math.PI / 2, 0, 0)
      tmp.scale.setScalar(Math.max(0.0001, s.ring * 0.07 * (0.6 + s.age)))
      tmp.updateMatrix()
      r.setMatrixAt(i, tmp.matrix)
    }
    b.instanceMatrix.needsUpdate = true
    r.instanceMatrix.needsUpdate = true
  })

  return (
    <group>
      <instancedMesh ref={bubbles} args={[undefined, undefined, n]} frustumCulled={false} renderOrder={3}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshPhysicalMaterial color="#dff3ff" roughness={0.08} metalness={0} transmission={0.55} thickness={0.2} transparent opacity={0.85} />
      </instancedMesh>
      <instancedMesh ref={rings} args={[ringGeom, undefined, n]} frustumCulled={false} renderOrder={3}>
        <meshBasicMaterial color="#f4fbff" transparent opacity={0.38} depthWrite={false} side={THREE.DoubleSide} />
      </instancedMesh>
    </group>
  )
}
