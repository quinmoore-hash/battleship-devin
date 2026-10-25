/**
 * Ship-detail kit: parts shared by every ship class (cannons, masts, sails, rigging, flags, deck props,
 * damage decals) plus hull lofting and livery materials.
 *
 * STATUS: PLACEHOLDER geometry. The kit session replaces the *implementations* (detailed cannon carriages,
 * sail cloth shader, rope rigging, lanterns…) but must keep every export and prop below stable, because
 * the five ship-class modules compose their ships from these parts.
 *
 * Conventions: all parts are authored in metres with the ship's frame (bow = +x, y = 0 waterline).
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import type { Livery } from '../types'
import { shipMaterials } from './materials'

export { shipMaterials, type ShipMaterials } from './materials'
export { loftHull, basicHullSections, type HullSection } from './hull'

export interface CannonProps {
  position: Vec3
  /** Rotation about y: 0 fires toward +z (starboard), Math.PI fires toward -z (port). */
  rotationY?: number
  livery: Livery
  /** 0 = at rest … 1 = full recoil (barrel slid inboard, smoke at the muzzle is the VFX module's job). */
  recoil?: number
  scale?: number
}

/** Cannon on a wheeled carriage. Muzzle is at local z = +0.45 (× scale). */
export function Cannon({ position, rotationY = 0, livery, recoil = 0, scale = 1 }: CannonProps) {
  const m = shipMaterials(livery)
  return (
    <group position={position} rotation-y={rotationY} scale={scale}>
      <group position={[0, 0.12, -recoil * 0.18]}>
        <mesh material={m.iron} position={[0, 0.1, 0.12]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.055, 0.075, 0.6, 12]} />
        </mesh>
        <mesh material={m.iron} position={[0, 0.1, -0.2]}>
          <sphereGeometry args={[0.07, 10, 8]} />
        </mesh>
      </group>
      <mesh material={m.deck} position={[0, 0.05, -0.02]}>
        <boxGeometry args={[0.22, 0.1, 0.36]} />
      </mesh>
      {[-0.12, 0.12].map((x) =>
        [-0.14, 0.12].map((z) => (
          <mesh key={`${x}${z}`} material={m.deck} position={[x, 0.05, z]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.055, 0.055, 0.03, 10]} />
          </mesh>
        )),
      )}
    </group>
  )
}

export interface SailProps {
  width: number
  height: number
  livery: Livery
  /** 0 furled … 1 full. */
  set?: number
  /** 0 pristine … 1 shredded. */
  torn?: number
  phase?: number
}

/** A square sail hung from a yard; billows toward +x (the wind is astern). */
export function Sail({ width, height, livery, set = 1, torn = 0, phase = 0 }: SailProps) {
  const m = shipMaterials(livery)
  const ref = useRef<THREE.Mesh>(null)
  const geom = useMemo(() => new THREE.PlaneGeometry(width, height, 8, 6), [width, height])
  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const t = clock.getElapsedTime() + phase
    const pos = geom.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const edge = 1 - Math.abs(x / (width / 2))
      const belly = 0.35 * set * edge * (0.6 + 0.4 * (1 - (y + height / 2) / height))
      pos.setZ(i, belly + Math.sin(t * 2 + y * 3 + x) * 0.02 * set)
    }
    pos.needsUpdate = true
    geom.computeVertexNormals()
    mesh.scale.y = 0.08 + 0.92 * set
    mesh.position.y = (-height / 2) * (1 - mesh.scale.y)
  })
  return <mesh ref={ref} geometry={geom} material={m.sail} rotation-y={-Math.PI / 2} visible={torn < 1} />
}

export interface MastProps {
  position: Vec3
  height: number
  livery: Livery
  /** Yards from bottom to top as [width, heightAboveBase] pairs; each hangs a sail. */
  yards?: [number, number][]
  sails?: number
  /** 0 standing … 1 snapped and fallen. */
  snapped?: number
  phase?: number
  /** Add a crow's nest near the top. */
  crowsNest?: boolean
}

/** Mast with yards, sails and an optional crow's nest. Snaps (tilts over) as `snapped` → 1. */
export function Mast({ position, height, livery, yards = [], sails = 1, snapped = 0, phase = 0, crowsNest }: MastProps) {
  const m = shipMaterials(livery)
  const tilt = snapped * 1.3
  return (
    <group position={position} rotation-z={tilt} rotation-x={snapped * 0.4}>
      <mesh material={m.deck} position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.035, 0.06, height, 10]} />
      </mesh>
      {yards.map(([w, y], i) => (
        <group key={i} position={[0, y, 0]}>
          <mesh material={m.deck} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.025, 0.025, w, 8]} />
          </mesh>
          <group position={[0.02, -Math.min(0.9, height * 0.22) / 2, 0]}>
            <Sail width={w * 0.95} height={Math.min(0.9, height * 0.22)} livery={livery} set={sails} phase={phase + i} />
          </group>
        </group>
      ))}
      {crowsNest && (
        <mesh material={m.deck} position={[0, height * 0.78, 0]}>
          <cylinderGeometry args={[0.14, 0.1, 0.12, 10, 1, true]} />
        </mesh>
      )}
    </group>
  )
}

export interface FlagProps {
  position: Vec3
  livery: Livery
  width?: number
  height?: number
  phase?: number
}

/** Pennant/ensign that streams toward -x (astern). Pirates fly black, navy flies red. */
export function Flag({ position, livery, width = 0.5, height = 0.3, phase = 0 }: FlagProps) {
  const m = shipMaterials(livery)
  const ref = useRef<THREE.Mesh>(null)
  const geom = useMemo(() => new THREE.PlaneGeometry(width, height, 8, 2), [width, height])
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() * 3 + phase
    const pos = geom.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const k = (x + width / 2) / width
      pos.setZ(i, Math.sin(t + k * 5) * 0.08 * k)
    }
    pos.needsUpdate = true
  })
  return <mesh ref={ref} geometry={geom} material={m.flag} position={[position[0] - width / 2, position[1], position[2]]} />
}

export interface LineProps {
  from: Vec3
  to: Vec3
  livery: Livery
  radius?: number
}

/** A straight rope between two points (stays, shrouds, braces). */
export function Rope({ from, to, livery, radius = 0.012 }: LineProps) {
  const m = shipMaterials(livery)
  const { mid, len, quat } = useMemo(() => {
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    const dir = b.clone().sub(a)
    const len = dir.length()
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
    return { mid: a.clone().add(b).multiplyScalar(0.5), len, quat }
  }, [from, to])
  return (
    <mesh material={m.rope} position={mid} quaternion={quat}>
      <cylinderGeometry args={[radius, radius, len, 5]} />
    </mesh>
  )
}

/** Ladder of ratlines between the rail and a point up the mast. */
export function Ratlines({ from, to, livery, rungs = 6 }: LineProps & { rungs?: number }) {
  const ropes: [Vec3, Vec3][] = [[from, to]]
  const other: Vec3 = [from[0], from[1], -from[2]]
  ropes.push([other, to])
  for (let i = 1; i < rungs; i++) {
    const t = i / rungs
    const a: Vec3 = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]
    const b: Vec3 = [a[0], a[1], -a[2] + 2 * to[2] * t]
    ropes.push([a, b])
  }
  return (
    <group>
      {ropes.map(([a, b], i) => (
        <Rope key={i} from={a} to={b} livery={livery} radius={0.008} />
      ))}
    </group>
  )
}

export function Railing({ position, length, livery, rotationY = 0 }: { position: Vec3; length: number; livery: Livery; rotationY?: number }) {
  const m = shipMaterials(livery)
  const posts = Math.max(2, Math.round(length / 0.35))
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh material={m.deck} position={[0, 0.22, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.02, 0.02, length, 6]} />
      </mesh>
      {Array.from({ length: posts }, (_, i) => (
        <mesh key={i} material={m.deck} position={[-length / 2 + (i / (posts - 1)) * length, 0.11, 0]}>
          <boxGeometry args={[0.03, 0.22, 0.03]} />
        </mesh>
      ))}
    </group>
  )
}

export function Barrel({ position, livery, scale = 1 }: { position: Vec3; livery: Livery; scale?: number }) {
  const m = shipMaterials(livery)
  return (
    <group position={position} scale={scale}>
      <mesh material={m.deck} position={[0, 0.11, 0]}>
        <cylinderGeometry args={[0.09, 0.08, 0.22, 10]} />
      </mesh>
      {[0.05, 0.17].map((y) => (
        <mesh key={y} material={m.iron} position={[0, y, 0]}>
          <torusGeometry args={[0.09, 0.008, 6, 16]} />
        </mesh>
      ))}
    </group>
  )
}

export function Crate({ position, livery, size = 0.2 }: { position: Vec3; livery: Livery; size?: number }) {
  const m = shipMaterials(livery)
  return (
    <mesh material={m.deck} position={[position[0], position[1] + size / 2, position[2]]}>
      <boxGeometry args={[size, size, size]} />
    </mesh>
  )
}

export function RopeCoil({ position, livery }: { position: Vec3; livery: Livery }) {
  const m = shipMaterials(livery)
  return (
    <mesh material={m.rope} position={[position[0], position[1] + 0.02, position[2]]} rotation-x={Math.PI / 2}>
      <torusGeometry args={[0.07, 0.025, 6, 14]} />
    </mesh>
  )
}

export function Lantern({ position, livery, lit = true }: { position: Vec3; livery: Livery; lit?: boolean }) {
  const m = shipMaterials(livery)
  return (
    <group position={position}>
      <mesh material={m.brass}>
        <boxGeometry args={[0.08, 0.12, 0.08]} />
      </mesh>
      {lit && (
        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[0.03, 8, 8]} />
          <meshBasicMaterial color="#ffb347" />
        </mesh>
      )}
    </group>
  )
}

export function Wheel({ position, livery }: { position: Vec3; livery: Livery }) {
  const m = shipMaterials(livery)
  return (
    <group position={position}>
      <mesh material={m.deck} position={[0, 0.15, 0]}>
        <boxGeometry args={[0.05, 0.3, 0.05]} />
      </mesh>
      <mesh material={m.brass} position={[0, 0.32, 0]} rotation-y={Math.PI / 2}>
        <torusGeometry args={[0.14, 0.015, 6, 16]} />
      </mesh>
    </group>
  )
}

export function Anchor({ position, livery, scale = 1 }: { position: Vec3; livery: Livery; scale?: number }) {
  const m = shipMaterials(livery)
  return (
    <group position={position} scale={scale}>
      <mesh material={m.iron}>
        <boxGeometry args={[0.03, 0.3, 0.03]} />
      </mesh>
      <mesh material={m.iron} position={[0, -0.14, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[0.1, 0.015, 6, 12, Math.PI]} />
      </mesh>
    </group>
  )
}

/** Blackened hole in the hull where a cannonball went through. Place on the hull surface, facing outward. */
export function HullHole({ position, rotationY = 0, radius = 0.16 }: { position: Vec3; rotationY?: number; radius?: number }) {
  return (
    <mesh position={position} rotation-y={rotationY}>
      <circleGeometry args={[radius, 12]} />
      <meshBasicMaterial color="#0a0604" side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  )
}
