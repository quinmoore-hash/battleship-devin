import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useGameStore } from '../../store/gameStore'
import type { Livery, Lod } from '../types'
import { makeClothMaterial, makeClothUniforms } from './cloth'
import { shipMaterials } from './materials'

export interface SailProps {
  width: number
  height: number
  livery: Livery
  /** 0 furled … 1 full. */
  set?: number
  /** 0 pristine … 1 shredded. */
  torn?: number
  phase?: number
  lod?: Lod
  /** Draw the bundled canvas on the yard when the sail is (partly) furled. Default true. */
  furledBundle?: boolean
}

const GEOM = new Map<string, THREE.PlaneGeometry>()
function sailGeometry(w: number, h: number, lod: Lod) {
  const seg = lod === 0 ? 18 : lod === 1 ? 10 : 4
  const key = `${w.toFixed(3)}x${h.toFixed(3)}:${seg}`
  let g = GEOM.get(key)
  if (!g) {
    g = new THREE.PlaneGeometry(w, h, seg, Math.max(3, Math.round((seg * h) / w)))
    GEOM.set(key, g)
  }
  return g
}

const gaskets = (width: number) => {
  const n = Math.max(2, Math.round(width / 0.45))
  return Array.from({ length: n }, (_, i) => -width * 0.45 + (i / (n - 1)) * width * 0.9)
}

/**
 * A square sail hung from a yard at its top edge; the plane is authored in xy and rotated so it faces
 * fore-and-aft and bellies toward +x (the wind is astern). Animated entirely in the vertex shader.
 */
export function Sail({ width, height, livery, set = 1, torn = 0, phase = 0, lod = 0, furledBundle = true }: SailProps) {
  const m = shipMaterials(livery)
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const geom = sailGeometry(width, height, lod)
  const uniforms = useMemo(() => makeClothUniforms(width, height, 'sail'), [width, height])
  const mats = useMemo(() => makeClothMaterial(m.sail as THREE.MeshStandardMaterial, uniforms, 'sail'), [m, uniforms])
  useEffect(() => () => {
    mats.material.dispose()
    mats.depth.dispose()
  }, [mats])
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.elapsedTime
    uniforms.uSet.value = set
    uniforms.uTorn.value = torn
    uniforms.uPhase.value = phase
    uniforms.uWind.value = reducedMotion ? 0.25 : 1
  })
  const bundle = furledBundle && set < 0.92
  const bundleR = 0.012 + (1 - set) * Math.min(0.06, height * 0.07)
  return (
    <group rotation-y={Math.PI / 2}>
      <mesh ref={ref} geometry={geom} material={mats.material} customDepthMaterial={mats.depth} position={[0, -height / 2, 0]} castShadow receiveShadow visible={torn < 1} frustumCulled={false} userData={{ bakeAsIs: true }} />
      {bundle && (
        <group position={[0, -bundleR * 0.6, -0.02]}>
          <mesh material={m.canvasFurled} rotation-z={Math.PI / 2} castShadow>
            <cylinderGeometry args={[bundleR, bundleR, width * 0.96, lod === 0 ? 10 : 6]} />
          </mesh>
          {lod < 2 &&
            gaskets(width).map((x, i) => (
              <mesh key={i} material={m.rope} position={[x, 0, 0]} rotation-y={Math.PI / 2}>
                <torusGeometry args={[bundleR + 0.004, 0.006, 5, 10]} />
              </mesh>
            ))}
        </group>
      )}
    </group>
  )
}
