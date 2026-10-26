import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { seededRandom } from '../vfx/random'
import { CoveDressing } from './Islands'
import type { Atmosphere } from './sun'
import { sampleWaveHeight, sampleWaveNormal } from './waves'
import { Dolphins, Gulls } from './Weather'
import { BakedGroup } from '../ships/bake'

type Quality = 'low' | 'high'

interface Floater {
  x: number
  z: number
  rot: number
  kind: 'buoy' | 'barrel' | 'plank'
  scale: number
}

/** Channel buoys, lost barrels and driftwood riding the swell around the board zone. */
export function Floaters({ night }: { night: number }) {
  const group = useRef<THREE.Group>(null)
  const items = useMemo<Floater[]>(() => {
    const rnd = seededRandom(5)
    const out: Floater[] = []
    const buoys: [number, number][] = [
      [-14, 18],
      [14, 18],
      [-14, -24],
      [14, -24],
      [-24, -4],
      [24, -4],
    ]
    buoys.forEach(([x, z]) => out.push({ x, z, rot: rnd() * Math.PI * 2, kind: 'buoy', scale: 1 }))
    const junk: [number, number][] = [
      [-19, 10],
      [21, -14],
      [8, 22],
      [-26, -30],
      [27, 14],
    ]
    junk.forEach(([x, z], i) => out.push({ x: x + (rnd() - 0.5) * 2, z: z + (rnd() - 0.5) * 2, rot: rnd() * Math.PI, kind: i % 2 ? 'barrel' : 'plank', scale: 0.8 + rnd() * 0.4 }))
    return out
  }, [])
  const normal = useMemo(() => new THREE.Vector3(), [])
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const q = useMemo(() => new THREE.Quaternion(), [])
  const spin = useMemo(() => new THREE.Quaternion(), [])
  useFrame((state) => {
    const g = group.current
    if (!g) return
    const t = state.clock.elapsedTime
    g.children.forEach((m, i) => {
      const f = items[i]
      const [nx, ny, nz] = sampleWaveNormal(f.x, f.z, t)
      normal.set(nx, ny, nz)
      q.setFromUnitVectors(up, normal)
      spin.setFromAxisAngle(up, f.rot + Math.sin(t * 0.3 + i) * 0.1)
      m.quaternion.copy(q).multiply(spin)
      m.position.set(f.x, sampleWaveHeight(f.x, f.z, t) + 0.05, f.z)
    })
  })
  return (
    <group ref={group}>
      {items.map((f, i) => (
        <group key={i} scale={f.scale}>
          <BakedGroup>
          {f.kind === 'buoy' && (
            <>
              <mesh position={[0, 0.25, 0]}>
                <cylinderGeometry args={[0.45, 0.55, 0.6, 10]} />
                <meshStandardMaterial color="#c8352f" roughness={0.6} />
              </mesh>
              <mesh position={[0, 0.8, 0]}>
                <cylinderGeometry args={[0.06, 0.08, 0.9, 6]} />
                <meshStandardMaterial color="#2b2b2b" metalness={0.6} roughness={0.5} />
              </mesh>
              <mesh position={[0, 1.3, 0]}>
                <sphereGeometry args={[0.14, 8, 6]} />
                <meshStandardMaterial color="#ffd27a" emissive="#ffb347" emissiveIntensity={night * 3} toneMapped={false} />
              </mesh>
            </>
          )}
          {f.kind === 'barrel' && (
            <mesh rotation={[0, 0, Math.PI / 2]} position={[0, -0.1, 0]}>
              <cylinderGeometry args={[0.36, 0.36, 0.9, 10]} />
              <meshStandardMaterial color="#6a4e30" roughness={0.9} />
            </mesh>
          )}
          {f.kind === 'plank' && (
            <mesh position={[0, -0.05, 0]}>
              <boxGeometry args={[2.4, 0.1, 0.4]} />
              <meshStandardMaterial color="#7a6244" roughness={1} />
            </mesh>
          )}
          </BakedGroup>
        </group>
      ))}
    </group>
  )
}

/** Every piece of cove dressing: islands + landmarks, floaters, gulls and dolphins. */
export function BayDressing({ atmosphere, quality }: { atmosphere: Atmosphere; quality: Quality }) {
  const night = 1 - atmosphere.daylight
  return (
    <group name="dressing">
      <BakedGroup>
        <CoveDressing night={night} quality={quality} />
      </BakedGroup>
      <Floaters night={night} />
      <Gulls count={quality === 'high' ? 8 : 4} storm={atmosphere.storm} />
      {quality === 'high' && <Dolphins storm={atmosphere.storm} />}
    </group>
  )
}
