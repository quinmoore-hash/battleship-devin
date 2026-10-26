import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BOARD_LAYOUT, type Vec3 } from '../../scene/layout'
import { sampleWaveHeight, sampleWaveNormal } from '../../scene/waves'
import { layoutGridBuoys } from './layout'
import { BakedGroup } from '../../ships/bake'

export interface GridBuoysProps {
  origin?: Vec3
  size?: number
  cellSize?: number
  /** Rope colour. */
  color?: string
  /** Lantern colour on the corner buoys. */
  lantern?: string
}

const tmpObj = new THREE.Object3D()
const tmpQ = new THREE.Quaternion()
const tmpUp = new THREE.Vector3(0, 1, 0)
const tmpN = new THREE.Vector3()

function ropeGeometry(ropes: { points: Vec3[]; outer: boolean }[], radius: number): THREE.BufferGeometry {
  const parts = ropes.map((r) => {
    const curve = new THREE.CatmullRomCurve3(r.points.map((p) => new THREE.Vector3(...p)))
    return new THREE.TubeGeometry(curve, r.points.length * 2, r.outer ? radius * 1.6 : radius, 5, false)
  })
  const merged = mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  return merged ?? new THREE.BufferGeometry()
}

/**
 * Themed board outline: a rope net strung over the water with cork floats at every intersection and
 * a big lantern buoy on each corner. Decorative; keep the scene's `BoardGrid` for picking.
 */
export function GridBuoys({ origin = BOARD_LAYOUT.enemy.origin, size = 10, cellSize = 1, color = '#a8865a', lantern = '#ffb352' }: GridBuoysProps) {
  const layout = useMemo(() => layoutGridBuoys(origin, size, cellSize, cellSize * 0.05), [origin, size, cellSize])
  const ropeGeom = useMemo(() => ropeGeometry(layout.ropes, cellSize * 0.012), [layout, cellSize])
  useEffect(() => () => ropeGeom.dispose(), [ropeGeom])
  const floats = useRef<THREE.InstancedMesh>(null)
  const ropes = useRef<THREE.Mesh>(null)
  const corners = useRef<THREE.Group>(null)
  const centre: Vec3 = [origin[0] + (size * cellSize) / 2, origin[1], origin[2] + (size * cellSize) / 2]

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const f = floats.current
    if (f) {
      layout.floats.forEach((p, i) => {
        tmpObj.position.set(p[0], p[1] + sampleWaveHeight(p[0], p[2], t), p[2])
        tmpObj.rotation.set(0, (i * 0.7) % Math.PI, 0)
        tmpObj.scale.setScalar(cellSize)
        tmpObj.updateMatrix()
        f.setMatrixAt(i, tmpObj.matrix)
      })
      f.instanceMatrix.needsUpdate = true
    }
    if (ropes.current) ropes.current.position.y = sampleWaveHeight(centre[0], centre[2], t) + 0.03 * cellSize
    const g = corners.current
    if (g) {
      g.children.forEach((c, i) => {
        const p = layout.corners[i]
        const n = sampleWaveNormal(p[0], p[2], t)
        tmpN.set(n[0], n[1], n[2])
        tmpQ.setFromUnitVectors(tmpUp, tmpN)
        c.position.y = p[1] + sampleWaveHeight(p[0], p[2], t)
        c.quaternion.copy(tmpQ)
        c.rotateY(Math.sin(t * 0.4 + i) * 0.05)
      })
    }
  })

  return (
    <group name="buoys">
      <mesh ref={ropes} geometry={ropeGeom}>
        <meshStandardMaterial color={color} roughness={1} />
      </mesh>
      <instancedMesh ref={floats} args={[undefined, undefined, layout.floats.length]} frustumCulled={false}>
        <cylinderGeometry args={[0.045, 0.05, 0.07, 8]} />
        <meshStandardMaterial color="#b58a52" roughness={0.95} />
      </instancedMesh>
      <group ref={corners}>
        {layout.corners.map((p, i) => (
          <group key={i} position={[p[0], p[1], p[2]]} scale={cellSize}>
            <BakedGroup>
            {/* barrel buoy with iron hoops, a post, and a lantern */}
            <mesh position={[0, 0.05, 0]}>
              <cylinderGeometry args={[0.2, 0.17, 0.42, 14]} />
              <meshStandardMaterial color="#6b4a2b" roughness={0.9} />
            </mesh>
            {[-0.12, 0.12].map((y) => (
              <mesh key={y} position={[0, 0.05 + y, 0]}>
                <torusGeometry args={[0.2, 0.014, 6, 20]} />
                <meshStandardMaterial color="#2a2a2d" roughness={0.5} metalness={0.7} />
              </mesh>
            ))}
            <mesh position={[0, 0.65, 0]}>
              <cylinderGeometry args={[0.028, 0.034, 0.9, 7]} />
              <meshStandardMaterial color="#3b2a18" roughness={0.9} />
            </mesh>
            {/* lantern: glowing glass inside an iron cage (4 corner bars + cap) */}
            <mesh position={[0, 1.12, 0]}>
              <boxGeometry args={[0.085, 0.13, 0.085]} />
              <meshStandardMaterial color={lantern} emissive={lantern} emissiveIntensity={2.4} toneMapped={false} />
            </mesh>
            {[-1, 1].flatMap((sx) =>
              [-1, 1].map((sz) => (
                <mesh key={`${sx}${sz}`} position={[sx * 0.05, 1.12, sz * 0.05]}>
                  <boxGeometry args={[0.016, 0.15, 0.016]} />
                  <meshStandardMaterial color="#1f1f22" roughness={0.5} metalness={0.6} />
                </mesh>
              )),
            )}
            <mesh position={[0, 1.04, 0]}>
              <boxGeometry args={[0.12, 0.02, 0.12]} />
              <meshStandardMaterial color="#1f1f22" roughness={0.5} metalness={0.6} />
            </mesh>
            <mesh position={[0, 1.21, 0]}>
              <coneGeometry args={[0.09, 0.06, 4]} />
              <meshStandardMaterial color="#1f1f22" roughness={0.5} metalness={0.6} />
            </mesh>
            </BakedGroup>
          </group>
        ))}
      </group>
    </group>
  )
}
