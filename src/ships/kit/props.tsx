import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useGameStore } from '../../store/gameStore'
import type { Vec3 } from '../../scene/layout'
import { seededRandom } from '../../vfx/random'
import type { Livery, Lod } from '../types'
import { shipMaterials } from './materials'
import { Rope, ropeGeometry } from './Rope'

export interface BarrelProps {
  position: Vec3
  livery: Livery
  scale?: number
  /** Lay the barrel on its side (axis along x). */
  onSide?: boolean
  lod?: Lod
}

const BARREL_GEOM = (() => {
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    pts.push(new THREE.Vector2(0.13 + Math.sin(t * Math.PI) * 0.04, t * 0.4))
  }
  pts.unshift(new THREE.Vector2(0, 0))
  pts.push(new THREE.Vector2(0, 0.4))
  const g = new THREE.LatheGeometry(pts, 14)
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 0.5, uv.getX(i) * 3)
  return g
})()

/** Staved barrel with iron hoops. */
export function Barrel({ position, livery, scale = 1, onSide = false, lod = 0 }: BarrelProps) {
  const m = shipMaterials(livery)
  return (
    <group position={position} scale={scale} rotation-z={onSide ? Math.PI / 2 : 0} position-y={position[1] + (onSide ? 0.16 * scale : 0)}>
      <group position-y={onSide ? -0.2 : 0}>
        <mesh geometry={BARREL_GEOM} material={m.oak} castShadow receiveShadow />
        {(lod === 2 ? [0.2] : [0.05, 0.14, 0.26, 0.35]).map((y) => (
          <mesh key={y} material={m.iron} position-y={y} castShadow>
            <cylinderGeometry args={[0.135 + Math.sin((y / 0.4) * Math.PI) * 0.04, 0.135 + Math.sin((y / 0.4) * Math.PI) * 0.04, 0.025, 14, 1, true]} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

export interface CrateProps {
  position: Vec3
  livery: Livery
  size?: number
  rotationY?: number
}

/** Plank crate with corner battens. */
export function Crate({ position, livery, size = 0.2, rotationY = 0 }: CrateProps) {
  const m = shipMaterials(livery)
  const b = size * 0.08
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh material={m.oak} position-y={size / 2} castShadow receiveShadow>
        <boxGeometry args={[size, size, size]} />
      </mesh>
      {[-1, 1].flatMap((x) =>
        [-1, 1].map((z) => (
          <mesh key={`${x}${z}`} material={m.tarredPlanks} position={[(x * (size - b)) / 2, size / 2, (z * (size - b)) / 2]} castShadow>
            <boxGeometry args={[b * 1.2, size * 1.02, b * 1.2]} />
          </mesh>
        )),
      )}
      <mesh material={m.tarredPlanks} position-y={size * 1.0}>
        <boxGeometry args={[size * 1.02, b, size * 1.02]} />
      </mesh>
    </group>
  )
}

export interface RopeCoilProps {
  position: Vec3
  livery: Livery
  radius?: number
  turns?: number
}

/** Flaked-down coil of rope (a flattened helix tube). */
export function RopeCoil({ position, livery, radius = 0.12, turns = 4 }: RopeCoilProps) {
  const m = shipMaterials(livery)
  const geom = useMemo(() => {
    const pts: THREE.Vector3[] = []
    const n = turns * 14
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const a = t * turns * Math.PI * 2
      const r = radius * (0.35 + 0.65 * t)
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0.014 + 0.004 * Math.sin(a * 2), Math.sin(a) * r))
    }
    return ropeGeometry(pts, 0.014, 6, n)
  }, [radius, turns])
  useEffect(() => () => geom.dispose(), [geom])
  return <mesh geometry={geom} material={m.rope} position={position} castShadow receiveShadow />
}

export interface LanternProps {
  position: Vec3
  livery: Livery
  lit?: boolean
  scale?: number
  /** Add a (non-shadowing) point light when lit. Default false — keep light counts low in the fleet scene. */
  light?: boolean
  lod?: Lod
}

/** Brass-framed hanging lantern with glass panes and a flickering flame. */
export function Lantern({ position, livery, lit = true, scale = 1, light = false, lod = 0 }: LanternProps) {
  const m = shipMaterials(livery)
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const flame = useMemo(() => (m.flame as THREE.MeshStandardMaterial).clone(), [m])
  useEffect(() => () => flame.dispose(), [flame])
  const lightRef = useRef<THREE.PointLight>(null)
  const phase = position[0] * 3.1 + position[2] * 7.7
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 9 + phase
    const f = lit ? (reducedMotion ? 1 : 0.8 + 0.2 * (Math.sin(t) * 0.5 + Math.sin(t * 2.7) * 0.3 + Math.sin(t * 5.3) * 0.2)) : 0
    flame.emissiveIntensity = f * 3
    if (lightRef.current) lightRef.current.intensity = f * 0.9
  })
  return (
    <group position={position} scale={scale}>
      <mesh material={m.brass} position-y={0.05}>
        <cylinderGeometry args={[0.012, 0.012, 0.1, 6]} />
      </mesh>
      <mesh material={m.brass} position-y={-0.02} castShadow>
        <coneGeometry args={[0.07, 0.04, 8]} />
      </mesh>
      <mesh material={m.brass} position-y={-0.145} castShadow>
        <cylinderGeometry args={[0.045, 0.055, 0.03, 8]} />
      </mesh>
      {lod < 2 &&
        [0, 1, 2, 3].map((i) => (
          <mesh key={i} material={m.brass} position={[Math.cos((i * Math.PI) / 2 + Math.PI / 4) * 0.045, -0.085, Math.sin((i * Math.PI) / 2 + Math.PI / 4) * 0.045]}>
            <boxGeometry args={[0.008, 0.1, 0.008]} />
          </mesh>
        ))}
      <mesh material={m.windowGlass} position-y={-0.085}>
        <cylinderGeometry args={[0.046, 0.046, 0.09, 4, 1, true]} />
      </mesh>
      <mesh material={flame} position-y={-0.1} visible={lit}>
        <coneGeometry args={[0.014, 0.05, 6]} />
      </mesh>
      {lit && light && <pointLight ref={lightRef} position-y={-0.08} color="#ffb347" distance={3} decay={2} />}
    </group>
  )
}

export interface SternLanternProps {
  position: Vec3
  livery: Livery
  lit?: boolean
  scale?: number
  light?: boolean
  lod?: Lod
}

/** Large ornate stern lantern (octagonal glass body, gilded cap) mounted on a bracket. */
export function SternLantern({ position, livery, lit = true, scale = 1, light = false, lod = 0 }: SternLanternProps) {
  const m = shipMaterials(livery)
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const flame = useMemo(() => (m.flame as THREE.MeshStandardMaterial).clone(), [m])
  useEffect(() => () => flame.dispose(), [flame])
  const lightRef = useRef<THREE.PointLight>(null)
  const phase = position[1] * 5.3
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * 7 + phase
    const f = lit ? (reducedMotion ? 1 : 0.85 + 0.15 * (Math.sin(t) * 0.6 + Math.sin(t * 3.1) * 0.4)) : 0
    flame.emissiveIntensity = f * 3.5
    if (lightRef.current) lightRef.current.intensity = f * 2
  })
  const ribs = lod === 0 ? 8 : 6
  return (
    <group position={position} scale={scale}>
      {/* bracket from the taffrail */}
      <mesh material={m.iron} position={[0.08, -0.05, 0]} rotation-z={0.5}>
        <boxGeometry args={[0.2, 0.02, 0.02]} />
      </mesh>
      <mesh material={m.gold} position-y={0.17} castShadow>
        <coneGeometry args={[0.1, 0.1, ribs]} />
      </mesh>
      <mesh material={m.gold} position-y={0.23}>
        <sphereGeometry args={[0.02, 8, 6]} />
      </mesh>
      <mesh material={m.gold} position-y={0.12}>
        <cylinderGeometry args={[0.1, 0.11, 0.02, ribs]} />
      </mesh>
      <mesh material={m.gold} position-y={-0.12} castShadow>
        <cylinderGeometry args={[0.11, 0.07, 0.03, ribs]} />
      </mesh>
      <mesh material={m.gold} position-y={-0.16}>
        <sphereGeometry args={[0.03, 8, 6]} />
      </mesh>
      {Array.from({ length: ribs }, (_, i) => (
        <mesh key={i} material={m.gold} position={[Math.cos((i / ribs) * Math.PI * 2) * 0.1, 0, Math.sin((i / ribs) * Math.PI * 2) * 0.1]} rotation-y={-(i / ribs) * Math.PI * 2}>
          <boxGeometry args={[0.014, 0.23, 0.014]} />
        </mesh>
      ))}
      <mesh material={m.windowGlass}>
        <cylinderGeometry args={[0.1, 0.1, 0.22, ribs, 1, true]} />
      </mesh>
      <mesh material={flame} position-y={-0.03} visible={lit}>
        <coneGeometry args={[0.03, 0.1, 6]} />
      </mesh>
      {lit && light && <pointLight ref={lightRef} color="#ffb347" distance={6} decay={2} />}
    </group>
  )
}

export interface WheelProps {
  position: Vec3
  livery: Livery
  radius?: number
  /** Wheel spin in radians. */
  turn?: number
}

/** Ship's wheel on a pedestal with the drum and tiller ropes. */
export function Wheel({ position, livery, radius = 0.3, turn = 0 }: WheelProps) {
  const m = shipMaterials(livery)
  return (
    <group position={position}>
      {[-1, 1].map((s) => (
        <mesh key={s} material={m.oak} position={[s * 0.09, radius * 0.6, 0]} castShadow>
          <boxGeometry args={[0.05, radius * 1.2, 0.12]} />
        </mesh>
      ))}
      <mesh material={m.oak} position-y={radius * 1.2} rotation-z={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.07, 0.07, 0.3, 10]} />
      </mesh>
      <group position={[0.17, radius * 1.2, 0]} rotation-y={Math.PI / 2} rotation-z={turn}>
        <mesh material={m.oak} castShadow>
          <torusGeometry args={[radius, 0.022, 8, 24]} />
        </mesh>
        <mesh material={m.brass}>
          <torusGeometry args={[radius * 0.45, 0.014, 6, 20]} />
        </mesh>
        <mesh material={m.brass} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.05, 0.05, 0.08, 10]} />
        </mesh>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh key={i} material={m.oak} rotation-z={(i * Math.PI) / 4} castShadow>
            <cylinderGeometry args={[0.012, 0.016, radius * 2 + 0.28, 6]} />
          </mesh>
        ))}
      </group>
      <Rope from={[0, radius * 1.2 - 0.07, 0.07]} to={[0, 0.03, 0.25]} sag={0.01} livery={livery} radius={0.008} />
      <Rope from={[0, radius * 1.2 - 0.07, -0.07]} to={[0, 0.03, -0.25]} sag={0.01} livery={livery} radius={0.008} />
    </group>
  )
}

export interface AnchorProps {
  position: Vec3
  livery: Livery
  scale?: number
  /** Rotation about y (the shank hangs down −y; flukes spread along local x). */
  rotationY?: number
}

/** Admiralty-pattern anchor with wooden stock, iron ring and curved arms. */
export function Anchor({ position, livery, scale = 1, rotationY = 0 }: AnchorProps) {
  const m = shipMaterials(livery)
  const arms = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.42, -0.48, 0), new THREE.Vector3(-0.25, -0.66, 0), new THREE.Vector3(0, -0.7, 0), new THREE.Vector3(0.25, -0.66, 0), new THREE.Vector3(0.42, -0.48, 0)])
    return new THREE.TubeGeometry(curve, 16, 0.03, 8, false)
  }, [])
  useEffect(() => () => arms.dispose(), [arms])
  return (
    <group position={position} scale={scale} rotation-y={rotationY}>
      <mesh material={m.iron} position-y={-0.33} castShadow>
        <boxGeometry args={[0.06, 0.72, 0.045]} />
      </mesh>
      <mesh material={m.iron} position-y={0.06} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.07, 0.016, 8, 16]} />
      </mesh>
      <mesh material={m.tarredPlanks} position-y={-0.08} rotation-x={Math.PI / 2} castShadow>
        <boxGeometry args={[0.07, 0.72, 0.07]} />
      </mesh>
      <mesh geometry={arms} material={m.iron} castShadow />
      {[-1, 1].map((s) => (
        <mesh key={s} material={m.iron} position={[s * 0.4, -0.48, 0]} rotation-z={s * 0.6} castShadow>
          <coneGeometry args={[0.07, 0.17, 4]} />
        </mesh>
      ))}
    </group>
  )
}

export interface CapstanProps {
  position: Vec3
  livery: Livery
  scale?: number
  lod?: Lod
}

/** Capstan with whelps, iron pawl ring and shipped bars. */
export function Capstan({ position, livery, scale = 1, lod = 0 }: CapstanProps) {
  const m = shipMaterials(livery)
  const bars = lod === 0 ? 6 : 4
  return (
    <group position={position} scale={scale}>
      <mesh material={m.oak} position-y={0.03} receiveShadow>
        <cylinderGeometry args={[0.3, 0.32, 0.06, 12]} />
      </mesh>
      <mesh material={m.iron} position-y={0.07}>
        <cylinderGeometry args={[0.22, 0.24, 0.03, 12]} />
      </mesh>
      <mesh material={m.oak} position-y={0.32} castShadow receiveShadow>
        <cylinderGeometry args={[0.13, 0.17, 0.5, 10]} />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => (
        <mesh key={i} material={m.oak} position={[Math.cos((i / 8) * Math.PI * 2) * 0.18, 0.25, Math.sin((i / 8) * Math.PI * 2) * 0.18]} rotation-y={-(i / 8) * Math.PI * 2} castShadow>
          <boxGeometry args={[0.08, 0.34, 0.035]} />
        </mesh>
      ))}
      <mesh material={m.oak} position-y={0.62} castShadow>
        <cylinderGeometry args={[0.2, 0.17, 0.12, 10]} />
      </mesh>
      {Array.from({ length: bars }, (_, i) => (
        <mesh key={i} material={m.oak} position={[Math.cos((i / bars) * Math.PI * 2) * 0.42, 0.62, Math.sin((i / bars) * Math.PI * 2) * 0.42]} rotation-y={-(i / bars) * Math.PI * 2} rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.02, 0.025, 0.55, 6]} />
        </mesh>
      ))}
      <mesh material={m.brass} position-y={0.7}>
        <cylinderGeometry args={[0.05, 0.08, 0.05, 10]} />
      </mesh>
    </group>
  )
}

export interface BellProps {
  position: Vec3
  livery: Livery
  scale?: number
}

const BELL_GEOM = (() => {
  const pts: THREE.Vector2[] = []
  const prof: [number, number][] = [[0, 0.17], [0.035, 0.165], [0.04, 0.14], [0.05, 0.1], [0.07, 0.04], [0.095, 0.01], [0.1, 0], [0.085, 0.005], [0.06, 0.04], [0.04, 0.1], [0.03, 0.14], [0, 0.145]]
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y))
  return new THREE.LatheGeometry(pts, 18)
})()

/** Ship's bell in a wooden belfry with a lanyard. */
export function Bell({ position, livery, scale = 1 }: BellProps) {
  const m = shipMaterials(livery)
  return (
    <group position={position} scale={scale}>
      {[-1, 1].map((s) => (
        <mesh key={s} material={m.oak} position={[s * 0.16, 0.22, 0]} castShadow>
          <boxGeometry args={[0.05, 0.44, 0.05]} />
        </mesh>
      ))}
      <mesh material={m.oak} position-y={0.46} castShadow>
        <boxGeometry args={[0.4, 0.05, 0.08]} />
      </mesh>
      <mesh material={m.oak} position-y={0.36} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.02, 0.02, 0.3, 8]} />
      </mesh>
      <mesh geometry={BELL_GEOM} material={m.brass} position-y={0.16} castShadow />
      <mesh material={m.brass} position-y={0.16}>
        <sphereGeometry args={[0.015, 8, 6]} />
      </mesh>
      <Rope from={[0, 0.16, 0]} to={[0.03, 0.02, 0.05]} sag={0.02} livery={livery} radius={0.006} />
    </group>
  )
}

export interface WindowProps {
  position: Vec3
  livery: Livery
  rotationY?: number
  width?: number
  height?: number
  /** Mullion columns × rows. */
  panes?: [number, number]
}

/** Stern-gallery window: gilded frame, mullions and glass. Faces +z at `rotationY = 0`. */
export function Window({ position, livery, rotationY = 0, width = 0.36, height = 0.42, panes = [3, 3] }: WindowProps) {
  const m = shipMaterials(livery)
  const [px, py] = panes
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh material={m.windowGlass}>
        <planeGeometry args={[width, height]} />
      </mesh>
      <mesh material={m.char} position-z={-0.015}>
        <planeGeometry args={[width, height]} />
      </mesh>
      <mesh material={m.gold} position-y={height / 2 + 0.015} castShadow>
        <boxGeometry args={[width + 0.08, 0.04, 0.03]} />
      </mesh>
      <mesh material={m.gold} position-y={-height / 2 - 0.015}>
        <boxGeometry args={[width + 0.08, 0.04, 0.03]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={m.gold} position-x={(s * (width + 0.04)) / 2}>
          <boxGeometry args={[0.04, height + 0.07, 0.03]} />
        </mesh>
      ))}
      {Array.from({ length: px - 1 }, (_, i) => (
        <mesh key={`x${i}`} material={m.trim} position-x={-width / 2 + ((i + 1) * width) / px}>
          <boxGeometry args={[0.012, height, 0.012]} />
        </mesh>
      ))}
      {Array.from({ length: py - 1 }, (_, i) => (
        <mesh key={`y${i}`} material={m.trim} position-y={-height / 2 + ((i + 1) * height) / py}>
          <boxGeometry args={[width, 0.012, 0.012]} />
        </mesh>
      ))}
    </group>
  )
}

export interface FigureheadProps {
  /** Stem-head position; the figure leans forward along +x. */
  position: Vec3
  livery: Livery
  scale?: number
}

/** Generic carved figurehead (robed figure, gilded for the navy, weathered for pirates) with trailboards. */
export function Figurehead({ position, livery, scale = 1 }: FigureheadProps) {
  const m = shipMaterials(livery)
  const body = livery === 'navy' ? m.gold : m.paint
  return (
    <group position={position} scale={scale} rotation-z={-0.45}>
      <mesh material={body} position-y={0.12} castShadow>
        <capsuleGeometry args={[0.07, 0.22, 4, 10]} />
      </mesh>
      <mesh material={body} position-y={0.36} castShadow>
        <sphereGeometry args={[0.06, 10, 8]} />
      </mesh>
      <mesh material={m.trim} position-y={0.41} castShadow>
        <coneGeometry args={[0.05, 0.08, 8]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={body} position={[0.06, 0.2, s * 0.07]} rotation-z={-0.8} rotation-x={s * 0.4} castShadow>
          <capsuleGeometry args={[0.025, 0.18, 3, 6]} />
        </mesh>
      ))}
      <mesh material={body} position-y={-0.1} castShadow>
        <coneGeometry args={[0.11, 0.3, 10]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={m.trim} position={[-0.3, -0.12, s * 0.09]} rotation-z={0.3} castShadow>
          <boxGeometry args={[0.5, 0.07, 0.02]} />
        </mesh>
      ))}
    </group>
  )
}

export interface BoatProps {
  position: Vec3
  livery: Livery
  length?: number
  rotationY?: number
  lod?: Lod
}

/** Clinker-built ship's boat stowed keel-down on chocks, with thwarts and shipped oars. */
export function Boat({ position, livery, length = 1.6, rotationY = 0, lod = 0 }: BoatProps) {
  const m = shipMaterials(livery)
  const hull = useMemo(() => {
    const w = length * 0.3
    const h = length * 0.17
    const n = lod === 0 ? 9 : 5
    const g = new THREE.BufferGeometry()
    const pos: number[] = []
    const idx: number[] = []
    const uv: number[] = []
    const ringsN = lod === 0 ? 10 : 6
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const x = (t - 0.5) * length
      const taper = Math.sin(t * Math.PI) ** 0.6 * (1 - Math.abs(t - 0.5) * 0.4)
      for (let j = 0; j <= ringsN; j++) {
        const a = (j / ringsN) * Math.PI
        const y = h - Math.sin(a) * h
        const z = -Math.cos(a) * w * 0.5 * taper * (0.3 + 0.7 * Math.sin(a) ** 0.5 + (1 - Math.sin(a)) * 0.7)
        pos.push(x, y, z)
        uv.push(t * 4, j / ringsN)
      }
    }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < ringsN; j++) {
        const a = i * (ringsN + 1) + j
        const b = a + ringsN + 1
        idx.push(a, b, a + 1, a + 1, b, b + 1)
      }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [length, lod])
  useEffect(() => () => hull.dispose(), [hull])
  const h = length * 0.17
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh geometry={hull} material={m.tarredPlanks} castShadow receiveShadow position-y={0.08} />
      <mesh material={m.trim} position-y={h + 0.08}>
        <boxGeometry args={[length * 0.96, 0.03, length * 0.3]} />
      </mesh>
      <mesh material={m.char} position-y={h + 0.065}>
        <boxGeometry args={[length * 0.9, 0.01, length * 0.26]} />
      </mesh>
      {[0.3, 0.5, 0.7].map((t) => (
        <mesh key={t} material={m.oak} position={[(t - 0.5) * length, h + 0.03, 0]} castShadow>
          <boxGeometry args={[0.05, 0.025, length * 0.26]} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} material={m.oak} position={[(s * length) / 3.2, 0.03, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.1, 0.06, length * 0.26]} />
        </mesh>
      ))}
      {lod < 2 &&
        [-1, 1].map((s) => (
          <mesh key={s} material={m.spar} position={[0.1, h + 0.1, s * length * 0.07]} rotation-z={Math.PI / 2} castShadow>
            <cylinderGeometry args={[0.012, 0.018, length * 1.1, 6]} />
          </mesh>
        ))}
    </group>
  )
}

export interface NettingProps {
  /** Centre of the netting (runs along ±x/2 of `length` after `rotationY`). */
  position: Vec3
  length: number
  height?: number
  livery: Livery
  rotationY?: number
  pitch?: number
}

/** Hammock / boarding netting: a diamond lattice of thin cordage spanning the rail. */
export function Netting({ position, length, height = 0.5, livery, rotationY = 0, pitch = 0.08 }: NettingProps) {
  const m = shipMaterials(livery)
  const geom = useMemo(() => {
    const pos: number[] = []
    const nx = Math.round(length / pitch)
    const ny = Math.round(height / pitch)
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= ny; j++) {
        const x = (i / nx) * length - length / 2
        const y = (j / ny) * height
        if (i < nx) pos.push(x, y, 0, x + length / nx, Math.min(height, y + height / ny), 0)
        if (i < nx && j > 0) pos.push(x, y, 0, x + length / nx, y - height / ny, 0)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    return g
  }, [length, height, pitch])
  useEffect(() => () => geom.dispose(), [geom])
  const line = useMemo(() => new THREE.LineBasicMaterial({ color: (m.rope as THREE.MeshStandardMaterial).color.clone().multiplyScalar(0.45) }), [m])
  return (
    <group position={position} rotation-y={rotationY}>
      <lineSegments geometry={geom} material={line} />
      <Rope from={[-length / 2, height, 0]} to={[length / 2, height, 0]} sag={0.015} livery={livery} radius={0.009} />
      {[-length / 2, length / 2].map((x) => (
        <mesh key={x} material={m.oak} position={[x, height / 2, 0]} castShadow>
          <cylinderGeometry args={[0.014, 0.018, height, 6]} />
        </mesh>
      ))}
    </group>
  )
}

export interface ChestProps {
  position: Vec3
  livery: Livery
  size?: number
  rotationY?: number
  /** Lid opening 0..1. */
  open?: number
}

/** Iron-bound sea chest with a domed lid, hasp and (optionally) a glint of coin inside. */
export function Chest({ position, livery, size = 0.4, rotationY = 0, open = 0 }: ChestProps) {
  const m = shipMaterials(livery)
  const w = size
  const d = size * 0.6
  const h = size * 0.45
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh material={m.oak} position-y={h / 2} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      {[-0.35, 0.35].map((f) => (
        <mesh key={f} material={m.iron} position={[f * w, h / 2, 0]}>
          <boxGeometry args={[0.03, h * 1.01, d * 1.02]} />
        </mesh>
      ))}
      {open > 0.01 && (
        <mesh material={m.gold} position-y={h - 0.01}>
          <boxGeometry args={[w * 0.9, 0.02, d * 0.9]} />
        </mesh>
      )}
      <group position={[0, h, -d / 2]} rotation-x={open * 1.9}>
        <mesh material={m.oak} position={[0, 0.02, d / 2]} castShadow>
          <boxGeometry args={[w, 0.04, d]} />
        </mesh>
        <mesh material={m.oak} position={[0, 0.04, d / 2]} rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[d / 2, d / 2, w, 12, 1, false, 0, Math.PI]} />
        </mesh>
        {[-0.35, 0.35].map((f) => (
          <mesh key={f} material={m.iron} position={[f * w, 0.045, d / 2]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[d / 2 + 0.005, d / 2 + 0.005, 0.03, 12, 1, false, 0, Math.PI]} />
          </mesh>
        ))}
        <mesh material={m.brass} position={[0, -0.03, d + 0.005]}>
          <boxGeometry args={[0.05, 0.09, 0.012]} />
        </mesh>
      </group>
      <mesh material={m.brass} position={[0, h * 0.75, d / 2 + 0.008]}>
        <boxGeometry args={[0.04, 0.03, 0.012]} />
      </mesh>
    </group>
  )
}

export interface HullHoleProps {
  position: Vec3
  rotationY?: number
  radius?: number
  /** Seed for the splinter pattern. */
  seed?: number
}

const SPLINTER_MAT = new THREE.MeshStandardMaterial({ color: '#4a3016', roughness: 0.95 })
const CHAR_MAT = new THREE.MeshStandardMaterial({ color: '#0a0806', roughness: 1 })

/** Shot hole: dark ragged opening with splintered plank ends standing proud of the hull. Faces +z at `rotationY = 0`. */
export function HullHole({ position, rotationY = 0, radius = 0.16, seed = 1 }: HullHoleProps) {
  const splinters = useMemo(() => {
    const rnd = seededRandom(seed + position[0] * 13 + position[1] * 7)
    return Array.from({ length: 9 }, (_, i) => {
      const a = (i / 9) * Math.PI * 2 + rnd() * 0.5
      return { a, len: radius * (0.5 + rnd() * 0.6), w: 0.02 + rnd() * 0.02, tilt: 0.3 + rnd() * 0.5 }
    })
  }, [seed, radius, position])
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh material={CHAR_MAT} position-z={0.01}>
        <circleGeometry args={[radius, 12]} />
      </mesh>
      <mesh material={CHAR_MAT} position-z={0.005}>
        <ringGeometry args={[radius, radius * 1.4, 12]} />
      </mesh>
      {splinters.map((s, i) => (
        <mesh
          key={i}
          material={SPLINTER_MAT}
          position={[Math.cos(s.a) * radius * 1.05, Math.sin(s.a) * radius * 1.05, 0.02]}
          rotation={[Math.sin(s.a) * s.tilt, -Math.cos(s.a) * s.tilt, s.a]}
          castShadow
        >
          <boxGeometry args={[s.len, s.w, 0.015]} />
        </mesh>
      ))}
    </group>
  )
}
