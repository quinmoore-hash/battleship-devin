import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import type { Livery, Lod } from '../types'
import type { GunPortPlacement } from './hull'
import { shipMaterials } from './materials'
import { Rope } from './Rope'

export interface RailingProps {
  /** Start of the rail (the rail runs along +x after `rotationY`). */
  position: Vec3
  length: number
  livery: Livery
  rotationY?: number
  height?: number
  /** Post spacing in metres. */
  spacing?: number
  lod?: Lod
}

const BALUSTER = (() => {
  const pts: THREE.Vector2[] = []
  const prof: [number, number][] = [[0.02, 0], [0.02, 0.05], [0.012, 0.07], [0.016, 0.3], [0.024, 0.36], [0.024, 0.46], [0.016, 0.5], [0.016, 1]]
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y))
  return new THREE.LatheGeometry(pts, 8)
})()
const POST_SIMPLE = new THREE.CylinderGeometry(0.016, 0.02, 1, 5).translate(0, 0.5, 0)
const _m = new THREE.Matrix4()

/** Rail with turned balusters (one InstancedMesh per railing) and a capped top rail. */
export function Railing({ position, length, livery, rotationY = 0, height = 0.3, spacing = 0.28, lod = 0 }: RailingProps) {
  const m = shipMaterials(livery)
  const count = Math.max(2, Math.round(length / spacing) + 1)
  const inst = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = inst.current
    if (!mesh) return
    for (let i = 0; i < count; i++) {
      const x = (i / (count - 1)) * length
      mesh.setMatrixAt(i, _m.makeScale(1, height, 1).setPosition(x, 0, 0))
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [count, length, height])
  return (
    <group position={position} rotation-y={rotationY}>
      <instancedMesh ref={inst} args={[lod === 0 ? BALUSTER : POST_SIMPLE, m.oak, count]} castShadow receiveShadow frustumCulled={false} />
      <mesh material={m.trim} position={[length / 2, height + 0.015, 0]} castShadow receiveShadow>
        <boxGeometry args={[length + 0.04, 0.03, 0.07]} />
      </mesh>
      {lod < 2 && (
        <mesh material={m.oak} position={[length / 2, height * 0.5, 0]} castShadow>
          <boxGeometry args={[length, 0.025, 0.025]} />
        </mesh>
      )}
    </group>
  )
}

export interface GunPortProps {
  /** Either a `placement` from `loftHullParts` or an explicit position/rotation on the hull side. */
  placement?: GunPortPlacement
  position?: Vec3
  rotationY?: number
  width?: number
  height?: number
  livery: Livery
  /** 0 closed … 1 lid fully raised. */
  open?: number
  lod?: Lod
}

/** Framed gun-port with a top-hinged lid (lanyard holds it open). Faces +z at `rotationY = 0`. */
export function GunPort({ placement, position, rotationY, width, height, livery, open = 1, lod = 0 }: GunPortProps) {
  const m = shipMaterials(livery)
  const pos: Vec3 = placement ? placement.position : (position ?? [0, 0, 0])
  const rot = placement ? placement.rotationY : (rotationY ?? 0)
  const w = width ?? placement?.width ?? 0.3
  const h = height ?? placement?.height ?? 0.26
  const lidAngle = open * 1.45
  return (
    <group position={pos} rotation-y={rot}>
      <mesh material={m.char} position-z={-0.02}>
        <planeGeometry args={[w, h]} />
      </mesh>
      {/* frame */}
      <mesh material={m.trim} position-y={h / 2 + 0.02} castShadow>
        <boxGeometry args={[w + 0.08, 0.04, 0.03]} />
      </mesh>
      <mesh material={m.trim} position-y={-h / 2 - 0.02} castShadow>
        <boxGeometry args={[w + 0.08, 0.04, 0.03]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={m.trim} position-x={(s * (w + 0.04)) / 2}>
          <boxGeometry args={[0.04, h, 0.03]} />
        </mesh>
      ))}
      {/* lid hinged along the top edge */}
      <group position={[0, h / 2, 0.015]} rotation-x={-lidAngle}>
        <mesh material={m.hull} position-y={-h / 2} castShadow receiveShadow>
          <boxGeometry args={[w, h, 0.03]} />
        </mesh>
        <mesh material={m.paint} position={[0, -h / 2, -0.016]}>
          <planeGeometry args={[w - 0.02, h - 0.02]} />
        </mesh>
        {lod < 2 &&
          [-1, 1].map((s) => (
            <mesh key={s} material={m.iron} position={[s * w * 0.3, -0.04, 0.02]} castShadow>
              <boxGeometry args={[0.03, 0.08, 0.01]} />
            </mesh>
          ))}
      </group>
      {lod < 2 && open > 0.05 && (
        <Rope
          from={[0, h / 2 + 0.08, 0.03]}
          to={[0, h / 2 - Math.cos(lidAngle) * h * 0.85, 0.015 + Math.sin(lidAngle) * h * 0.85]}
          sag={0.02 * (1 - open)}
          livery={livery}
          radius={0.007}
          lod={lod}
        />
      )}
    </group>
  )
}

export interface StairsProps {
  position: Vec3
  livery: Livery
  rotationY?: number
  width?: number
  height?: number
  /** Horizontal run (default 1.2 × height). Steps rise toward -x. */
  run?: number
  steps?: number
}

/** Companion ladder / stairs between decks, rising toward −x with a handrail on both sides. */
export function Stairs({ position, livery, rotationY = 0, width = 0.6, height = 0.5, run, steps }: StairsProps) {
  const m = shipMaterials(livery)
  const r = run ?? height * 1.2
  const n = steps ?? Math.max(3, Math.round(height / 0.12))
  const stepH = height / n
  const stepD = r / n
  return (
    <group position={position} rotation-y={rotationY}>
      {Array.from({ length: n }, (_, i) => (
        <group key={i}>
          <mesh material={m.deck} position={[-stepD * (i + 0.5), stepH * (i + 1) - 0.015, 0]} castShadow receiveShadow>
            <boxGeometry args={[stepD + 0.03, 0.03, width]} />
          </mesh>
          <mesh material={m.oak} position={[-stepD * (i + 1) + 0.015, stepH * (i + 0.5), 0]} receiveShadow>
            <boxGeometry args={[0.02, stepH, width - 0.04]} />
          </mesh>
        </group>
      ))}
      {[-1, 1].map((s) => (
        <group key={s} position-z={(s * width) / 2}>
          <mesh material={m.oak} position={[-r / 2, height / 2, 0]} rotation-z={Math.atan2(height, -r)} castShadow>
            <boxGeometry args={[Math.hypot(r, height), 0.05, 0.03]} />
          </mesh>
          <mesh material={m.oak} position={[-0.05, height * 0.9, 0]} castShadow>
            <cylinderGeometry args={[0.015, 0.015, height * 1.8, 6]} />
          </mesh>
          <mesh material={m.oak} position={[-r + 0.05, height + height * 0.9, 0]} castShadow>
            <cylinderGeometry args={[0.015, 0.015, height * 1.8, 6]} />
          </mesh>
          <mesh material={m.trim} position={[-r / 2, height * 1.8, 0]} rotation-z={Math.atan2(height, -r)} castShadow>
            <boxGeometry args={[Math.hypot(r, height), 0.03, 0.04]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

export interface HatchProps {
  position: Vec3
  livery: Livery
  width?: number
  depth?: number
  rotationY?: number
  lod?: Lod
}

const BAR = new THREE.BoxGeometry(1, 1, 1)

/** Cargo hatch with a raised coaming and an instanced wooden grating. */
export function Hatch({ position, livery, width = 0.8, depth = 0.6, rotationY = 0, lod = 0 }: HatchProps) {
  const m = shipMaterials(livery)
  const pitch = lod === 0 ? 0.06 : 0.12
  const bars = useMemo(() => {
    const nx = Math.floor((width - 0.1) / pitch)
    const nz = Math.floor((depth - 0.1) / pitch)
    const mats: THREE.Matrix4[] = []
    for (let i = 0; i < nx; i++) mats.push(new THREE.Matrix4().makeScale(0.02, 0.03, depth - 0.1).setPosition(-((nx - 1) * pitch) / 2 + i * pitch, 0.11, 0))
    for (let j = 0; j < nz; j++) mats.push(new THREE.Matrix4().makeScale(width - 0.1, 0.03, 0.02).setPosition(0, 0.11, -((nz - 1) * pitch) / 2 + j * pitch))
    return mats
  }, [width, depth, pitch])
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh material={m.char} position-y={0.08}>
        <boxGeometry args={[width - 0.1, 0.02, depth - 0.1]} />
      </mesh>
      {[
        [0, (depth - 0.05) / 2, width, 0.05],
        [0, -(depth - 0.05) / 2, width, 0.05],
        [(width - 0.05) / 2, 0, 0.05, depth - 0.1],
        [-(width - 0.05) / 2, 0, 0.05, depth - 0.1],
      ].map(([x, z, sx, sz], i) => (
        <mesh key={i} material={m.oak} position={[x, 0.07, z]} castShadow receiveShadow>
          <boxGeometry args={[sx, 0.14, sz]} />
        </mesh>
      ))}
      <instancedMesh
        args={[BAR, m.oak, bars.length]}
        castShadow
        receiveShadow
        ref={(mesh) => {
          if (!mesh) return
          bars.forEach((b, i) => mesh.setMatrixAt(i, b))
          mesh.instanceMatrix.needsUpdate = true
        }}
      />
    </group>
  )
}
