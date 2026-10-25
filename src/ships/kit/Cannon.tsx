import { useMemo } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import type { Livery, Lod } from '../types'
import { shipMaterials } from './materials'
import { Rope } from './Rope'

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
function barrelGeometry(lod: Lod) {
  const key = `barrel${lod}`
  let g = GEOM.get(key)
  if (!g) {
    const radial = lod === 0 ? 18 : lod === 1 ? 10 : 6
    const pts = (lod === 2 ? BARREL_PROFILE.filter((_, i) => i % 2 === 0 || i > 20) : BARREL_PROFILE).map(([r, z]) => new THREE.Vector2(r, z))
    g = new THREE.LatheGeometry(pts, radial)
    g.rotateX(Math.PI / 2)
    g.scale(1, 1, -1)
    g.computeVertexNormals()
    GEOM.set(key, g)
  }
  return g
}
function truckGeometry(r: number, lod: Lod) {
  const key = `truck${r.toFixed(3)}${lod}`
  let g = GEOM.get(key)
  if (!g) {
    g = new THREE.CylinderGeometry(r, r, 0.045, lod === 0 ? 14 : 8)
    g.rotateZ(Math.PI / 2)
    GEOM.set(key, g)
  }
  return g
}

/**
 * Naval gun on a four-truck carriage. Muzzle at local z = +0.45 (× scale) when run out; `recoil`
 * slides the whole carriage aft (−z) along the breeching rope, which goes taut.
 */
export function Cannon({ position, rotationY = 0, livery, recoil = 0, scale = 1, lod = 0 }: CannonProps) {
  const m = shipMaterials(livery)
  const barrel = useMemo(() => barrelGeometry(lod), [lod])
  const slide = -recoil * 0.32
  const cheekH = 0.19
  const ringL: Vec3 = [-0.26, 0.2, 0.42]
  const ringR: Vec3 = [0.26, 0.2, 0.42]
  const cascabel: Vec3 = [0, 0.2, -0.33 + slide]
  const sag = 0.1 * (1 - recoil) + 0.004
  return (
    <group position={position} rotation-y={rotationY} scale={scale}>
      <group position-z={slide}>
        <mesh geometry={barrel} material={m.iron} position-y={0.2} castShadow receiveShadow />
        {/* trunnions + cap squares */}
        <mesh material={m.iron} position={[0, 0.2, 0.02]} rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 0.26, lod === 0 ? 10 : 6]} />
        </mesh>
        {lod < 2 &&
          [-1, 1].map((s) => (
            <mesh key={s} material={m.brass} position={[s * 0.1, 0.2, 0.02]} rotation-z={Math.PI / 2}>
              <torusGeometry args={[0.034, 0.008, 6, 12, Math.PI]} />
            </mesh>
          ))}
        {/* carriage cheeks (stepped) */}
        {[-1, 1].map((s) => (
          <group key={s} position-x={s * 0.1}>
            <mesh material={m.oak} position={[0, 0.095, 0.06]} castShadow receiveShadow>
              <boxGeometry args={[0.05, cheekH, 0.46]} />
            </mesh>
            <mesh material={m.oak} position={[0, 0.095 + cheekH / 2 - 0.02, -0.12]} castShadow>
              <boxGeometry args={[0.05, 0.04, 0.12]} />
            </mesh>
            {lod < 2 && (
              <mesh material={m.oak} position={[0, 0.03, -0.17]} castShadow>
                <boxGeometry args={[0.05, 0.06, 0.1]} />
              </mesh>
            )}
          </group>
        ))}
        {/* bed / transom / axletrees */}
        <mesh material={m.oak} position={[0, 0.06, -0.02]} receiveShadow>
          <boxGeometry args={[0.2, 0.03, 0.46]} />
        </mesh>
        <mesh material={m.oak} position={[0, 0.03, 0.2]} castShadow>
          <boxGeometry args={[0.3, 0.05, 0.05]} />
        </mesh>
        <mesh material={m.oak} position={[0, 0.03, -0.14]} castShadow>
          <boxGeometry args={[0.28, 0.05, 0.05]} />
        </mesh>
        {/* quoin + bed */}
        <mesh material={m.oak} position={[0, 0.13, -0.17]} rotation-x={-0.22} castShadow>
          <boxGeometry args={[0.07, 0.035, 0.14]} />
        </mesh>
        <mesh material={m.oak} position={[0, 0.17, -0.09]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.012, 0.012, 0.08, 6]} />
        </mesh>
        {/* trucks */}
        {[-1, 1].map((s) => (
          <group key={s}>
            <mesh geometry={truckGeometry(0.075, lod)} material={m.oak} position={[s * 0.15, 0.075, 0.2]} castShadow receiveShadow />
            <mesh geometry={truckGeometry(0.065, lod)} material={m.oak} position={[s * 0.14, 0.065, -0.14]} castShadow receiveShadow />
            {lod < 2 && (
              <>
                <mesh material={m.iron} position={[s * 0.17, 0.075, 0.2]} rotation-z={Math.PI / 2}>
                  <cylinderGeometry args={[0.014, 0.014, 0.02, 6]} />
                </mesh>
                <mesh material={m.iron} position={[s * 0.16, 0.065, -0.14]} rotation-z={Math.PI / 2}>
                  <cylinderGeometry args={[0.012, 0.012, 0.02, 6]} />
                </mesh>
              </>
            )}
          </group>
        ))}
      </group>
      {/* breeching rope: bulwark ring bolt → cascabel → ring bolt */}
      {lod < 2 && (
        <>
          <Rope from={ringL} to={cascabel} sag={sag} livery={livery} radius={0.016} lod={lod} />
          <Rope from={cascabel} to={ringR} sag={sag} livery={livery} radius={0.016} lod={lod} />
          {[ringL, ringR].map((p, i) => (
            <mesh key={i} material={m.iron} position={p} rotation-y={Math.PI / 2}>
              <torusGeometry args={[0.025, 0.006, 5, 10]} />
            </mesh>
          ))}
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
