import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useGameStore } from '../../store/gameStore'
import type { Vec3 } from '../../scene/layout'
import type { Livery, Lod } from '../types'
import { makeClothMaterial, makeClothUniforms } from './cloth'
import { shipMaterials } from './materials'

export interface FlagProps {
  position: Vec3
  livery: Livery
  width?: number
  height?: number
  phase?: number
  /** `ensign` (Jolly Roger / red ensign, default) or a long masthead `pennant`. */
  kind?: 'ensign' | 'pennant'
  lod?: Lod
}

const GEOM = new Map<string, THREE.PlaneGeometry>()
function flagGeometry(w: number, h: number, lod: Lod) {
  const seg = lod === 0 ? 20 : lod === 1 ? 10 : 4
  const key = `${w.toFixed(3)}x${h.toFixed(3)}:${seg}`
  let g = GEOM.get(key)
  if (!g) {
    g = new THREE.PlaneGeometry(w, h, seg, Math.max(2, Math.round((seg * h) / w)))
    GEOM.set(key, g)
  }
  return g
}

/** Ensign or pennant attached at `position` (the hoist) and streaming toward -x (astern) in the vertex shader. */
export function Flag({ position, livery, width = 0.5, height = 0.3, phase = 0, kind = 'ensign', lod = 0 }: FlagProps) {
  const m = shipMaterials(livery)
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const w = kind === 'pennant' ? width * 2.4 : width
  const h = kind === 'pennant' ? height * 0.3 : height
  const geom = flagGeometry(w, h, lod)
  const uniforms = useMemo(() => makeClothUniforms(w, h, 'flag'), [w, h])
  const base = useMemo(() => {
    const b = (m.flag as THREE.MeshStandardMaterial).clone()
    if (kind === 'pennant' && m.maps.pennant) b.map = m.maps.pennant
    return b
  }, [m, kind])
  const mats = useMemo(() => makeClothMaterial(base, uniforms, 'flag'), [base, uniforms])
  useEffect(() => () => {
    mats.material.dispose()
    mats.depth.dispose()
    base.dispose()
  }, [mats, base])
  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.elapsedTime
    uniforms.uPhase.value = phase
    uniforms.uWind.value = reducedMotion ? 0.25 : 1
  })
  return (
    <group position={position} rotation-y={Math.PI}>
      {/* halyard toggle */}
      <mesh material={m.rope} position={[0, 0, 0]}>
        <cylinderGeometry args={[0.006, 0.006, h + 0.04, 4]} />
      </mesh>
      <mesh geometry={geom} material={mats.material} customDepthMaterial={mats.depth} position={[w / 2, 0, 0]} castShadow frustumCulled={false} />
    </group>
  )
}
