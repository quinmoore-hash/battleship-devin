/**
 * Frigate rig: instanced rope bundles, shader cloth (sails / flags), the three masts with yards, tops and
 * standing rigging, the bowsprit with jibs, and the mizzen spanker. Masts snap at a break point and the
 * top hamper falls over the side as `snapped` → 1.
 */
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import type { Livery, Lod } from '../types'
import { ClothTime } from './clothTime'
import { ropeRadiusAtLod } from '../kit/Rope'
import { MASTS, deckY } from './form'
import { sailGeometry } from './geometry'
import { applyClothUniforms, clothTextures, makeClothDepthMaterial, makeClothMaterial, makeClothUniforms, type FrigateMaterials } from './materials'
import { BREAK_FRAC, buildBowsprit, buildMastGeoms, mastRigging, sailSet, type Segment } from './rigging'

const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true)
const UP = new THREE.Vector3(0, 1, 0)

/** Every rope of a rig in one draw call: an InstancedMesh of unit cylinders. */
export function RopeBundle({ segments, material, visible = true, lod = 0 }: { segments: Segment[]; material: THREE.Material; visible?: boolean; lod?: Lod }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const o = new THREE.Object3D()
    const a = new THREE.Vector3()
    const b = new THREE.Vector3()
    segments.forEach((s, i) => {
      a.set(...s.a)
      b.set(...s.b)
      const dir = b.clone().sub(a)
      const len = dir.length()
      o.position.copy(a).add(b).multiplyScalar(0.5)
      o.quaternion.setFromUnitVectors(UP, dir.normalize())
      const r = ropeRadiusAtLod(s.r ?? 0.008, lod)
      o.scale.set(r, len, r)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
    })
    mesh.count = segments.length
    mesh.instanceMatrix.needsUpdate = true
  }, [segments])
  if (segments.length === 0) return null
  return <instancedMesh ref={ref} args={[UNIT_CYL, material, segments.length]} visible={visible} frustumCulled={false} />
}

export interface ClothProps {
  geometry: THREE.BufferGeometry
  map: THREE.Texture
  shape: 0 | 1 | 2
  set: number
  torn: number
  phase: number
  belly: number
  flutter?: number
  seed?: number
  castShadow?: boolean
}

/** One piece of cloth driven by the shader in `materials.ts`. */
export function ClothMesh({ geometry, map, shape, set, torn, phase, belly, flutter = 0.015, seed = 0, castShadow = true }: ClothProps) {
  const time = useContext(ClothTime)
  const { mat, depth, u } = useMemo(() => {
    const u = makeClothUniforms(shape, time)
    return { mat: makeClothMaterial(map, u), depth: makeClothDepthMaterial(u), u }
  }, [map, shape, time])
  useLayoutEffect(() => applyClothUniforms(u, { set, torn, phase, belly, flutter, seed }), [u, set, torn, phase, belly, flutter, seed])
  useEffect(
    () => () => {
      mat.dispose()
      depth.dispose()
    },
    [mat, depth],
  )
  if (torn >= 0.98) return null
  return <mesh geometry={geometry} material={mat} customDepthMaterial={depth} castShadow={castShadow} frustumCulled={false} />
}

export interface FrigateMastProps {
  index: number
  mats: FrigateMaterials
  livery: Livery
  /** 0 furled … 1 full. */
  sails: number
  /** 0 standing … 1 fallen over the side. */
  snapped: number
  /** Extra tearing/scorching from damage on this mast's cell. */
  torn: number
  phase: number
  lod: Lod
  fallSide: 1 | -1
  flag?: ReactNode
}

export function FrigateMast({ index, mats, livery, sails, snapped, torn, phase, lod, fallSide, flag }: FrigateMastProps) {
  const m = MASTS[index]
  const spanker = index === MASTS.length - 1
  const geoms = useMemo(() => buildMastGeoms(m, lod, spanker), [m, lod, spanker])
  const rigging = useMemo(() => mastRigging(index, lod), [index, lod])
  const map = clothTextures.sail(livery).map
  const breakY = m.height * BREAK_FRAC
  const fall = snapped * snapped * (3 - 2 * snapped)
  const sailTorn = Math.max(torn, snapped * 1.2)
  return (
    <group>
      <group position={[m.x, deckY(m.x), 0]} rotation-z={m.rake}>
        <mesh geometry={geoms.stump} material={mats.oak} castShadow />
        <group position={[0, breakY, 0]} rotation-x={fallSide * fall * 1.45} rotation-z={fall * 0.35}>
          <mesh geometry={geoms.upperOak} material={mats.oak} castShadow />
          {lod < 2 && <mesh geometry={geoms.upperIron} material={mats.iron} />}
          {geoms.sails.map((s) => (
            <ClothMesh
              key={s.index}
              geometry={s.geometry}
              map={map}
              shape={0}
              set={sailSet(sails, s.index, geoms.sails.length) * (1 - fall)}
              torn={sailTorn}
              phase={phase + s.index * 1.3 + index * 2.1}
              belly={s.width * 0.2}
              seed={index * 10 + s.index}
            />
          ))}
          {geoms.spanker && <ClothMesh geometry={geoms.spanker} map={map} shape={0} set={sailSet(sails, 0, 3) * (1 - fall)} torn={sailTorn} phase={phase + 7} belly={0.12} seed={99} />}
          {flag && <group position={[0.07, m.height - breakY, 0]}>{flag}</group>}
        </group>
      </group>
      <RopeBundle segments={rigging} material={mats.rope} visible={snapped < 0.15} lod={lod} />
    </group>
  )
}

export function Bowsprit({ mats, livery, sails, torn, phase, lod, snapped }: { mats: FrigateMaterials; livery: Livery; sails: number; torn: number; phase: number; lod: Lod; snapped: number }) {
  const g = useMemo(() => buildBowsprit(lod), [lod])
  const map = clothTextures.sail(livery).map
  return (
    <group>
      <mesh geometry={g.oak} material={mats.oak} castShadow />
      <mesh geometry={g.black} material={mats.black} />
      <RopeBundle segments={g.ropes} material={mats.rope} lod={lod} />
      {g.jibs.map((j) => (
        <ClothMesh key={j.index} geometry={j.geometry} map={map} shape={1} set={sailSet(sails, j.index, 3) * (1 - snapped)} torn={Math.max(torn, snapped * 1.2)} phase={phase + 3 + j.index} belly={0.13 + j.index * 0.03} seed={50 + j.index} />
      ))}
    </group>
  )
}

/** Flag whose hoist is at `at` (top corner), streaming aft (−x). */
export function FlagMesh({ at, width, height, livery, set, phase, seed = 7 }: { at: Vec3; width: number; height: number; livery: Livery; set: number; phase: number; seed?: number }) {
  const geometry = useMemo(
    () =>
      sailGeometry({
        corners: [at, [at[0] - width, at[1], at[2]], [at[0] - width, at[1] - height, at[2]], [at[0], at[1] - height, at[2]]],
        segments: 8,
        belly: [0, 0, 1],
        furlTo: 'luff',
      }),
    [at, width, height],
  )
  return <ClothMesh geometry={geometry} map={clothTextures.flag(livery).map} shape={2} set={set} torn={0} phase={phase} belly={0} seed={seed} castShadow={false} />
}

