import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { seededRandom } from '../random'

export interface HullBreachProps {
  /** Point on the hull surface (model or world space, whatever the parent group is). */
  position: Vec3
  /** Outward normal of the hull at that point. */
  normal: Vec3
  seed?: number
  /** Hole radius in world units (a cell is 1). */
  radius?: number
  /** Show glowing embers inside the hole. */
  glowing?: boolean
}

const tmpObj = new THREE.Object3D()
const tmpColor = new THREE.Color()

let scorchTex: THREE.CanvasTexture | null = null
function scorchTexture(): THREE.CanvasTexture {
  if (scorchTex) return scorchTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 64)
  g.addColorStop(0, 'rgba(8,4,2,0.95)')
  g.addColorStop(0.35, 'rgba(14,8,4,0.75)')
  g.addColorStop(0.7, 'rgba(20,12,6,0.3)')
  g.addColorStop(1, 'rgba(20,12,6,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  // soot streaks running "up" the hull
  ctx.globalCompositeOperation = 'source-over'
  for (let i = 0; i < 9; i++) {
    const x = 30 + i * 8
    const grad = ctx.createLinearGradient(0, 64, 0, 0)
    grad.addColorStop(0, 'rgba(10,6,3,0.35)')
    grad.addColorStop(1, 'rgba(10,6,3,0)')
    ctx.fillStyle = grad
    ctx.fillRect(x, 4, 3 + (i % 3), 64)
  }
  scorchTex = new THREE.CanvasTexture(c)
  scorchTex.colorSpace = THREE.SRGBColorSpace
  return scorchTex
}

function jaggedShape(rnd: () => number, radius: number, points: number, jitter: number): THREE.Shape {
  const s = new THREE.Shape()
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2
    const r = radius * (1 - jitter + rnd() * jitter * 2) * (i % 2 ? 1 : 0.93)
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  s.closePath()
  return s
}

const HOLE_MAT = new THREE.MeshStandardMaterial({ color: '#070402', roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
const CHAR_MAT = new THREE.MeshStandardMaterial({ color: '#1a0e07', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
const SHARD_MAT = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 })
const EMBER_MAT = new THREE.MeshBasicMaterial({ color: '#ff4d0a', toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
const WOOD = ['#7a4f26', '#8f5d2d', '#5c3b1b', '#2a1a0d', '#3d2410'].map((c) => new THREE.Color(c))

/**
 * Where the ball went through: a blackened ragged hole with a charred rim, a scorch stain running up
 * the planks, splintered plank ends bent outward by the blast, and a couple of planks left hanging
 * below the hole. Local +z is the outward normal.
 */
export function HullBreach({ position, normal, seed = 1, radius = 0.17, glowing = true }: HullBreachProps) {
  const rim = useRef<THREE.InstancedMesh>(null)
  const planks = useRef<THREE.Group>(null)
  const embers = useRef<THREE.InstancedMesh>(null)
  const quat = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...normal).normalize()), [normal])
  const built = useMemo(() => {
    const rnd = seededRandom(seed)
    const hole = new THREE.ShapeGeometry(jaggedShape(rnd, radius, 18, 0.16))
    const outer = jaggedShape(rnd, radius * 1.3, 24, 0.12)
    outer.holes.push(new THREE.Path(jaggedShape(rnd, radius * 0.9, 18, 0.1).getPoints()))
    const char = new THREE.ShapeGeometry(outer)
    const shardCount = 12
    const shards = Array.from({ length: shardCount }, (_, i) => {
      const a = (i / shardCount) * Math.PI * 2 + rnd() * 0.4
      const len = radius * (0.25 + rnd() * 0.4)
      // planks blown outward: mostly along the normal, a little radial
      return { a, len, w: radius * (0.08 + rnd() * 0.1), tilt: 0.9 + rnd() * 0.6, tint: Math.floor(rnd() * WOOD.length), r: radius * (0.9 + rnd() * 0.15) }
    })
    const hanging = Array.from({ length: 2 + Math.floor(rnd() * 2) }, () => ({
      x: (rnd() - 0.5) * radius * 1.2,
      len: radius * (0.9 + rnd() * 1.2),
      w: radius * (0.18 + rnd() * 0.12),
      swing: rnd() * Math.PI * 2,
      tilt: 0.15 + rnd() * 0.35,
      tint: Math.floor(rnd() * 3),
    }))
    const emberSpots = Array.from({ length: 5 }, () => {
      const a = rnd() * Math.PI * 2
      const r = radius * (0.55 + rnd() * 0.35)
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, p: rnd() * 10, s: 0.4 + rnd() * 0.6 }
    })
    return { hole, char, shards, hanging, emberSpots }
  }, [seed, radius])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const m = rim.current
    if (m && !m.userData.set) {
      built.shards.forEach((s, i) => {
        tmpObj.position.set(Math.cos(s.a) * s.r, Math.sin(s.a) * s.r, s.len * 0.45 * Math.sin(s.tilt))
        tmpObj.rotation.set(0, 0, 0)
        tmpObj.quaternion.setFromEuler(new THREE.Euler(0, 0, s.a))
        tmpObj.rotateY(-s.tilt)
        tmpObj.scale.set(s.len, s.w, radius * 0.05)
        tmpObj.updateMatrix()
        m.setMatrixAt(i, tmpObj.matrix)
        tmpColor.copy(WOOD[s.tint]).lerp(new THREE.Color('#120a05'), 0.45)
        m.setColorAt(i, tmpColor)
      })
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
      m.userData.set = true
    }
    const g = planks.current
    if (g) {
      g.children.forEach((c, i) => {
        const h = built.hanging[i]
        if (h) c.rotation.z = Math.sin(t * 1.3 + h.swing) * 0.05
      })
    }
    const e = embers.current
    if (e) {
      built.emberSpots.forEach((s, i) => {
        const glow = Math.max(0, Math.sin(t * 3.1 + s.p) * Math.sin(t * 1.3 + s.p * 0.7))
        tmpObj.position.set(s.x, s.y, 0.004)
        tmpObj.rotation.set(0, 0, s.p)
        tmpObj.scale.set(radius * 0.07 * s.s, radius * 0.03 * s.s * (0.5 + glow), 1)
        tmpObj.updateMatrix()
        e.setMatrixAt(i, tmpObj.matrix)
      })
      e.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group position={position} quaternion={quat}>
      <mesh position={[0, radius * 0.5, 0.006]} renderOrder={6}>
        <planeGeometry args={[radius * 4.2, radius * 4.8]} />
        <meshBasicMaterial map={scorchTexture()} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
      </mesh>
      <mesh geometry={built.char} material={CHAR_MAT} position={[0, 0, 0.01]} renderOrder={7} />
      <mesh geometry={built.hole} material={HOLE_MAT} position={[0, 0, 0.014]} renderOrder={8} />
      {glowing && (
        <instancedMesh ref={embers} args={[undefined, EMBER_MAT, built.emberSpots.length]} position={[0, 0, 0.016]} renderOrder={9}>
          <circleGeometry args={[1, 8]} />
        </instancedMesh>
      )}
      <instancedMesh ref={rim} args={[undefined, SHARD_MAT, built.shards.length]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
      </instancedMesh>
      <group ref={planks}>
        {built.hanging.map((h, i) => (
          <group key={i} position={[h.x, -radius * 0.85, radius * 0.06]} rotation={[h.tilt, 0, 0]}>
            <mesh position={[0, -h.len / 2, 0]} castShadow>
              <boxGeometry args={[h.w, h.len, radius * 0.1]} />
              <meshStandardMaterial color={WOOD[h.tint]} roughness={0.9} />
            </mesh>
            <mesh position={[0, -h.len * 0.1, 0.001]}>
              <boxGeometry args={[h.w * 1.05, h.len * 0.3, radius * 0.1]} />
              <meshStandardMaterial color="#17100a" roughness={1} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  )
}
