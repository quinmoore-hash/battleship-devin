import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import type { Livery, Lod } from '../types'
import { shipMaterials } from './materials'

/** Rope texture tile length in metres (one tile = two twists). */
const ROPE_TILE = 0.07

/** Catenary-ish hanging curve between two points; `sag` is the mid-span droop in metres. */
export function ropeCurve(from: Vec3, to: Vec3, sag: number, samples = 12): THREE.Vector3[] {
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const droop = sag * (Math.cosh((t - 0.5) * 2.4) - Math.cosh(1.2)) / (1 - Math.cosh(1.2))
    pts.push(new THREE.Vector3(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t - droop, from[2] + (to[2] - from[2]) * t))
  }
  return pts
}

export function ropeGeometry(points: THREE.Vector3[], radius: number, radial = 5, tubular?: number): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5)
  const length = curve.getLength()
  const g = new THREE.TubeGeometry(curve, tubular ?? Math.max(1, Math.min(32, Math.round(length / 0.15) + 1)), radius, radial, false)
  const uv = g.attributes.uv as THREE.BufferAttribute
  const repeats = length / ROPE_TILE
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * repeats)
  return g
}

export interface RopeProps {
  from: Vec3
  to: Vec3
  livery: Livery
  radius?: number
  /** Mid-span sag in metres (0 = taut). */
  sag?: number
  lod?: Lod
}

/** A length of twisted rope between two points with catenary sag. */
export function Rope({ from, to, livery, radius = 0.012, sag = 0, lod = 0 }: RopeProps) {
  const m = shipMaterials(livery)
  const geom = useMemo(() => {
    const samples = sag > 0 ? (lod === 0 ? 14 : 7) : 2
    return ropeGeometry(ropeCurve(from, to, sag, samples), radius, lod === 0 ? 6 : lod === 1 ? 4 : 3)
  }, [from, to, radius, sag, lod])
  useLayoutEffect(() => () => geom.dispose(), [geom])
  return <mesh geometry={geom} material={m.rope} castShadow />
}

export interface RatlinesProps {
  /** Chain-plate point at the rail (one side; mirrored across z unless `mirror={false}`). */
  from: Vec3
  /** Attachment point up the mast (the top / crosstrees). */
  to: Vec3
  livery: Livery
  rungs?: number
  /** Number of shrouds per side fanning from the chain plates. Default 3. */
  shrouds?: number
  /** Fore-and-aft spread of the chain plates in metres. Default 0.35. */
  spread?: number
  mirror?: boolean
  lod?: Lod
}

const RUNG_GEOM = new THREE.CylinderGeometry(1, 1, 1, 4, 1)
const DEADEYE_GEOM = new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10)
const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _up = new THREE.Vector3(0, 1, 0)

/** Shrouds fanning from the chain plates to the top with instanced rung lines. */
export function Ratlines({ from, to, livery, rungs = 10, shrouds = 3, spread = 0.35, mirror = true, lod = 0 }: RatlinesProps) {
  const m = shipMaterials(livery)
  const sides = mirror ? [1, -1] : [1]
  const rungCount = lod === 2 ? 0 : lod === 1 ? Math.round(rungs / 2) : rungs
  const lines = useMemo(() => {
    const out: { a: Vec3; b: Vec3 }[] = []
    for (const side of sides) {
      for (let i = 0; i < shrouds; i++) {
        const k = shrouds === 1 ? 0 : i / (shrouds - 1) - 0.5
        out.push({ a: [from[0] + k * spread, from[1], from[2] * side], b: [to[0] + k * spread * 0.12, to[1], to[2] * side] })
      }
    }
    return out
  }, [from, to, shrouds, spread, mirror]) // eslint-disable-line react-hooks/exhaustive-deps
  const geom = useMemo(() => {
    const r = lod === 0 ? 5 : 3
    const geos = lines.map((l) => ropeGeometry([new THREE.Vector3(...l.a), new THREE.Vector3(...l.b)], 0.012, r, 1))
    return mergeBuffers(geos)
  }, [lines, lod])
  useLayoutEffect(() => () => geom.dispose(), [geom])
  const inst = useRef<THREE.InstancedMesh>(null)
  const total = rungCount * sides.length
  useLayoutEffect(() => {
    const mesh = inst.current
    if (!mesh || total === 0) return
    let idx = 0
    for (let s = 0; s < sides.length; s++) {
      const first = lines[s * shrouds]
      const last = lines[s * shrouds + shrouds - 1]
      for (let r = 0; r < rungCount; r++) {
        const t = (r + 1) / (rungCount + 1)
        _a.set(first.a[0] + (first.b[0] - first.a[0]) * t, first.a[1] + (first.b[1] - first.a[1]) * t, first.a[2] + (first.b[2] - first.a[2]) * t)
        _b.set(last.a[0] + (last.b[0] - last.a[0]) * t, last.a[1] + (last.b[1] - last.a[1]) * t, last.a[2] + (last.b[2] - last.a[2]) * t)
        const len = _a.distanceTo(_b) + 0.03
        _s.subVectors(_b, _a).normalize()
        _q.setFromUnitVectors(_up, _s)
        _m.compose(_a.lerp(_b, 0.5), _q, _s.set(0.006, len, 0.006))
        mesh.setMatrixAt(idx++, _m)
      }
    }
    mesh.count = idx
    mesh.instanceMatrix.needsUpdate = true
  }, [lines, rungCount, shrouds, total, sides.length])
  return (
    <group>
      <mesh geometry={geom} material={m.rope} castShadow />
      {total > 0 && <instancedMesh ref={inst} args={[RUNG_GEOM, m.rope, total]} castShadow frustumCulled={false} />}
      {lod < 2 &&
        lines.map((l, i) => (
          <group key={i} position={l.a}>
            <mesh geometry={DEADEYE_GEOM} material={m.oak} rotation-x={Math.PI / 2} position-y={0.05} />
            <mesh material={m.iron} position-y={-0.02}>
              <boxGeometry args={[0.02, 0.08, 0.008]} />
            </mesh>
          </group>
        ))}
    </group>
  )
}

export interface BlockProps {
  position: Vec3
  livery: Livery
  size?: number
  rotationY?: number
}

/** A wooden pulley block with an iron sheave strop. */
export function Block({ position, livery, size = 0.08, rotationY = 0 }: BlockProps) {
  const m = shipMaterials(livery)
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh material={m.oak} castShadow>
        <capsuleGeometry args={[size * 0.32, size * 0.5, 2, 8]} />
      </mesh>
      <mesh material={m.iron} rotation-x={Math.PI / 2} position-z={size * 0.33}>
        <cylinderGeometry args={[size * 0.2, size * 0.2, size * 0.04, 10]} />
      </mesh>
      <mesh material={m.rope}>
        <torusGeometry args={[size * 0.36, size * 0.06, 5, 14]} />
      </mesh>
      <mesh material={m.rope} position-y={size * 0.62}>
        <torusGeometry args={[size * 0.14, size * 0.05, 5, 10]} />
      </mesh>
    </group>
  )
}

export interface CleatProps {
  position: Vec3
  livery: Livery
  rotationY?: number
  size?: number
}

/** Deck cleat with a figure-eight of rope. */
export function Cleat({ position, livery, rotationY = 0, size = 0.14 }: CleatProps) {
  const m = shipMaterials(livery)
  return (
    <group position={position} rotation-y={rotationY}>
      <mesh material={m.oak} position-y={size * 0.1} castShadow>
        <boxGeometry args={[size * 0.3, size * 0.2, size * 0.25]} />
      </mesh>
      <mesh material={m.oak} position-y={size * 0.26} rotation-z={Math.PI / 2} castShadow>
        <capsuleGeometry args={[size * 0.08, size * 0.85, 2, 8]} />
      </mesh>
      <mesh material={m.rope} position-y={size * 0.26} rotation-y={Math.PI / 2}>
        <torusGeometry args={[size * 0.4, size * 0.05, 5, 16]} />
      </mesh>
    </group>
  )
}

export function mergeBuffers(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let base = 0
  for (const g of geos) {
    const p = g.attributes.position as THREE.BufferAttribute
    const n = g.attributes.normal as THREE.BufferAttribute
    const u = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i))
      nor.push(n.getX(i), n.getY(i), n.getZ(i))
      uv.push(u.getX(i), u.getY(i))
    }
    const ind = g.index!
    for (let i = 0; i < ind.count; i++) idx.push(ind.getX(i) + base)
    base += p.count
    g.dispose()
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  out.setIndex(idx)
  return out
}
