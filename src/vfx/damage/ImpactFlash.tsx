import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { easeOutCubic } from '../math'
import { attachParams, makeSpriteMaterial, spriteQuad } from './sprites'
import { useReducedMotion } from './useReducedMotion'

export interface ImpactFlashProps {
  position: Vec3
  /** Orientation of the shockwave ring (defaults to the hit normal `[0, 0, 1]`). */
  normal?: Vec3
  scale?: number
  onDone?: () => void
}

const tmpObj = new THREE.Object3D()
const FLASH_T = 0.32
const RING_T = 0.55

/** The hit moment: a hot orange flash, an expanding shockwave ring and a short burst of light. */
export function ImpactFlash({ position, normal = [0, 0, 1], scale = 1, onDone }: ImpactFlashProps) {
  const reduced = useReducedMotion()
  const flash = useRef<THREE.InstancedMesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  const light = useRef<THREE.PointLight>(null)
  const attr = useRef<THREE.InstancedBufferAttribute | null>(null)
  const start = useRef<number | null>(null)
  const done = useRef(false)
  const mat = useMemo(() => makeSpriteMaterial('glow', { color: '#ff8a2a', upright: 0, intensity: 2.5 }), [])
  const ringMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ffc27a', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    [],
  )
  useEffect(() => () => void (mat.dispose(), ringMat.dispose()), [mat, ringMat])
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...normal).normalize()), [normal])
  const dur = reduced ? 0.25 : RING_T

  useFrame(({ clock }) => {
    if (done.current) return
    if (start.current === null) start.current = clock.elapsedTime
    const t = clock.elapsedTime - start.current
    const f = flash.current
    if (f) {
      if (!attr.current) attr.current = attachParams(f, 2)
      const a = attr.current
      const k = Math.min(1, t / FLASH_T)
      const s = scale * (0.6 + easeOutCubic(k) * 1.6)
      tmpObj.position.set(0, 0, 0)
      tmpObj.scale.setScalar(s)
      tmpObj.rotation.set(0, 0, 0)
      tmpObj.updateMatrix()
      f.setMatrixAt(0, tmpObj.matrix)
      tmpObj.scale.setScalar(s * 0.45)
      tmpObj.updateMatrix()
      f.setMatrixAt(1, tmpObj.matrix)
      a.setXYZW(0, (1 - k) * (1 - k), t * 3, 0, 0)
      a.setXYZW(1, 1 - k, -t * 5, 0, 0)
      f.instanceMatrix.needsUpdate = true
      a.needsUpdate = true
      f.visible = k < 1
    }
    const r = ring.current
    if (r) {
      const k = Math.min(1, t / dur)
      const e = easeOutCubic(k)
      r.scale.setScalar(scale * (0.15 + e * 1.6))
      ringMat.opacity = (1 - k) * 0.85
      r.visible = k < 1
    }
    const l = light.current
    if (l) l.intensity = reduced ? 0 : Math.max(0, 1 - t / 0.28) * 40 * scale
    if (t > Math.max(FLASH_T, dur)) {
      done.current = true
      onDone?.()
    }
  })

  return (
    <group position={position}>
      <instancedMesh ref={flash} args={[spriteQuad(), mat, 2]} frustumCulled={false} renderOrder={30} />
      <mesh ref={ring} quaternion={quat} material={ringMat} renderOrder={29}>
        <ringGeometry args={[0.78, 1, 40]} />
      </mesh>
      {!reduced && <pointLight ref={light} color="#ffa040" intensity={0} distance={7} decay={2} />}
    </group>
  )
}
