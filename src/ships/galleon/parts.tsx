/**
 * Galleon-local detail parts that the shared kit lacks today (cloth sails with torn/scorched states, a lateen
 * rig, textured ensign, gratings, stairs, doors, stern windows, splinters, instanced small fittings).
 * Candidates for promotion into `src/ships/kit`.
 */
import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { seededRandom } from '../../vfx/random'
import type { GalleonMaterials } from './materials'

const UP = new THREE.Vector3(0, 1, 0)
const tmpA = new THREE.Vector3()
const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const tmpS = new THREE.Vector3(1, 1, 1)

export function beamTransform(from: Vec3, to: Vec3) {
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const dir = b.clone().sub(a)
  const len = dir.length()
  const quat = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize())
  return { mid: a.add(b).multiplyScalar(0.5), len, quat }
}

export interface BeamProps {
  from: Vec3
  to: Vec3
  /** Radius at `from`; `radiusTo` defaults to the same (use a smaller value for tapering spars). */
  radius: number
  radiusTo?: number
  material: THREE.Material
  segments?: number
  castShadow?: boolean
}

/** Cylinder between two points (spars, yards, head rails, posts). */
export function Beam({ from, to, radius, radiusTo, material, segments = 7, castShadow }: BeamProps) {
  const { mid, len, quat } = useMemo(() => beamTransform(from, to), [from, to])
  return (
    <mesh position={mid} quaternion={quat} material={material} castShadow={castShadow}>
      <cylinderGeometry args={[radiusTo ?? radius, radius, len, segments]} />
    </mesh>
  )
}

/** A batch of identical small parts (cleats, balusters, grating bars, port frames) in one draw call. */
export function Instanced({ geometry, material, transforms, castShadow }: { geometry: THREE.BufferGeometry; material: THREE.Material; transforms: { position: Vec3; rotation?: Vec3; scale?: Vec3 }[]; castShadow?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    transforms.forEach((t, i) => {
      tmpA.set(...t.position)
      tmpQ.setFromEuler(new THREE.Euler(...(t.rotation ?? [0, 0, 0])))
      tmpS.set(...(t.scale ?? [1, 1, 1]))
      tmpM.compose(tmpA, tmpQ, tmpS)
      mesh.setMatrixAt(i, tmpM)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [transforms])
  return <instancedMesh ref={ref} args={[geometry, material, transforms.length]} castShadow={castShadow} receiveShadow />
}

export interface ClothSailProps {
  m: GalleonMaterials
  /** 0 furled … 1 full. */
  set: number
  /** 0 pristine … 1 gone. */
  torn: number
  scorched?: boolean
  phase?: number
  reducedMotion?: boolean
  /** Square sail hung from a yard along z, bellying toward +x (wind astern). */
  square?: { width: number; height: number }
  /** Lateen: triangle hung from a tilted yard from `a` (fore, low) to `b` (aft, high); the leech drops `drop` below `b`. */
  lateen?: { a: Vec3; b: Vec3; drop: number }
  segments?: [number, number]
}

/**
 * Cloth sail with belly, flutter, furling, tearing (alpha-mapped shot holes and a ragged foot) and scorching.
 * Base shape is computed once; the per-frame loop only writes positions (no allocations).
 */
export function ClothSail({ m, set, torn, scorched = false, phase = 0, reducedMotion = false, square, lateen, segments = [10, 8] }: ClothSailProps) {
  const ref = useRef<THREE.Mesh>(null)
  const [nu, nv] = segments
  const built = useMemo(() => {
    const geom = new THREE.BufferGeometry()
    const count = (nu + 1) * (nv + 1)
    const base = new Float32Array(count * 3)
    const uvs = new Float32Array(count * 2)
    const dir = new Float32Array(count * 3)
    const idx: number[] = []
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = i / nu
        const v = j / nv
        const k = j * (nu + 1) + i
        if (square) {
          base[k * 3] = 0
          base[k * 3 + 1] = -v * square.height
          base[k * 3 + 2] = (u - 0.5) * square.width
          dir[k * 3] = 1
        } else if (lateen) {
          const { a, b, drop } = lateen
          base[k * 3] = a[0] + (b[0] - a[0]) * u
          base[k * 3 + 1] = a[1] + (b[1] - a[1]) * u - v * drop * u
          base[k * 3 + 2] = 0
          dir[k * 3 + 2] = 1
        }
        uvs[k * 2] = u
        uvs[k * 2 + 1] = 1 - v
        if (i < nu && j < nv) idx.push(k, k + 1, k + nu + 1, k + 1, k + nu + 2, k + nu + 1)
      }
    }
    geom.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3))
    geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    geom.setIndex(idx)
    geom.computeVertexNormals()
    return { geom, base, dir }
  }, [nu, nv, square, lateen])

  const belly = square ? 0.32 * Math.min(square.width, square.height) : lateen ? 0.22 : 0
  const furl = 0.06 + 0.94 * set
  const update = (t: number) => {
    const mesh = ref.current
    if (!mesh) return
    const pos = built.geom.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const { base, dir } = built
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const u = i / nu
        const v = j / nv
        const k = (j * (nu + 1) + i) * 3
        const edge = Math.sin(u * Math.PI)
        const sag = square ? 0.55 + 0.45 * Math.sin(v * Math.PI) : Math.sqrt(v) * (1 - 0.35 * v) * Math.sin(u * Math.PI)
        const flutter = reducedMotion ? 0 : Math.sin(t * 2.1 + u * 6 + v * 3 + phase) * 0.018 * set * (0.3 + v) + Math.sin(t * 3.7 + u * 11 + phase) * 0.006 * set
        const b = belly * set * (square ? edge * sag : sag) + flutter
        arr[k] = base[k] + dir[k] * b
        arr[k + 1] = square ? base[k + 1] * furl : base[k + 1]
        arr[k + 2] = base[k + 2] + dir[k + 2] * b
      }
    }
    pos.needsUpdate = true
    built.geom.computeVertexNormals()
  }
  useFrame(({ clock }) => {
    if (reducedMotion && ref.current?.userData.settled === set) return
    update(clock.getElapsedTime())
    if (ref.current) ref.current.userData.settled = set
  })

  const material = torn > 0 ? m.tornSail(torn, scorched) : scorched ? m.sailScorched : m.sail
  return <mesh ref={ref} geometry={built.geom} material={material} visible={torn < 1 && set > 0.02} castShadow receiveShadow />
}

/** Rolled-up canvas on a yard, shown as the sail is furled. */
export function FurledBundle({ length, set, material }: { length: number; set: number; material: THREE.Material }) {
  const k = 1 - set
  if (k < 0.08) return null
  return (
    <mesh material={material} rotation-x={Math.PI / 2} position={[0.01, -0.03, 0]} scale={[1, 1, 1]}>
      <cylinderGeometry args={[0.012 + 0.045 * k, 0.012 + 0.045 * k, length * 0.96, 8]} />
    </mesh>
  )
}

/** Textured flag streaming aft (−x) from a halyard point, fluttering unless reduced motion. */
export function Ensign({ position, material, width = 0.5, height = 0.3, phase = 0, reducedMotion = false, drop = 0 }: { position: Vec3; material: THREE.Material; width?: number; height?: number; phase?: number; reducedMotion?: boolean; drop?: number }) {
  const ref = useRef<THREE.Mesh>(null)
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(width, height, 10, 3)
    g.translate(-width / 2, -height / 2, 0)
    return g
  }, [width, height])
  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const t = clock.getElapsedTime() * 3 + phase
    const pos = geom.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    for (let i = 0; i < pos.count; i++) {
      const x = arr[i * 3]
      const k = -x / width
      arr[i * 3 + 2] = reducedMotion ? Math.sin(k * 5) * 0.05 * k : Math.sin(t + k * 5) * 0.09 * k
      arr[i * 3 + 1] = (geom.userData.y0 as Float32Array)[i] - drop * k
    }
    pos.needsUpdate = true
    geom.computeVertexNormals()
  })
  useLayoutEffect(() => {
    const pos = geom.attributes.position as THREE.BufferAttribute
    const y0 = new Float32Array(pos.count)
    for (let i = 0; i < pos.count; i++) y0[i] = pos.getY(i)
    geom.userData.y0 = y0
  }, [geom])
  return <mesh ref={ref} geometry={geom} material={material} position={position} castShadow />
}

/** Hatch grating: coaming frame with crossed iron/wood bars. Width along x, depth along z. */
export function Grating({ position, width, depth, m, bars = 7, frame = 0.05, height = 0.06, lod = 0 }: { position: Vec3; width: number; depth: number; m: GalleonMaterials; bars?: number; frame?: number; height?: number; lod?: number }) {
  const barGeom = useMemo(() => new THREE.BoxGeometry(0.016, 0.02, 1), [])
  const transforms = useMemo(() => {
    const out: { position: Vec3; rotation?: Vec3; scale?: Vec3 }[] = []
    const nx = lod > 0 ? Math.ceil(bars / 2) : bars
    for (let i = 0; i < nx; i++) {
      const x = -width / 2 + frame + ((width - 2 * frame) * (i + 0.5)) / nx
      out.push({ position: [x, height - 0.01, 0], scale: [1, 1, depth - 2 * frame] })
    }
    const nz = Math.max(2, Math.round((nx * depth) / width))
    for (let i = 0; i < nz; i++) {
      const z = -depth / 2 + frame + ((depth - 2 * frame) * (i + 0.5)) / nz
      out.push({ position: [0, height - 0.025, z], rotation: [0, Math.PI / 2, 0], scale: [1, 1, width - 2 * frame] })
    }
    return out
  }, [width, depth, bars, frame, height, lod])
  return (
    <group position={position}>
      {[-1, 1].map((s) => (
        <mesh key={`x${s}`} material={m.deckInner} position={[(s * (width - frame)) / 2, height / 2, 0]} castShadow>
          <boxGeometry args={[frame, height, depth]} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={`z${s}`} material={m.deckInner} position={[0, height / 2, (s * (depth - frame)) / 2]} castShadow>
          <boxGeometry args={[width - 2 * frame, height, frame]} />
        </mesh>
      ))}
      <mesh material={m.charred} position={[0, 0.005, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[width - 2 * frame, depth - 2 * frame]} />
      </mesh>
      <Instanced geometry={barGeom} material={m.wale} transforms={transforms} />
    </group>
  )
}

/** Ladder / companionway steps rising from (`x`, `y0`) to (`x ± run`, `y1`); `dir` is the direction the steps climb along x. */
export function Stairs({ x, z, y0, y1, dir, width = 0.22, m }: { x: number; z: number; y0: number; y1: number; dir: 1 | -1; width?: number; m: GalleonMaterials }) {
  const steps = Math.max(3, Math.round((y1 - y0) / 0.09))
  const run = (y1 - y0) * 0.75
  const geom = useMemo(() => new THREE.BoxGeometry(run / steps + 0.015, 0.025, width), [run, steps, width])
  const transforms = useMemo(
    () =>
      Array.from({ length: steps }, (_, i): { position: Vec3 } => ({
        position: [x + dir * (run * (i + 0.5)) / steps, y0 + ((y1 - y0) * (i + 1)) / steps - 0.01, z],
      })),
    [x, z, y0, y1, dir, run, steps],
  )
  return (
    <group>
      <Instanced geometry={geom} material={m.deckInner} transforms={transforms} castShadow />
      {[-1, 1].map((s) => (
        <Beam key={s} from={[x, y0 + 0.02, z + (s * width) / 2]} to={[x + dir * run, y1 + 0.02, z + (s * width) / 2]} radius={0.014} material={m.wale} segments={5} />
      ))}
    </group>
  )
}

/** Panelled door in a bulkhead facing ±x. */
export function Door({ position, facing, m, width = 0.16, height = 0.3 }: { position: Vec3; facing: 1 | -1; m: GalleonMaterials; width?: number; height?: number }) {
  return (
    <group position={position}>
      <mesh material={m.trim} position={[facing * 0.006, height / 2, 0]}>
        <boxGeometry args={[0.012, height + 0.04, width + 0.04]} />
      </mesh>
      <mesh material={m.wale} position={[facing * 0.012, height / 2, 0]}>
        <boxGeometry args={[0.012, height, width]} />
      </mesh>
      <mesh material={m.brass} position={[facing * 0.022, height * 0.5, width * 0.3]}>
        <sphereGeometry args={[0.012, 6, 5]} />
      </mesh>
    </group>
  )
}

/** Leaded stern/cabin window with gilt frame and mullions. Faces `facing` along x. */
export function Window({ position, facing, m, width = 0.11, height = 0.13, mullions = true }: { position: Vec3; facing: 1 | -1; m: GalleonMaterials; width?: number; height?: number; mullions?: boolean }) {
  return (
    <group position={position}>
      <mesh material={m.gilt} position={[facing * 0.004, 0, 0]}>
        <boxGeometry args={[0.012, height + 0.035, width + 0.035]} />
      </mesh>
      <mesh material={m.glass} position={[facing * 0.012, 0, 0]}>
        <boxGeometry args={[0.006, height, width]} />
      </mesh>
      {mullions && (
        <>
          <mesh material={m.wale} position={[facing * 0.016, 0, 0]}>
            <boxGeometry args={[0.004, height, 0.008]} />
          </mesh>
          <mesh material={m.wale} position={[facing * 0.016, 0, 0]}>
            <boxGeometry args={[0.004, 0.008, width]} />
          </mesh>
        </>
      )}
    </group>
  )
}

/** Shattered planking around a shot hole: jagged splinters radiating outward, seeded per cell/side. */
export function Splinters({ position, sign, seed, m, count = 9 }: { position: Vec3; sign: 1 | -1; seed: number; m: GalleonMaterials; count?: number }) {
  const geom = useMemo(() => new THREE.BoxGeometry(0.012, 0.012, 1), [])
  const transforms = useMemo(() => {
    const rnd = seededRandom(seed)
    return Array.from({ length: count }, (): { position: Vec3; rotation: Vec3; scale: Vec3 } => {
      const ang = rnd() * Math.PI * 2
      const r = 0.1 + rnd() * 0.09
      const len = 0.08 + rnd() * 0.14
      const tiltOut = (0.15 + rnd() * 0.5) * sign
      return {
        position: [position[0] + Math.cos(ang) * r, position[1] + Math.sin(ang) * r * 0.8, position[2] + sign * (0.01 + rnd() * 0.03)],
        rotation: [Math.cos(ang) * tiltOut * 0.8, Math.sin(ang) * 0.6 * sign + (sign > 0 ? 0 : Math.PI) + (rnd() - 0.5) * 0.6, rnd() * Math.PI],
        scale: [1 + rnd() * 1.4, 1, len],
      }
    })
  }, [position, sign, seed, count])
  return (
    <group>
      <Instanced geometry={geom} material={m.splinter} transforms={transforms} />
      <mesh position={[position[0], position[1], position[2] + sign * 0.012]} rotation-y={sign > 0 ? 0 : Math.PI}>
        <ringGeometry args={[0.14, 0.24, 14]} />
        <meshStandardMaterial color="#120a06" roughness={1} transparent opacity={0.85} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
    </group>
  )
}
