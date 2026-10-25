import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Barrel, Cannon, Crate, loftHull } from '../ships/kit'
import { seededRandom } from '../vfx/random'
import { ISLANDS, LANDMARKS, scatterOnLand, terrainHeight, terrainNormal, type Island, type ScatterPoint } from './cove'
import type { Vec3 } from './layout'
import { frondTexture, groundTexture, jollyRogerTexture, plankTexture, signTexture, stoneTexture, tornSailTexture } from './textures'
import { sampleWaveHeight } from './waves'

type Quality = 'low' | 'high'

/** One shared clock uniform for every swaying/waving material. */
const timeUniform = { value: 0 }
export function useSceneClock() {
  useFrame((state) => {
    timeUniform.value = state.clock.elapsedTime
  })
}

/** Adds a wind sway to a standard material: vertices move with height, phase from world position. */
function windSway<T extends THREE.Material>(mat: T, strength: number, key: string): T {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 swayOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #else
          vec3 swayOrigin = vec3(0.0);
        #endif
        float swayPhase = swayOrigin.x * 0.7 + swayOrigin.z * 0.5;
        float swayH = max(0.0, position.y) * ${strength.toFixed(3)};
        float sw = sin(uTime * 1.3 + swayPhase) + 0.5 * sin(uTime * 2.9 + swayPhase * 1.7);
        transformed.x += sw * 0.06 * swayH;
        transformed.z += cos(uTime * 1.1 + swayPhase) * 0.04 * swayH;`,
      )
  }
  mat.customProgramCacheKey = () => `sway-${key}-${strength}`
  return mat
}

// ---------------------------------------------------------------------------------------------
function islandTerrainGeometry(isl: Island, segments: number): THREE.BufferGeometry {
  const w = isl.rx * 2.6
  const d = isl.rz * 2.6
  const g = new THREE.PlaneGeometry(w, d, segments, Math.round((segments * d) / w))
  g.rotateX(-Math.PI / 2)
  const pos = g.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(pos.count * 3)
  const sand = new THREE.Color('#dcc89c')
  const wetSand = new THREE.Color('#b3a079')
  const grass = new THREE.Color('#3e7f3a')
  const grassDry = new THREE.Color('#7d9a46')
  const rock = new THREE.Color('#6b665e')
  const c = new THREE.Color()
  const rnd = seededRandom(isl.seed)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + isl.cx
    const z = pos.getZ(i) + isl.cz
    const h = terrainHeight(x, z)
    pos.setXYZ(i, x, h, z)
    const n = terrainNormal(x, z)
    const slope = 1 - n[1]
    const grassMix = THREE.MathUtils.smoothstep(h, 0.6, 1.8)
    c.copy(h < 0.1 ? wetSand : sand).lerp(grass, grassMix)
    c.lerp(grassDry, grassMix * (0.5 + 0.5 * Math.sin(x * 0.4 + z * 0.3)) * 0.5)
    const rockMix = THREE.MathUtils.smoothstep(slope, 0.18, 0.4) + THREE.MathUtils.smoothstep(h, isl.peak * 0.72, isl.peak * 0.95) * 0.7
    c.lerp(rock, Math.min(1, rockMix))
    const tint = 0.92 + rnd() * 0.16
    colors[i * 3] = c.r * tint
    colors[i * 3 + 1] = c.g * tint
    colors[i * 3 + 2] = c.b * tint
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  g.computeVertexNormals()
  // tile the grain in world units
  const uv = g.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / 6, pos.getZ(i) / 6)
  return g
}

export function IslandTerrain({ quality }: { quality: Quality }) {
  const geos = useMemo(
    () =>
      ISLANDS.filter((i) => i.peak > 0 || i.id === 'reef').map((isl) => ({
        isl,
        geo: islandTerrainGeometry(isl, Math.min(quality === 'high' ? 96 : 56, Math.round(isl.rx * (quality === 'high' ? 3.4 : 2)))),
      })),
    [quality],
  )
  useEffect(() => () => geos.forEach((g) => g.geo.dispose()), [geos])
  const map = useMemo(() => groundTexture(), [])
  return (
    <group>
      {geos.map(({ isl, geo }) => (
        <mesh key={isl.id} geometry={geo} receiveShadow castShadow={isl.peak > 3}>
          <meshStandardMaterial vertexColors map={map} roughness={1} metalness={0} />
        </mesh>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------------------------
function trunkGeometry(seed: number): THREE.BufferGeometry {
  const rnd = seededRandom(seed)
  const lean = 0.5 + rnd() * 0.9
  const dir = rnd() * Math.PI * 2
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(Math.cos(dir) * lean * 0.4, 2.4, Math.sin(dir) * lean * 0.4),
    new THREE.Vector3(Math.cos(dir) * lean, 4.6, Math.sin(dir) * lean),
  )
  const g = new THREE.TubeGeometry(curve, 10, 0.16, 7, false)
  // taper toward the crown and add ring ridges
  const pos = g.attributes.position as THREE.BufferAttribute
  const pts = curve.getPoints(10)
  for (let i = 0; i < pos.count; i++) {
    const seg = Math.floor(i / 8)
    const t = seg / 10
    const centre = pts[Math.min(seg, 10)]
    const scale = (1.15 - t * 0.5) * (1 + 0.08 * ((seg % 2) * 2 - 1))
    pos.setXYZ(i, centre.x + (pos.getX(i) - centre.x) * scale, pos.getY(i), centre.z + (pos.getZ(i) - centre.z) * scale)
  }
  g.computeVertexNormals()
  return g
}

function crownGeometry(seed: number): THREE.BufferGeometry {
  const rnd = seededRandom(seed)
  const fronds: THREE.BufferGeometry[] = []
  const n = 9
  for (let i = 0; i < n; i++) {
    const f = new THREE.PlaneGeometry(0.9, 2.8, 1, 6)
    const pos = f.attributes.position as THREE.BufferAttribute
    const droop = 0.6 + rnd() * 0.5
    for (let v = 0; v < pos.count; v++) {
      const t = (pos.getY(v) + 1.4) / 2.8 // 0 at base, 1 at tip
      pos.setXYZ(v, pos.getX(v), 1.4 * t - droop * t * t * 2.2, -1.4 * t * 2.2 - 0.2)
    }
    f.rotateX(-0.25 - rnd() * 0.3)
    f.rotateY((i / n) * Math.PI * 2 + rnd() * 0.3)
    fronds.push(f)
  }
  const merged = mergeGeometries(fronds)!
  fronds.forEach((f) => f.dispose())
  return merged
}

export function Palms({ quality }: { quality: Quality }) {
  const points = useMemo(
    () => scatterOnLand({ seed: 101, count: quality === 'high' ? 64 : 34, minHeight: 0.45, maxHeight: 5.5, maxSlope: 0.65, spacing: 2.4, landmarkClearance: 7 }),
    [quality],
  )
  const variants = 3
  const trunks = useMemo(() => Array.from({ length: variants }, (_, i) => trunkGeometry(500 + i)), [])
  const crowns = useMemo(() => Array.from({ length: variants }, (_, i) => crownGeometry(600 + i)), [])
  const crownMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 })
    return windSway(m, 1.6, 'frond')
  }, [])
  const trunkMat = useMemo(() => windSway(new THREE.MeshStandardMaterial({ color: '#8a7355', roughness: 1 }), 0.45, 'trunk'), [])
  const nutGeo = useMemo(() => new THREE.SphereGeometry(0.11, 7, 5), [])
  const nutMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6b5a2e', roughness: 0.9 }), [])
  const groups = useMemo(() => {
    const g: ScatterPoint[][] = Array.from({ length: variants }, () => [])
    points.forEach((p, i) => g[i % variants].push(p))
    return g
  }, [points])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const refs = useRef<(THREE.InstancedMesh | null)[]>([])
  const nutRef = useRef<THREE.InstancedMesh>(null)

  useEffect(() => {
    const curveTops = trunks.map((t) => {
      t.computeBoundingBox()
      return t.boundingBox!
    })
    groups.forEach((pts, v) => {
      const trunk = refs.current[v * 2]
      const crown = refs.current[v * 2 + 1]
      if (!trunk || !crown) return
      pts.forEach((p, i) => {
        dummy.position.set(p.position[0], p.position[1] - 0.15, p.position[2])
        dummy.rotation.set(0, p.rotation, 0)
        dummy.scale.setScalar(p.scale)
        dummy.updateMatrix()
        trunk.setMatrixAt(i, dummy.matrix)
        // crown sits at the tube's top end
        const bb = curveTops[v]
        const top = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y, (bb.min.z + bb.max.z) / 2)
        top.set(topX(trunks[v]), bb.max.y - 0.1, topZ(trunks[v])).applyMatrix4(dummy.matrix)
        dummy.position.copy(top)
        dummy.updateMatrix()
        crown.setMatrixAt(i, dummy.matrix)
      })
      trunk.count = pts.length
      crown.count = pts.length
      trunk.instanceMatrix.needsUpdate = true
      crown.instanceMatrix.needsUpdate = true
    })
    const nuts = nutRef.current
    if (nuts) {
      let k = 0
      groups.forEach((pts, v) => {
        pts.forEach((p) => {
          dummy.position.set(p.position[0], p.position[1] - 0.15, p.position[2])
          dummy.rotation.set(0, p.rotation, 0)
          dummy.scale.setScalar(p.scale)
          dummy.updateMatrix()
          const m = dummy.matrix.clone()
          for (let j = 0; j < 3; j++) {
            const a = (j / 3) * Math.PI * 2
            dummy.position.set(topX(trunks[v]) + Math.cos(a) * 0.2, 4.35, topZ(trunks[v]) + Math.sin(a) * 0.2).applyMatrix4(m)
            dummy.scale.setScalar(p.scale)
            dummy.updateMatrix()
            nuts.setMatrixAt(k++, dummy.matrix)
          }
        })
      })
      nuts.count = k
      nuts.instanceMatrix.needsUpdate = true
    }
  }, [groups, trunks, dummy])

  const max = Math.ceil(points.length / variants) + 1
  return (
    <group>
      {groups.map((_, v) => (
        <group key={v}>
          <instancedMesh ref={(el) => void (refs.current[v * 2] = el)} args={[trunks[v], trunkMat, max]} castShadow receiveShadow frustumCulled={false} />
          <instancedMesh ref={(el) => void (refs.current[v * 2 + 1] = el)} args={[crowns[v], crownMat, max]} castShadow frustumCulled={false} />
        </group>
      ))}
      <instancedMesh ref={nutRef} args={[nutGeo, nutMat, points.length * 3 + 3]} frustumCulled={false} />
    </group>
  )
}
// top-of-trunk helpers: the tube's last ring centre
function topX(g: THREE.BufferGeometry) {
  const p = g.attributes.position as THREE.BufferAttribute
  let s = 0
  for (let i = p.count - 8; i < p.count; i++) s += p.getX(i)
  return s / 8
}
function topZ(g: THREE.BufferGeometry) {
  const p = g.attributes.position as THREE.BufferAttribute
  let s = 0
  for (let i = p.count - 8; i < p.count; i++) s += p.getZ(i)
  return s / 8
}

// ---------------------------------------------------------------------------------------------
function jitteredRock(seed: number, detail = 1): THREE.BufferGeometry {
  const g = new THREE.DodecahedronGeometry(1, detail)
  const pos = g.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const h = seededRandom(Math.round(x * 97 + y * 57 + z * 31 + seed * 1000) >>> 0)()
    const s = 0.8 + h * 0.45
    pos.setXYZ(i, x * s, y * s * 0.7, z * s)
  }
  g.computeVertexNormals()
  return g
}

function InstancedScatter({
  points,
  geometry,
  material,
  yOffset = 0,
  scale = 1,
  flatten = 1,
  castShadow = true,
}: {
  points: ScatterPoint[]
  geometry: THREE.BufferGeometry
  material: THREE.Material
  yOffset?: number
  scale?: number
  flatten?: number
  castShadow?: boolean
}) {
  const ref = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  useEffect(() => {
    const m = ref.current
    if (!m) return
    points.forEach((p, i) => {
      dummy.position.set(p.position[0], p.position[1] + yOffset * p.scale * scale, p.position[2])
      dummy.rotation.set(0, p.rotation, 0)
      dummy.scale.set(p.scale * scale, p.scale * scale * flatten, p.scale * scale)
      dummy.updateMatrix()
      m.setMatrixAt(i, dummy.matrix)
    })
    m.count = points.length
    m.instanceMatrix.needsUpdate = true
  }, [points, dummy, yOffset, scale, flatten])
  return <instancedMesh ref={ref} args={[geometry, material, Math.max(1, points.length)]} castShadow={castShadow} receiveShadow frustumCulled={false} />
}

export function Rocks({ quality }: { quality: Quality }) {
  const shore = useMemo(() => scatterOnLand({ seed: 201, count: quality === 'high' ? 48 : 24, minHeight: -0.7, maxHeight: 0.9, spacing: 2, landmarkClearance: 5 }), [quality])
  const cliffs = useMemo(() => scatterOnLand({ seed: 202, count: quality === 'high' ? 30 : 14, minHeight: 2.5, maxHeight: 12, spacing: 3, landmarkClearance: 6 }), [quality])
  const geoA = useMemo(() => jitteredRock(1, 1), [])
  const geoB = useMemo(() => jitteredRock(2, 0), [])
  const matA = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6e6a62', roughness: 0.95, flatShading: true }), [])
  const matB = useMemo(() => new THREE.MeshStandardMaterial({ color: '#57534e', roughness: 1, flatShading: true }), [])
  return (
    <group>
      <InstancedScatter points={shore} geometry={geoA} material={matA} scale={1.1} flatten={0.7} yOffset={-0.2} />
      <InstancedScatter points={cliffs} geometry={geoB} material={matB} scale={1.6} flatten={0.9} yOffset={-0.3} />
    </group>
  )
}

export function Foliage({ quality }: { quality: Quality }) {
  const bushes = useMemo(() => scatterOnLand({ seed: 301, count: quality === 'high' ? 110 : 50, minHeight: 0.7, maxHeight: 6.5, maxSlope: 0.8, spacing: 1.3, landmarkClearance: 5 }), [quality])
  const ferns = useMemo(() => scatterOnLand({ seed: 302, count: quality === 'high' ? 60 : 24, minHeight: 0.8, maxHeight: 4.5, maxSlope: 0.7, spacing: 1.6, landmarkClearance: 5 }), [quality])
  const bushGeo = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(0.7, 1)
    const pos = g.attributes.position as THREE.BufferAttribute
    const rnd = seededRandom(77)
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (0.85 + rnd() * 0.3), Math.max(0.05, pos.getY(i) * 0.7 + 0.3), pos.getZ(i) * (0.85 + rnd() * 0.3))
    g.computeVertexNormals()
    return g
  }, [])
  const fernGeo = useMemo(() => crownGeometry(700), [])
  const bushMat = useMemo(() => windSway(new THREE.MeshStandardMaterial({ color: '#2f6e34', roughness: 0.9, flatShading: true }), 0.8, 'bush'), [])
  const fernMat = useMemo(() => windSway(new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, color: '#9fd27a' }), 1.2, 'fern'), [])
  return (
    <group>
      <InstancedScatter points={bushes} geometry={bushGeo} material={bushMat} />
      <InstancedScatter points={ferns} geometry={fernGeo} material={fernMat} scale={0.4} yOffset={0.5} castShadow={false} />
    </group>
  )
}

// ---------------------------------------------------------------------------------------------
const groundY = (x: number, z: number) => terrainHeight(x, z)

function WavingFlag({ texture, position, width = 2.2, height = 1.4 }: { texture: THREE.Texture; position: Vec3; width?: number; height?: number }) {
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide, roughness: 0.9 })
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = timeUniform
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float fx = uv.x;
          transformed.z += sin(fx * 6.0 - uTime * 5.0) * 0.12 * fx + sin(fx * 11.0 - uTime * 7.3) * 0.04 * fx;
          transformed.y += sin(fx * 4.0 - uTime * 3.1) * 0.05 * fx;`,
        )
    }
    m.customProgramCacheKey = () => 'flag'
    return m
  }, [texture])
  return (
    <mesh position={[position[0] + width / 2, position[1], position[2]]} material={mat} castShadow>
      <planeGeometry args={[width, height, 12, 6]} />
    </mesh>
  )
}

export function Fort({ night }: { night: number }) {
  const { x, z, rotationY } = LANDMARKS.fort
  const y = groundY(x, z)
  const stone = useMemo(() => {
    const t = stoneTexture()
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, color: '#cfc6b4' })
  }, [])
  const merlonGeo = useMemo(() => new THREE.BoxGeometry(0.7, 0.6, 0.7), [])
  const merlons = useMemo(() => {
    const out: Vec3[] = []
    const w = 7
    const d = 5.5
    for (let i = -w; i <= w; i += 1.4) out.push([i, 0, -d], [i, 0, d])
    for (let j = -d + 1.4; j <= d - 1.4; j += 1.4) out.push([-w, 0, j], [w, 0, j])
    return out
  }, [])
  const merlonRef = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const m = merlonRef.current
    if (!m) return
    const d = new THREE.Object3D()
    merlons.forEach((p, i) => {
      d.position.set(p[0], 3.6, p[2])
      d.updateMatrix()
      m.setMatrixAt(i, d.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  }, [merlons])
  const flag = useMemo(() => jollyRogerTexture(), [])
  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]}>
      {/* raised stone platform & curtain walls */}
      <mesh material={stone} position={[0, 0.4, 0]} receiveShadow castShadow>
        <boxGeometry args={[16, 1.6, 13]} />
      </mesh>
      {[
        [0, -5.5, 15, 0.9],
        [0, 5.5, 15, 0.9],
        [-7.2, 0, 0.9, 11],
        [7.2, 0, 0.9, 11],
      ].map(([px, pz, w, d], i) => (
        <mesh key={i} material={stone} position={[px, 2.2, pz]} castShadow receiveShadow>
          <boxGeometry args={[w, 2.6, d]} />
        </mesh>
      ))}
      <instancedMesh ref={merlonRef} args={[merlonGeo, stone, merlons.length]} castShadow />
      {/* round corner towers with slate roofs */}
      {[
        [-7.2, -5.5],
        [7.2, -5.5],
        [7.2, 5.5],
        [-7.2, 5.5],
      ].map(([px, pz], i) => (
        <group key={i} position={[px, 0, pz]}>
          <mesh material={stone} position={[0, 2.8, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[1.7, 1.9, 5.2, 12]} />
          </mesh>
          <mesh position={[0, 6.1, 0]} castShadow>
            <coneGeometry args={[2.1, 1.6, 12]} />
            <meshStandardMaterial color="#4a4e58" roughness={0.8} />
          </mesh>
          {/* arrow slit */}
          <mesh position={[0, 3, 1.9]}>
            <boxGeometry args={[0.14, 0.7, 0.1]} />
            <meshStandardMaterial color="#15110e" />
          </mesh>
        </group>
      ))}
      {/* keep + gate */}
      <mesh material={stone} position={[0, 3.2, 0.5]} castShadow receiveShadow>
        <boxGeometry args={[5, 4, 4]} />
      </mesh>
      <mesh position={[0, 1.9, 5.96]}>
        <boxGeometry args={[1.6, 2.2, 0.1]} />
        <meshStandardMaterial color="#1a1310" />
      </mesh>
      {/* cannons on the seaward wall */}
      {[-4.5, -1.5, 1.5, 4.5].map((px) => (
        <Cannon key={px} position={[px, 3.4, -5.1]} rotationY={Math.PI} livery="navy" scale={2.1} />
      ))}
      {/* flagpole with the Jolly Roger, lantern-lit after dark */}
      <mesh position={[0, 7.8, 0.5]} castShadow>
        <cylinderGeometry args={[0.05, 0.07, 5.2, 6]} />
        <meshStandardMaterial color="#3a2a1a" />
      </mesh>
      <WavingFlag texture={flag} position={[0.05, 9.6, 0.5]} />
      <mesh position={[0, 5.6, 2.6]}>
        <sphereGeometry args={[0.16, 8, 6]} />
        <meshStandardMaterial color="#ffd27a" emissive="#ffb347" emissiveIntensity={night * 3} toneMapped={false} />
      </mesh>
      {night > 0.05 && <pointLight position={[0, 6.5, 2.4]} color="#ffb347" intensity={night * 20} distance={16} decay={2} />}
    </group>
  )
}

export function Lighthouse({ night }: { night: number }) {
  const { x, z } = LANDMARKS.lighthouse
  const y = groundY(x, z)
  const beam = useRef<THREE.Group>(null)
  useFrame((state) => {
    if (beam.current) beam.current.rotation.y = state.clock.elapsedTime * 0.7
  })
  const stone = useMemo(() => new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.95, color: '#d8d2c4' }), [])
  const lampIntensity = 0.5 + night * 6
  return (
    <group position={[x, y, z]}>
      <mesh material={stone} position={[0, 0.6, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[2.6, 3.1, 1.4, 8]} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} position={[0, 2.4 + i * 2.2, 0]} castShadow>
          <cylinderGeometry args={[1.25 - i * 0.14, 1.4 - i * 0.14, 2.2, 14]} />
          <meshStandardMaterial color={i % 2 === 0 ? '#f3f0e8' : '#c8352f'} roughness={0.6} />
        </mesh>
      ))}
      {/* gallery with railing posts */}
      <mesh position={[0, 11.3, 0]} castShadow>
        <cylinderGeometry args={[1.45, 1.1, 0.35, 14]} />
        <meshStandardMaterial color="#2b2b2b" roughness={0.7} />
      </mesh>
      {Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2
        return (
          <mesh key={i} position={[Math.cos(a) * 1.35, 11.85, Math.sin(a) * 1.35]}>
            <cylinderGeometry args={[0.03, 0.03, 0.8, 5]} />
            <meshStandardMaterial color="#2b2b2b" />
          </mesh>
        )
      })}
      <mesh position={[0, 12.25, 0]}>
        <torusGeometry args={[1.35, 0.03, 5, 20]} />
        <meshStandardMaterial color="#2b2b2b" />
      </mesh>
      {/* lantern room: brass frame, glass panes, lamp */}
      <mesh position={[0, 12.2, 0]}>
        <cylinderGeometry args={[0.55, 0.55, 1.4, 8]} />
        <meshStandardMaterial color="#ffe9a8" emissive="#ffcf5a" emissiveIntensity={lampIntensity} roughness={0.2} toneMapped={false} />
      </mesh>
      <mesh position={[0, 12.2, 0]}>
        <cylinderGeometry args={[0.85, 0.85, 1.5, 8, 1, true]} />
        <meshPhysicalMaterial color="#dff4ff" transparent opacity={0.3} roughness={0.05} metalness={0} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2
        return (
          <mesh key={i} position={[Math.cos(a) * 0.85, 12.2, Math.sin(a) * 0.85]}>
            <boxGeometry args={[0.07, 1.5, 0.07]} />
            <meshStandardMaterial color="#b08a3e" metalness={0.8} roughness={0.35} />
          </mesh>
        )
      })}
      <pointLight position={[0, 12.3, 0]} color="#ffd27a" intensity={night * 12} distance={30} decay={2} />
      <mesh position={[0, 13.4, 0]} castShadow>
        <coneGeometry args={[1.15, 1.0, 10]} />
        <meshStandardMaterial color="#9b2a26" roughness={0.6} />
      </mesh>
      <group ref={beam} position={[0, 12.2, 0]}>
        {[0, Math.PI].map((a) => (
          <mesh key={a} rotation={[0, a, Math.PI / 2]} position={[Math.cos(a) * 13, 0, Math.sin(a) * 13]}>
            <coneGeometry args={[1.6, 26, 12, 1, true]} />
            <meshBasicMaterial color="#ffe6a0" transparent fog={false} opacity={0.006 * night} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

export function Dock({ night }: { night: number }) {
  const { x, z, rotationY } = LANDMARKS.dock
  const planks = useMemo(() => new THREE.MeshStandardMaterial({ map: plankTexture(), roughness: 0.9 }), [])
  const pile = useMemo(() => new THREE.MeshStandardMaterial({ color: '#4a3a28', roughness: 1 }), [])
  const pileGeo = useMemo(() => new THREE.CylinderGeometry(0.16, 0.2, 5, 7), [])
  const piles = useMemo(() => {
    const out: Vec3[] = []
    for (let i = -6; i <= 6; i += 2.4) out.push([i, 0, -1.1], [i, 0, 1.1])
    return out
  }, [])
  const pileRef = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    const m = pileRef.current
    if (!m) return
    const d = new THREE.Object3D()
    piles.forEach((p, i) => {
      d.position.set(p[0], -1.5, p[2])
      d.rotation.set(0, 0, (i % 2 ? 1 : -1) * 0.03)
      d.updateMatrix()
      m.setMatrixAt(i, d.matrix)
    })
    m.instanceMatrix.needsUpdate = true
  }, [piles])
  const t = planks.map!
  t.repeat.set(4, 1)
  return (
    <group position={[x, 0.2, z]} rotation={[0, rotationY, 0]}>
      <mesh material={planks} position={[0, 0.85, 0]} castShadow receiveShadow>
        <boxGeometry args={[13, 0.18, 2.6]} />
      </mesh>
      <instancedMesh ref={pileRef} args={[pileGeo, pile, piles.length]} castShadow />
      {/* lantern posts at the sea end */}
      {[-1.1, 1.1].map((pz) => (
        <group key={pz} position={[-6.2, 0.95, pz]}>
          <mesh position={[0, 1.1, 0]} castShadow>
            <boxGeometry args={[0.14, 2.2, 0.14]} />
            <meshStandardMaterial color="#3a2a1a" />
          </mesh>
          <mesh position={[0, 2.1, 0]}>
            <boxGeometry args={[0.28, 0.36, 0.28]} />
            <meshStandardMaterial color="#ffd27a" emissive="#ffb347" emissiveIntensity={0.3 + night * 3} toneMapped={false} />
          </mesh>
        </group>
      ))}
      {night > 0.05 && <pointLight position={[-6.2, 3.3, 0]} color="#ffb347" intensity={night * 14} distance={14} decay={2} />}
      <Barrel position={[3, 0.95, -0.8]} livery="navy" scale={1.6} />
      <Barrel position={[3.5, 0.95, -0.4]} livery="navy" scale={1.5} />
      <Crate position={[4.6, 1.2, 0.6]} livery="navy" size={0.55} />
      <Crate position={[1.8, 1.1, 0.8]} livery="navy" size={0.4} />
    </group>
  )
}

export function Tavern({ night }: { night: number }) {
  const { x, z, rotationY } = LANDMARKS.tavern
  const y = groundY(x, z)
  const planks = useMemo(() => new THREE.MeshStandardMaterial({ map: plankTexture('tavern-plank', [110, 78, 48]), roughness: 0.95 }), [])
  const roof = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5a3b2a', roughness: 1 }), [])
  const roofGeo = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(-3.6, 0)
    s.lineTo(0, 2.2)
    s.lineTo(3.6, 0)
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: 6.4, bevelEnabled: false })
    g.translate(0, 0, -3.2)
    return g
  }, [])
  const sign = useMemo(() => signTexture('The\nDrowned\nRat'), [])
  const windowMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffd27a', emissive: '#ffb347', emissiveIntensity: 0.2 + night * 2.5, toneMapped: false }), [night])
  return (
    <group position={[x, y, z]} rotation={[0, rotationY, 0]}>
      <mesh material={planks} position={[0, 1.7, 0]} castShadow receiveShadow>
        <boxGeometry args={[6.4, 3.4, 5.6]} />
      </mesh>
      <mesh geometry={roofGeo} material={roof} position={[0, 3.4, 0]} castShadow receiveShadow />
      <mesh position={[1.8, 4.8, -1.2]} castShadow>
        <boxGeometry args={[0.6, 1.6, 0.6]} />
        <meshStandardMaterial color="#6d6a66" roughness={1} />
      </mesh>
      {/* door and glowing windows on the seaward face */}
      <mesh position={[0, 1.0, 2.82]}>
        <boxGeometry args={[1.0, 2.0, 0.08]} />
        <meshStandardMaterial color="#2a1c12" />
      </mesh>
      {[-2.1, 2.1].map((wx) => (
        <mesh key={wx} material={windowMat} position={[wx, 1.9, 2.82]}>
          <boxGeometry args={[0.9, 0.8, 0.06]} />
        </mesh>
      ))}
      {[-1.6, 1.6].map((wz) => (
        <mesh key={wz} material={windowMat} position={[3.22, 1.9, wz]}>
          <boxGeometry args={[0.06, 0.8, 0.9]} />
        </mesh>
      ))}
      {/* hanging sign & lantern over the door */}
      <mesh position={[1.4, 3.0, 3.4]}>
        <boxGeometry args={[0.08, 0.08, 1.2]} />
        <meshStandardMaterial color="#2a2a2a" metalness={0.6} roughness={0.5} />
      </mesh>
      <mesh position={[1.4, 2.4, 3.9]} castShadow>
        <boxGeometry args={[0.9, 0.9, 0.06]} />
        <meshStandardMaterial map={sign} roughness={0.9} />
      </mesh>
      <mesh position={[-1.2, 2.7, 3.1]}>
        <boxGeometry args={[0.22, 0.3, 0.22]} />
        <meshStandardMaterial color="#ffd27a" emissive="#ffb347" emissiveIntensity={0.3 + night * 3} toneMapped={false} />
      </mesh>
      {night > 0.05 && <pointLight position={[0, 2.6, 4]} color="#ffb347" intensity={night * 16} distance={16} decay={2} />}
    </group>
  )
}

export function Shipwreck() {
  const { x, z, rotationY } = LANDMARKS.wreck
  const hull = useMemo(() => {
    const widths = (b: number) => [0, b * 0.35, b * 0.75, b * 0.95, b]
    return loftHull(
      [
        { x: -4.5, keelY: -1.6, railY: 1.2, halfWidths: widths(0.6) },
        { x: -2.5, keelY: -2.0, railY: 1.3, halfWidths: widths(1.4) },
        { x: 0, keelY: -2.1, railY: 1.2, halfWidths: widths(1.7) },
        { x: 2.5, keelY: -1.9, railY: 1.1, halfWidths: widths(1.4) },
        { x: 4.6, keelY: -1.2, railY: 1.4, halfWidths: widths(0.3) },
      ],
      7,
    )
  }, [])
  const wood = useMemo(() => new THREE.MeshStandardMaterial({ map: plankTexture('wreck-plank', [70, 60, 48]), roughness: 1, color: '#8a9a88', side: THREE.DoubleSide }), [])
  const sail = useMemo(() => new THREE.MeshStandardMaterial({ map: tornSailTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: '#9a948a' }), [])
  const group = useRef<THREE.Group>(null)
  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (group.current) group.current.rotation.z = -0.42 + Math.sin(t * 0.4) * 0.006
  })
  return (
    <group position={[x, -0.6, z]} rotation={[0, rotationY, 0]}>
      <group ref={group} rotation={[0.08, 0, -0.42]}>
        <mesh geometry={hull} material={wood} castShadow receiveShadow />
        {/* exposed ribs where the planking has gone */}
        {[-1.2, -0.6, 0, 0.6].map((rx) => (
          <mesh key={rx} position={[rx, 0.4, 1.3]} rotation={[0.3, 0, 0]} castShadow>
            <boxGeometry args={[0.12, 1.6, 0.1]} />
            <meshStandardMaterial color="#3a3028" roughness={1} />
          </mesh>
        ))}
        {/* snapped mast and tattered sail */}
        <mesh position={[0.6, 2.4, 0]} rotation={[0, 0, 0.35]} castShadow>
          <cylinderGeometry args={[0.1, 0.16, 5.5, 8]} />
          <meshStandardMaterial color="#4a3a2a" roughness={1} />
        </mesh>
        <mesh position={[0.1, 3.4, 0.05]} rotation={[0, 0, 0.35]} material={sail} castShadow>
          <planeGeometry args={[2.6, 2.2, 1, 1]} />
        </mesh>
        <mesh position={[1.6, 4.6, 0]} rotation={[0, 0, 0.35 + Math.PI / 2]}>
          <cylinderGeometry args={[0.06, 0.06, 3.2, 6]} />
          <meshStandardMaterial color="#4a3a2a" roughness={1} />
        </mesh>
      </group>
      {/* barnacled rocks the hull rests on */}
      {[
        [2, -0.9, -1.5, 1.6],
        [-3, -1.1, 1.8, 1.9],
        [0.5, -1.3, 2.4, 1.3],
      ].map(([rx, ry, rz, s], i) => (
        <mesh key={i} position={[rx, ry, rz]} scale={[s, s * 0.6, s]} receiveShadow>
          <dodecahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color="#5d5a52" roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  )
}

/** Trade ships creeping along the horizon beyond the cove mouth. */
export function TradeShips() {
  const group = useRef<THREE.Group>(null)
  const ships = useMemo(
    () => [
      { x0: -60, z: -175, speed: 0.6, scale: 1.0 },
      { x0: 30, z: -205, speed: -0.45, scale: 1.3 },
      { x0: 110, z: -160, speed: 0.35, scale: 0.9 },
    ],
    [],
  )
  const hull = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 1 }), [])
  const canvas = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d8d0bc', roughness: 1, side: THREE.DoubleSide }), [])
  useFrame((state) => {
    const g = group.current
    if (!g) return
    const t = state.clock.elapsedTime
    g.children.forEach((ship, i) => {
      const s = ships[i]
      const x = ((((s.x0 + t * s.speed + 160) % 320) + 320) % 320) - 160
      ship.position.set(x, sampleWaveHeight(x, s.z, t) * 0.5, s.z)
      ship.rotation.set(Math.sin(t * 0.5 + i) * 0.02, s.speed > 0 ? 0 : Math.PI, Math.sin(t * 0.7 + i) * 0.03)
    })
  })
  return (
    <group ref={group}>
      {ships.map((s, i) => (
        <group key={i} scale={s.scale}>
          <mesh material={hull} position={[0, 0.9, 0]}>
            <boxGeometry args={[16, 2.2, 4]} />
          </mesh>
          <mesh material={hull} position={[-6.5, 2.4, 0]}>
            <boxGeometry args={[4, 1.4, 3.6]} />
          </mesh>
          {[-4.5, 0.5, 5].map((mx, k) => (
            <group key={k} position={[mx, 2, 0]}>
              <mesh material={hull} position={[0, 5, 0]}>
                <cylinderGeometry args={[0.12, 0.2, 11, 5]} />
              </mesh>
              <mesh material={canvas} position={[0, 7.2, 0]}>
                <planeGeometry args={[4.2, 3.2]} />
              </mesh>
              <mesh material={canvas} position={[0, 3.8, 0]}>
                <planeGeometry args={[5.4, 3.6]} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
    </group>
  )
}

/** All the island dressing in one place so the scene can toggle it by quality. */
export function CoveDressing({ night, quality }: { night: number; quality: Quality }) {
  useSceneClock()
  return (
    <group>
      <IslandTerrain quality={quality} />
      <Palms quality={quality} />
      <Rocks quality={quality} />
      <Foliage quality={quality} />
      <Fort night={night} />
      <Lighthouse night={night} />
      <Dock night={night} />
      <Tavern night={night} />
      <Shipwreck />
      <TradeShips />
    </group>
  )
}
