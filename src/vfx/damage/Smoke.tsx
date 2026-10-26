import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { smokePuffAt, smokeSeeds, type SmokePlumeOptions } from './smoke'
import { attachParams, disposeParams, makeSpriteMaterial, spriteQuad } from './sprites'
import { useReducedMotion } from './useReducedMotion'
import { scaleCount, useParticlesScale } from '../../perf/store'
import { WIND } from './wind'

export interface SmokeProps {
  position: Vec3
  scale?: number
  seed?: number
  /** 0..1 overall opacity multiplier (fade a plume out as the fire dies). */
  intensity?: number
  color?: string
  /** Puff count override (default 14, 8 with reduced motion). */
  count?: number
  wind?: [number, number]
}

const tmpObj = new THREE.Object3D()

/** Persistent dark smoke column: puffs rise, swell, lean downwind and thin with height. */
export function Smoke({ position, scale = 1, seed = 2, intensity = 1, color = '#2f2b28', count, wind = WIND }: SmokeProps) {
  const reduced = useReducedMotion()
  const particles = useParticlesScale()
  const n = count ?? scaleCount(reduced ? 8 : 14, particles)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const mat = useMemo(() => makeSpriteMaterial('smoke', { color, opacity: 0.75 }), [color])
  useEffect(() => () => void (mat.dispose(), disposeParams(mesh.current)), [mat])
  const opts = useMemo<SmokePlumeOptions>(
    () => ({ count: n, seed, life: reduced ? 3.2 : 4.6, height: 3.4 * scale, wind, radius: [0.16 * scale, 0.75 * scale], wander: 0.14 * scale }),
    [n, seed, scale, wind, reduced],
  )
  const seeds = useMemo(() => smokeSeeds(opts), [opts])

  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return
    const a = attachParams(m, n)
    const t = clock.elapsedTime
    mat.uniforms.uTime.value = t
    for (let i = 0; i < n; i++) {
      const s = smokePuffAt(i, t, seeds, opts)
      tmpObj.position.set(s.x, s.y, s.z)
      tmpObj.rotation.set(0, 0, 0)
      tmpObj.scale.setScalar(Math.max(0.0001, s.radius * 2))
      tmpObj.updateMatrix()
      m.setMatrixAt(i, tmpObj.matrix)
      a.setXYZW(i, s.alpha * intensity, s.spin, seeds[i * 4 + 1] * 0.1, 0)
    }
    m.instanceMatrix.needsUpdate = true
    a.needsUpdate = true
  })

  if (intensity <= 0) return null
  return <instancedMesh ref={mesh} args={[spriteQuad(), mat, n]} position={position} frustumCulled={false} renderOrder={18} />
}
