import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Atmosphere } from './sun'
import { sampleWaveHeight, sampleWaveNormal } from './waves'

/** Deterministic PRNG so the bay looks the same every load. */
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function jitteredRock(seed: number, detail = 1): THREE.BufferGeometry {
  const rnd = mulberry32(seed)
  const g = new THREE.DodecahedronGeometry(1, detail)
  const pos = g.attributes.position as THREE.BufferAttribute
  // dedupe-free jitter: hash on rounded position so shared vertices move together
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const h = mulberry32(Math.round(x * 97 + y * 57 + z * 31 + seed * 1000) >>> 0)()
    const s = 0.8 + h * 0.45 + rnd() * 0.001
    pos.setXYZ(i, x * s, y * s * 0.75, z * s)
  }
  g.computeVertexNormals()
  return g
}

const boardZone = (x: number, z: number) => Math.abs(x) < 8.5 && z > -16 && z < 14.5

// ---------------------------------------------------------------------------------------------
export function Rocks() {
  const rocks = useMemo(() => {
    const rnd = mulberry32(7)
    const out: { pos: [number, number, number]; scale: [number, number, number]; rot: number; seed: number }[] = []
    const clusters: [number, number, number][] = [
      [-19, -4, 4],
      [21, 9, 3],
      [-26, 14, 3],
      [16, -22, 4],
      [-14, -26, 3],
      [30, -8, 2],
    ]
    clusters.forEach(([cx, cz, n], ci) => {
      for (let i = 0; i < n; i++) {
        const x = cx + (rnd() - 0.5) * 6
        const z = cz + (rnd() - 0.5) * 6
        if (boardZone(x, z)) continue
        const s = 0.8 + rnd() * 1.8
        out.push({
          pos: [x, -0.35 + rnd() * 0.3, z],
          scale: [s * (0.8 + rnd() * 0.5), s * (0.5 + rnd() * 0.4), s * (0.8 + rnd() * 0.5)],
          rot: rnd() * Math.PI * 2,
          seed: ci * 10 + i,
        })
      }
    })
    return out
  }, [])
  const geos = useMemo(() => rocks.map((r) => jitteredRock(r.seed, r.scale[0] > 1.6 ? 1 : 0)), [rocks])
  return (
    <group>
      {rocks.map((r, i) => (
        <mesh key={i} geometry={geos[i]} position={r.pos} scale={r.scale} rotation={[0, r.rot, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={i % 3 === 0 ? '#6e6a62' : i % 3 === 1 ? '#7d7266' : '#5e5c58'} roughness={0.95} flatShading />
        </mesh>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------------------------
const KELP_COUNT = 70
export function KelpBed() {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const strands = useMemo(() => {
    const rnd = mulberry32(21)
    const beds: [number, number, number][] = [
      [-22, -10, 5.5],
      [20, 14, 4.5],
      [-30, 22, 3.5],
    ]
    const out: { x: number; z: number; h: number; phase: number; speed: number }[] = []
    let i = 0
    while (out.length < KELP_COUNT) {
      const [bx, bz, r] = beds[i++ % beds.length]
      const a = rnd() * Math.PI * 2
      const d = Math.sqrt(rnd()) * r
      const x = bx + Math.cos(a) * d
      const z = bz + Math.sin(a) * d
      if (boardZone(x, z)) continue
      out.push({ x, z, h: 2.4 + rnd() * 1.8, phase: rnd() * Math.PI * 2, speed: 0.6 + rnd() * 0.5 })
    }
    return out
  }, [])
  const geometry = useMemo(() => {
    const g = new THREE.ConeGeometry(0.16, 1, 5, 3)
    g.translate(0, 0.5, 0)
    return g
  }, [])
  const dummy = useMemo(() => new THREE.Object3D(), [])

  useFrame((state) => {
    const m = mesh.current
    if (!m) return
    const t = state.clock.elapsedTime
    strands.forEach((s, i) => {
      const sway = Math.sin(t * s.speed + s.phase) * 0.22 + Math.sin(t * s.speed * 1.7 + s.phase * 2) * 0.08
      dummy.position.set(s.x, -1.6, s.z)
      dummy.rotation.set(sway, s.phase, sway * 0.6)
      dummy.scale.set(1, s.h, 1)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  })

  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, KELP_COUNT]} castShadow>
      <meshStandardMaterial color="#3f7a2e" roughness={0.8} />
    </instancedMesh>
  )
}

// ---------------------------------------------------------------------------------------------
function Tree({ position, scale, dark }: { position: [number, number, number]; scale: number; dark: boolean }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.18, 1, 5]} />
        <meshStandardMaterial color="#4a3222" roughness={1} />
      </mesh>
      <mesh position={[0, 1.9, 0]} castShadow>
        <coneGeometry args={[0.95, 2.4, 6]} />
        <meshStandardMaterial color={dark ? '#1f4a2a' : '#2f6a36'} roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0, 2.9, 0]} castShadow>
        <coneGeometry args={[0.7, 1.9, 6]} />
        <meshStandardMaterial color={dark ? '#24573a' : '#3a7f45'} roughness={0.9} flatShading />
      </mesh>
    </group>
  )
}

export function Lighthouse({ night, position = [34, 0, -58] as [number, number, number] }: { night: number; position?: [number, number, number] }) {
  const beam = useRef<THREE.Group>(null)
  useFrame((state) => {
    if (beam.current) beam.current.rotation.y = state.clock.elapsedTime * 0.7
  })
  const lampIntensity = 0.5 + night * 6
  return (
    <group position={position}>
      {/* rocky islet */}
      <mesh position={[0, -0.6, 0]} scale={[4.5, 1.4, 4]} receiveShadow>
        <dodecahedronGeometry args={[1, 1]} />
        <meshStandardMaterial color="#6b6760" roughness={1} flatShading />
      </mesh>
      {/* tower: white with red bands */}
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[0, 1 + i * 2.2, 0]} castShadow>
          <cylinderGeometry args={[1.25 - i * 0.14, 1.4 - i * 0.14, 2.2, 14]} />
          <meshStandardMaterial color={i % 2 === 0 ? '#f3f0e8' : '#c8352f'} roughness={0.6} />
        </mesh>
      ))}
      {/* gallery */}
      <mesh position={[0, 9.9, 0]}>
        <cylinderGeometry args={[1.25, 1.1, 0.35, 14]} />
        <meshStandardMaterial color="#2b2b2b" roughness={0.7} />
      </mesh>
      {/* lantern room */}
      <mesh position={[0, 10.75, 0]}>
        <cylinderGeometry args={[0.75, 0.75, 1.4, 10]} />
        <meshStandardMaterial color="#ffe9a8" emissive="#ffcf5a" emissiveIntensity={lampIntensity} roughness={0.2} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 10.8, 0]} color="#ffd27a" intensity={night * 10} distance={28} decay={2} />
      <mesh position={[0, 11.9, 0]}>
        <coneGeometry args={[1.05, 1.1, 10]} />
        <meshStandardMaterial color="#9b2a26" roughness={0.6} />
      </mesh>
      {/* rotating light beams, only at night */}
      <group ref={beam} position={[0, 10.75, 0]}>
        {[0, Math.PI].map((a) => (
          <mesh key={a} rotation={[0, a, Math.PI / 2]} position={[Math.cos(a) * 9, 0, Math.sin(a) * 9]}>
            <coneGeometry args={[1.4, 18, 12, 1, true]} />
            <meshBasicMaterial
              color="#ffe6a0"
              transparent
              fog={false}
              opacity={0.014 * night}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>
    </group>
  )
}

export function Shoreline({ night }: { night: number }) {
  const trees = useMemo(() => {
    const rnd = mulberry32(99)
    const out: { pos: [number, number, number]; scale: number; dark: boolean }[] = []
    for (let i = 0; i < 90; i++) {
      const x = -75 + rnd() * 150
      const z = -52 - rnd() * 16 - Math.abs(x) * 0.12
      out.push({ pos: [x, 0.3 + rnd() * 0.4, z], scale: 1.4 + rnd() * 1.6, dark: rnd() > 0.5 })
    }
    // side points: a few trees on the left and right banks
    for (let i = 0; i < 14; i++) {
      const side = i % 2 === 0 ? -1 : 1
      out.push({ pos: [side * (56 + rnd() * 12), 0.2, -20 + rnd() * 50], scale: 1.2 + rnd() * 1.2, dark: rnd() > 0.4 })
    }
    return out
  }, [])
  return (
    <group>
      {/* sandy far bank */}
      <mesh position={[0, -1.9, -62]} scale={[95, 2.6, 22]} receiveShadow>
        <sphereGeometry args={[1, 32, 16]} />
        <meshStandardMaterial color="#c9b58a" roughness={1} />
      </mesh>
      {/* side banks */}
      <mesh position={[-62, -2.2, 5]} scale={[16, 2.4, 40]} receiveShadow>
        <sphereGeometry args={[1, 24, 12]} />
        <meshStandardMaterial color="#bfae86" roughness={1} />
      </mesh>
      <mesh position={[62, -2.2, 5]} scale={[16, 2.4, 40]} receiveShadow>
        <sphereGeometry args={[1, 24, 12]} />
        <meshStandardMaterial color="#bfae86" roughness={1} />
      </mesh>
      {/* rolling hills behind the trees */}
      {[
        [-40, -95, 60, 16],
        [25, -105, 75, 22],
        [80, -90, 50, 14],
        [-95, -80, 45, 12],
      ].map(([x, z, w, h], i) => (
        <mesh key={i} position={[x, -2, z]} scale={[w, h, w * 0.6]}>
          <sphereGeometry args={[1, 24, 12]} />
          <meshStandardMaterial color={i % 2 ? '#2d5a46' : '#355f4a'} roughness={1} />
        </mesh>
      ))}
      {trees.map((t, i) => (
        <Tree key={i} position={t.pos} scale={t.scale} dark={t.dark} />
      ))}
      <Lighthouse night={night} />
    </group>
  )
}

// ---------------------------------------------------------------------------------------------
interface Floater {
  x: number
  z: number
  rot: number
  kind: 'pad' | 'flower' | 'log'
  scale: number
}

export function Floaters() {
  const group = useRef<THREE.Group>(null)
  const items = useMemo<Floater[]>(() => {
    const rnd = mulberry32(5)
    const out: Floater[] = []
    const spots: [number, number][] = [
      [-13, 16],
      [-16, 19],
      [-11, 20],
      [14, 17],
      [17, 20],
      [12, 21],
      [-24, -2],
      [-27, 1],
      [25, 2],
      [27, -1],
      [-18, -22],
      [20, -20],
    ]
    spots.forEach(([x, z], i) => {
      out.push({ x: x + (rnd() - 0.5) * 2, z: z + (rnd() - 0.5) * 2, rot: rnd() * Math.PI * 2, kind: i % 4 === 1 ? 'flower' : 'pad', scale: 0.6 + rnd() * 0.6 })
    })
    const logs: [number, number][] = [
      [-21, 8],
      [24, -14],
      [8, 20],
    ]
    logs.forEach(([x, z]) => out.push({ x, z, rot: rnd() * Math.PI, kind: 'log', scale: 1 + rnd() * 0.6 }))
    return out
  }, [])
  const padGeometry = useMemo(() => {
    const g = new THREE.CircleGeometry(1, 24, 0.35, Math.PI * 2 - 0.7)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const t = state.clock.elapsedTime
    g.children.forEach((child, i) => {
      const f = items[i]
      if (!f) return
      const h = sampleWaveHeight(f.x, f.z, t)
      const n = sampleWaveNormal(f.x, f.z, t)
      child.position.y = h + (f.kind === 'log' ? 0.02 : 0.04)
      child.rotation.set(n[2] * 0.9, f.rot + (f.kind === 'log' ? Math.sin(t * 0.1) * 0.02 : 0), -n[0] * 0.9)
    })
  })

  return (
    <group ref={group}>
      {items.map((f, i) =>
        f.kind === 'log' ? (
          <group key={i} position={[f.x, 0, f.z]}>
            <mesh rotation={[0, 0, Math.PI / 2]} scale={[1, f.scale * 4, 1]} castShadow>
              <cylinderGeometry args={[0.36, 0.42, 1, 9]} />
              <meshStandardMaterial color="#6b4a2f" roughness={1} flatShading />
            </mesh>
            <mesh position={[f.scale * 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <circleGeometry args={[0.36, 9]} />
              <meshStandardMaterial color="#b89467" roughness={1} />
            </mesh>
          </group>
        ) : (
          <group key={i} position={[f.x, 0, f.z]} scale={f.scale}>
            <mesh geometry={padGeometry} receiveShadow>
              <meshStandardMaterial color="#3f8f3a" roughness={0.7} side={THREE.DoubleSide} />
            </mesh>
            {f.kind === 'flower' && (
              <group position={[0.1, 0.12, 0.05]}>
                {[0, 1, 2, 3, 4, 5].map((k) => (
                  <mesh key={k} rotation={[0.9, (k / 6) * Math.PI * 2, 0]} position={[Math.cos((k / 6) * Math.PI * 2) * 0.18, 0.05, Math.sin((k / 6) * Math.PI * 2) * 0.18]}>
                    <coneGeometry args={[0.12, 0.4, 4]} />
                    <meshStandardMaterial color="#ff9ec4" roughness={0.6} />
                  </mesh>
                ))}
                <mesh position={[0, 0.1, 0]}>
                  <sphereGeometry args={[0.1, 8, 6]} />
                  <meshStandardMaterial color="#ffd54a" emissive="#ffb300" emissiveIntensity={0.3} />
                </mesh>
              </group>
            )}
          </group>
        ),
      )}
    </group>
  )
}

// ---------------------------------------------------------------------------------------------
export function Birds({ count = 6 }: { count?: number }) {
  const group = useRef<THREE.Group>(null)
  const birds = useMemo(() => {
    const rnd = mulberry32(3)
    return Array.from({ length: count }, (_, i) => ({
      offset: i * 1.3 + rnd() * 0.4,
      height: 16 + rnd() * 8,
      radius: 50 + rnd() * 20,
      flap: 5 + rnd() * 3,
      phase: rnd() * Math.PI * 2,
    }))
  }, [count])
  useFrame((state) => {
    const g = group.current
    if (!g) return
    const t = state.clock.elapsedTime
    g.children.forEach((bird, i) => {
      const b = birds[i]
      const a = t * 0.07 + b.offset
      bird.position.set(Math.cos(a) * b.radius, b.height + Math.sin(t * 0.5 + b.phase) * 1.2, -20 + Math.sin(a) * b.radius * 0.6)
      bird.rotation.y = -a + Math.PI / 2
      const wing = Math.sin(t * b.flap + b.phase) * 0.7
      bird.children[0].rotation.z = wing
      bird.children[1].rotation.z = -wing
    })
  })
  return (
    <group ref={group}>
      {birds.map((_, i) => (
        <group key={i}>
          <mesh position={[0, 0, 0]}>
            <planeGeometry args={[1.6, 0.35]} />
            <meshBasicMaterial color="#1a2430" side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 0, 0]}>
            <planeGeometry args={[1.6, 0.35]} />
            <meshBasicMaterial color="#1a2430" side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

export function Dragonflies({ count = 4 }: { count?: number }) {
  const group = useRef<THREE.Group>(null)
  const flies = useMemo(() => {
    const rnd = mulberry32(11)
    const homes: [number, number][] = [
      [-21, -9],
      [19, 13],
      [-14, 18],
      [23, -3],
    ]
    return Array.from({ length: count }, (_, i) => ({
      home: homes[i % homes.length],
      phase: rnd() * 100,
      speed: 0.6 + rnd() * 0.5,
    }))
  }, [count])
  useFrame((state) => {
    const g = group.current
    if (!g) return
    const t = state.clock.elapsedTime
    g.children.forEach((fly, i) => {
      const f = flies[i]
      const x = f.home[0] + Math.sin(t * f.speed + f.phase) * 2.5 + Math.sin(t * 2.3 + f.phase) * 0.3
      const z = f.home[1] + Math.cos(t * f.speed * 0.8 + f.phase) * 2.5
      const y = 1.4 + Math.sin(t * 1.7 + f.phase) * 0.35
      const px = fly.position.x
      const pz = fly.position.z
      fly.position.set(x, y, z)
      fly.rotation.y = Math.atan2(x - px, z - pz)
      const w = Math.sin(t * 40 + f.phase) * 0.6
      fly.children[1].rotation.z = w
      fly.children[2].rotation.z = -w
    })
  })
  return (
    <group ref={group}>
      {flies.map((_, i) => (
        <group key={i}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <capsuleGeometry args={[0.035, 0.7, 3, 6]} />
            <meshStandardMaterial color="#2bb3c9" emissive="#1c7f93" emissiveIntensity={0.4} />
          </mesh>
          <mesh position={[0.3, 0.02, 0.1]}>
            <planeGeometry args={[0.6, 0.16]} />
            <meshBasicMaterial color="#dff8ff" transparent opacity={0.45} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <mesh position={[-0.3, 0.02, 0.1]}>
            <planeGeometry args={[0.6, 0.16]} />
            <meshBasicMaterial color="#dff8ff" transparent opacity={0.45} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** All the dressing in one place so the scene can toggle it by quality. */
export function BayDressing({ atmosphere, quality }: { atmosphere: Atmosphere; quality: 'low' | 'high' }) {
  const night = 1 - atmosphere.daylight
  return (
    <group>
      <Shoreline night={night} />
      <Rocks />
      <KelpBed />
      <Floaters />
      <Birds count={quality === 'high' ? 7 : 4} />
      {quality === 'high' && <Dragonflies />}
    </group>
  )
}
