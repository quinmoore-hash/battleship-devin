import { useMemo } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import type { Livery, Lod } from '../types'
import { shipMaterials } from './materials'
import { mergeBuffers, ropeCurve, ropeGeometry } from './Rope'

export interface CannonProps {
  position: Vec3
  /** Yaw of the muzzle; 0 points along +z (starboard). */
  rotationY?: number
  livery: Livery
  /** 0 run out … 1 fully recoiled along the breeching rope. */
  recoil?: number
  scale?: number
  lod?: Lod
}

/** Barrel lathe profile: [radius, z] from cascabel (z≈-0.3) to muzzle face (z=0.45). */
const BARREL_PROFILE: [number, number][] = [
  [0, -0.33], [0.025, -0.33], [0.032, -0.315], [0.032, -0.3], [0.02, -0.29], [0.02, -0.27],
  [0.055, -0.26], [0.062, -0.24], [0.062, -0.22], [0.068, -0.215], [0.068, -0.2], [0.062, -0.195],
  [0.062, -0.03], [0.066, -0.025], [0.066, -0.01], [0.057, -0.005],
  [0.055, 0.17], [0.059, 0.175], [0.059, 0.185], [0.05, 0.19],
  [0.047, 0.39], [0.052, 0.4], [0.06, 0.42], [0.06, 0.44], [0.055, 0.45], [0.028, 0.45], [0.028, 0.42], [0, 0.42],
]

const GEOM = new Map<string, THREE.BufferGeometry>()
const _e = new THREE.Euler()

/** Clone `g`, rotate (Euler xyz) and translate it — a tiny helper for assembling merged parts. */
function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  const c = g.clone()
  if (rx || ry || rz) c.applyQuaternion(new THREE.Quaternion().setFromEuler(_e.set(rx, ry, rz)))
  c.translate(x, y, z)
  return c
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz)
const cyl = (rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => place(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rx, ry, rz)

const CHEEK_H = 0.19

/**
 * All static cannon geometry merged into one mesh per material (iron barrel + trunnions, oak carriage, brass cap
 * squares) so a gun costs 3 draw calls instead of ~30. Cached per LOD and shared by every cannon.
 */
function cannonGeometry(lod: Lod) {
  const key = `cannon${lod}`
  let g = GEOM.get(key) as THREE.BufferGeometry & { oak?: THREE.BufferGeometry; brass?: THREE.BufferGeometry | null }
  if (g) return { iron: g, oak: g.oak!, brass: g.brass ?? null }
  const radial = lod === 0 ? 18 : lod === 1 ? 10 : 6
  const pts = (lod === 2 ? BARREL_PROFILE.filter((_, i) => i % 2 === 0 || i > 20) : BARREL_PROFILE).map(([r, z]) => new THREE.Vector2(r, z))
  const barrel = new THREE.LatheGeometry(pts, radial)
  barrel.rotateX(Math.PI / 2)
  barrel.translate(0, 0.2, 0)
  const iron = mergeBuffers([barrel, cyl(0.03, 0.03, 0.26, lod === 0 ? 10 : 6, 0, 0.2, 0.02, 0, 0, Math.PI / 2)])
  const oak: THREE.BufferGeometry[] = []
  for (const s of [-1, 1]) {
    oak.push(box(0.05, CHEEK_H, 0.46, s * 0.1, 0.095, 0.06))
    oak.push(box(0.05, 0.04, 0.12, s * 0.1, 0.095 + CHEEK_H / 2 - 0.02, -0.12))
    if (lod < 2) oak.push(box(0.05, 0.06, 0.1, s * 0.1, 0.03, -0.17))
    oak.push(cyl(0.075, 0.075, 0.045, lod === 0 ? 14 : 8, s * 0.15, 0.075, 0.2, 0, 0, Math.PI / 2))
    oak.push(cyl(0.065, 0.065, 0.045, lod === 0 ? 14 : 8, s * 0.14, 0.065, -0.14, 0, 0, Math.PI / 2))
  }
  oak.push(box(0.2, 0.03, 0.46, 0, 0.06, -0.02), box(0.3, 0.05, 0.05, 0, 0.03, 0.2), box(0.28, 0.05, 0.05, 0, 0.03, -0.14))
  oak.push(box(0.07, 0.035, 0.14, 0, 0.13, -0.17, -0.22), cyl(0.012, 0.012, 0.08, 6, 0, 0.17, -0.09, 0, 0, Math.PI / 2))
  let brass: THREE.BufferGeometry | null = null
  if (lod < 2) {
    brass = mergeBuffers([
      ...[-1, 1].map((s) => place(new THREE.TorusGeometry(0.034, 0.008, 6, 12, Math.PI), s * 0.1, 0.2, 0.02, 0, 0, Math.PI / 2)),
      ...[-1, 1].map((s) => cyl(0.014, 0.014, 0.02, 6, s * 0.17, 0.075, 0.2, 0, 0, Math.PI / 2)),
      ...[-1, 1].map((s) => cyl(0.012, 0.012, 0.02, 6, s * 0.16, 0.065, -0.14, 0, 0, Math.PI / 2)),
    ])
  }
  g = Object.assign(iron, { oak: mergeBuffers(oak), brass })
  GEOM.set(key, g)
  return { iron: g, oak: g.oak!, brass }
}

const RING_L: Vec3 = [-0.26, 0.2, 0.42]
const RING_R: Vec3 = [0.26, 0.2, 0.42]
const RECOIL_STEPS = 8

/** Breeching rope for a quantised recoil (slack when run out, taut when recoiled) — cached per step. */
function breechingGeometry(lod: Lod, step: number) {
  const key = `breech${lod}:${step}`
  let g = GEOM.get(key)
  if (!g) {
    const recoil = step / RECOIL_STEPS
    const cascabel = new THREE.Vector3(0, 0.2, -0.33 - recoil * 0.32)
    const sag = 0.1 * (1 - recoil) + 0.004
    const r = lod === 0 ? 6 : 4
    g = mergeBuffers([
      ropeGeometry(ropeCurve(RING_L, cascabel.toArray() as Vec3, sag, 10), 0.016, r),
      ropeGeometry(ropeCurve(cascabel.toArray() as Vec3, RING_R, sag, 10), 0.016, r),
    ])
    GEOM.set(key, g)
  }
  return g
}
const RING_BOLTS = mergeBuffers([RING_L, RING_R].map((p) => place(new THREE.TorusGeometry(0.025, 0.006, 5, 10), p[0], p[1], p[2], 0, Math.PI / 2)))

/**
 * Naval gun on a four-truck carriage. Muzzle at local z = +0.45 (× scale) when run out; `recoil`
 * slides the whole carriage aft (−z) along the breeching rope, which goes taut.
 */
export function Cannon({ position, rotationY = 0, livery, recoil = 0, scale = 1, lod = 0 }: CannonProps) {
  const m = shipMaterials(livery)
  const geo = cannonGeometry(lod)
  const step = Math.round(Math.min(1, Math.max(0, recoil)) * RECOIL_STEPS)
  const slide = -(step / RECOIL_STEPS) * 0.32
  return (
    <group position={position} rotation-y={rotationY} scale={scale}>
      <group position-z={slide}>
        <mesh geometry={geo.iron} material={m.iron} castShadow receiveShadow />
        <mesh geometry={geo.oak} material={m.oak} castShadow receiveShadow />
        {geo.brass && <mesh geometry={geo.brass} material={m.brass} />}
      </group>
      {lod < 2 && (
        <>
          <mesh geometry={breechingGeometry(lod, step)} material={m.rope} castShadow />
          <mesh geometry={RING_BOLTS} material={m.iron} />
        </>
      )}
    </group>
  )
}

export interface SwivelGunProps {
  position: Vec3
  livery: Livery
  rotationY?: number
  /** Elevation in radians. */
  pitch?: number
  lod?: Lod
}

/** Small swivel gun on a yoke atop a rail post; barrel points along +z at `rotationY = 0`. */
export function SwivelGun({ position, livery, rotationY = 0, pitch = -0.1, lod = 0 }: SwivelGunProps) {
  const m = shipMaterials(livery)
  const radial = lod === 0 ? 12 : 6
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh material={m.oak} position-y={0.15} castShadow>
        <cylinderGeometry args={[0.03, 0.035, 0.3, 8]} />
      </mesh>
      <mesh material={m.iron} position-y={0.31}>
        <cylinderGeometry args={[0.012, 0.012, 0.06, 6]} />
      </mesh>
      <group position-y={0.36}>
        {[-1, 1].map((s) => (
          <mesh key={s} material={m.iron} position={[s * 0.045, -0.02, 0]} rotation-x={0.3}>
            <boxGeometry args={[0.012, 0.08, 0.02]} />
          </mesh>
        ))}
        <group rotation-x={pitch}>
          <mesh material={m.iron} rotation-x={Math.PI / 2} position-z={0.08} castShadow>
            <cylinderGeometry args={[0.025, 0.034, 0.44, radial]} />
          </mesh>
          <mesh material={m.iron} rotation-x={Math.PI / 2} position-z={0.29}>
            <cylinderGeometry args={[0.03, 0.026, 0.03, radial]} />
          </mesh>
          <mesh material={m.iron} rotation-x={Math.PI / 2} position-z={-0.2} castShadow>
            <cylinderGeometry args={[0.012, 0.012, 0.16, 6]} />
          </mesh>
          <mesh material={m.iron} position-z={-0.29}>
            <sphereGeometry args={[0.02, 8, 6]} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

export interface CannonballStackProps {
  position: Vec3
  livery: Livery
  /** Balls along one side of the square base (default 3 → 14 balls). */
  base?: number
  radius?: number
}

const BALL_GEOM = new THREE.SphereGeometry(1, 12, 10)
const _m4 = new THREE.Matrix4()

/** Pyramid of round shot in a wooden garland (instanced). */
export function CannonballStack({ position, livery, base = 3, radius = 0.045 }: CannonballStackProps) {
  const m = shipMaterials(livery)
  const balls = useMemo(() => {
    const out: Vec3[] = []
    for (let layer = 0; layer < base; layer++) {
      const n = base - layer
      const y = radius + layer * radius * Math.SQRT2
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) out.push([(i - (n - 1) / 2) * radius * 2, y, (j - (n - 1) / 2) * radius * 2])
    }
    return out
  }, [base, radius])
  const side = base * radius * 2 + 0.03
  return (
    <group position={position}>
      <mesh material={m.oak} position-y={0.012} receiveShadow castShadow>
        <boxGeometry args={[side, 0.024, side]} />
      </mesh>
      <instancedMesh
        args={[BALL_GEOM, m.iron, balls.length]}
        castShadow
        receiveShadow
        ref={(mesh) => {
          if (!mesh) return
          balls.forEach((b, i) => mesh.setMatrixAt(i, _m4.makeScale(radius, radius, radius).setPosition(b[0], b[1] + 0.02, b[2])))
          mesh.instanceMatrix.needsUpdate = true
        }}
      />
    </group>
  )
}
