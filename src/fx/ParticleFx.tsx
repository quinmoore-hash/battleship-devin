import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { burstDuration, makeBurst, particleAt, smokePuff, type BurstOptions, type SmokeOptions } from './particles'
import type { Vec3 } from './layout'

export type ParticleShape = 'sphere' | 'box' | 'shard'

export interface ParticleBurstProps extends BurstOptions {
  position?: Vec3
  /** Colours picked per particle from `tint`. */
  colors: string[]
  gravity: number
  drag?: number
  shape?: ParticleShape
  emissive?: boolean
  opacity?: number
  /** Called once when every particle has died. */
  onDone?: () => void
}

const tmpObj = new THREE.Object3D()
const tmpColor = new THREE.Color()

/**
 * One-shot deterministic particle burst on a single InstancedMesh.
 * Starts when mounted; remount (change `key`) to replay.
 */
export function ParticleBurst({
  position = [0, 0, 0],
  colors,
  gravity,
  drag = 0,
  shape = 'sphere',
  emissive = false,
  opacity = 1,
  onDone,
  ...burst
}: ParticleBurstProps) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  // A burst is immutable once started: it is keyed by `seed`, so recompute only when that changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const particles = useMemo(() => makeBurst(burst), [burst.seed, burst.count])
  const total = useMemo(() => burstDuration(particles), [particles])
  const start = useRef<number | null>(null)
  const done = useRef(false)
  const palette = useMemo(() => colors.map((c) => new THREE.Color(c)), [colors])

  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m || done.current) return
    if (start.current === null) {
      start.current = clock.elapsedTime
      particles.forEach((p, i) => {
        tmpColor.copy(palette[Math.min(palette.length - 1, Math.floor(p.tint * palette.length))])
        m.setColorAt(i, tmpColor)
      })
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    const t = clock.elapsedTime - start.current
    let alive = 0
    for (let i = 0; i < particles.length; i++) {
      const s = particleAt(particles[i], t, gravity, drag)
      if (!s) {
        tmpObj.position.set(0, -1000, 0)
        tmpObj.scale.setScalar(0.0001)
      } else {
        alive++
        tmpObj.position.set(s.x, s.y, s.z)
        tmpObj.rotation.set(s.age * 6 + i, s.age * 4, i)
        tmpObj.scale.setScalar(Math.max(s.scale, 0.0001))
      }
      tmpObj.updateMatrix()
      m.setMatrixAt(i, tmpObj.matrix)
    }
    m.instanceMatrix.needsUpdate = true
    if (alive === 0 && t > total) {
      done.current = true
      m.visible = false
      onDone?.()
    }
  })

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, particles.length]} position={position} frustumCulled={false}>
      {shape === 'sphere' && <sphereGeometry args={[1, 6, 5]} />}
      {shape === 'box' && <boxGeometry args={[1, 1, 1]} />}
      {shape === 'shard' && <tetrahedronGeometry args={[1, 0]} />}
      <meshStandardMaterial
        color="#ffffff"
        emissive={emissive ? '#ffffff' : '#000000'}
        emissiveIntensity={emissive ? 0.9 : 0}
        transparent={opacity < 1}
        opacity={opacity}
        roughness={0.6}
      />
    </instancedMesh>
  )
}

export interface SmokeColumnProps extends Partial<SmokeOptions> {
  position?: Vec3
  color?: string
  opacity?: number
  /** Overall scale multiplier, e.g. to fade a column out. */
  intensity?: number
}

/** Continuous looping smoke (or bubble) column. */
export function SmokeColumn({
  position = [0, 0, 0],
  color = '#4a4a4a',
  opacity = 0.55,
  intensity = 1,
  count = 10,
  period = 2.6,
  height = 1.6,
  drift = 0.18,
  baseScale = 0.11,
  seed = 0,
}: SmokeColumnProps) {
  const mesh = useRef<THREE.InstancedMesh>(null)
  const opts = useMemo<SmokeOptions>(
    () => ({ count, period, height, drift, baseScale, seed }),
    [count, period, height, drift, baseScale, seed],
  )
  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return
    for (let i = 0; i < count; i++) {
      const s = smokePuff(i, clock.elapsedTime, opts)
      tmpObj.position.set(s.x, s.y, s.z)
      tmpObj.rotation.set(0, 0, 0)
      tmpObj.scale.setScalar(Math.max(s.scale * intensity, 0.0001))
      tmpObj.updateMatrix()
      m.setMatrixAt(i, tmpObj.matrix)
    }
    m.instanceMatrix.needsUpdate = true
  })
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} position={position} frustumCulled={false}>
      <sphereGeometry args={[1, 7, 6]} />
      <meshStandardMaterial color={color} transparent opacity={opacity} roughness={1} depthWrite={false} />
    </instancedMesh>
  )
}
