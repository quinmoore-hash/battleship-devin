import { useFrame } from '@react-three/fiber'
import { useEffect, useId, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { seededRandom } from '../random'
import { emberAt, emberSeeds, type EmberOptions } from './embers'
import { defaultFireBudget, FireLightBudget, MAX_FIRE_LIGHTS } from './fireBudget'
import { attachParams, disposeParams, makeSpriteMaterial, spriteQuad } from './sprites'
import { useReducedMotion } from './useReducedMotion'
import { scaleCount, useParticlesScale } from '../../perf/store'
import { WIND } from './wind'

export interface FireProps {
  position: Vec3
  /** 1 = a burning deck section (~0.9 units tall). */
  scale?: number
  seed?: number
  /** 0 = out, 1 = full blaze. Also drives the shared light. */
  intensity?: number
  /** Light budget to register with (defaults to the scene-wide singleton). */
  budget?: FireLightBudget
}

const tmpObj = new THREE.Object3D()

export interface Tongue {
  x: number
  z: number
  w: number
  h: number
  phase: number
  seed: number
}

export function makeTongues(seed: number, count: number, scale: number): Tongue[] {
  const rnd = seededRandom(seed)
  return Array.from({ length: count }, (_, i) => {
    const a = rnd() * Math.PI * 2
    const r = (i === 0 ? 0 : 0.05 + rnd() * 0.14) * scale
    const core = i < 2
    return {
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      w: (core ? 0.42 : 0.22 + rnd() * 0.2) * scale,
      h: (core ? 0.95 : 0.45 + rnd() * 0.45) * scale,
      phase: rnd() * Math.PI * 2,
      seed: rnd(),
    }
  })
}

/**
 * Persistent looping fire: layered procedural flame sprites that flicker and lean with the wind,
 * rising embers, a warm glow at the base, and a share of the scene's fire light budget
 * (`FireLightBudget`: at most one point light per three fires).
 */
export function Fire({ position, scale = 1, seed = 1, intensity = 1, budget = defaultFireBudget }: FireProps) {
  const id = useId()
  const reduced = useReducedMotion()
  const particles = useParticlesScale()
  const tongueCount = scaleCount(reduced ? 4 : 7, particles)
  const emberCount = scaleCount(reduced ? 6 : 14, particles)
  const flames = useRef<THREE.InstancedMesh>(null)
  const embers = useRef<THREE.InstancedMesh>(null)
  const glow = useRef<THREE.InstancedMesh>(null)
  const flameMat = useMemo(() => makeSpriteMaterial('flame'), [])
  const glowMat = useMemo(() => makeSpriteMaterial('glow', { color: '#ff7a1a', upright: 0 }), [])
  const emberMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#ff7a24', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    [],
  )
  const tongues = useMemo(() => makeTongues(seed, tongueCount, scale), [seed, tongueCount, scale])
  const emberOpts = useMemo<EmberOptions>(
    () => ({ count: emberCount, seed: seed * 7 + 3, life: reduced ? 1.2 : 1.9, height: 1.5 * scale, wander: 0.12 * scale, wind: WIND, radius: 0.14 * scale }),
    [emberCount, seed, scale, reduced],
  )
  const emberSeedArr = useMemo(() => emberSeeds(emberOpts), [emberOpts])
  useEffect(() => () => void (flameMat.dispose(), glowMat.dispose(), emberMat.dispose(), disposeParams(flames.current), disposeParams(glow.current)), [flameMat, glowMat, emberMat])

  // Light budget registration. The oldest live fire renders the shared lights.
  useEffect(() => budget.register(id, position, intensity * scale), [budget, id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => budget.update(id, position, intensity * scale), [budget, id, position, intensity, scale])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const fm = flames.current
    if (fm) {
      const attr = attachParams(fm, tongueCount)
      flameMat.uniforms.uTime.value = t
      flameMat.uniforms.uIntensity.value = intensity
      for (let i = 0; i < tongues.length; i++) {
        const g = tongues[i]
        const flick = 0.82 + 0.18 * Math.sin(t * 9.3 + g.phase) * Math.sin(t * 5.1 + g.phase * 1.7)
        const gust = 0.5 + 0.5 * Math.sin(t * 0.9 + g.phase)
        const lean = 0.18 * gust * scale
        const h = g.h * flick * (0.4 + 0.6 * intensity)
        tmpObj.position.set(g.x + WIND[0] * lean, 0, g.z + WIND[1] * lean)
        tmpObj.rotation.set(0, 0, 0)
        tmpObj.scale.set(g.w * (0.85 + 0.15 * gust), h, 1)
        tmpObj.updateMatrix()
        fm.setMatrixAt(i, tmpObj.matrix)
        attr.setXYZW(i, Math.min(1, intensity * (i < 2 ? 1 : 0.8)), 0, g.seed, 0)
      }
      fm.instanceMatrix.needsUpdate = true
      attr.needsUpdate = true
    }
    const gm = glow.current
    if (gm) {
      const a = attachParams(gm, 1)
      const pulse = 0.85 + 0.15 * Math.sin(t * 7 + seed)
      tmpObj.position.set(0, 0.25 * scale, 0)
      tmpObj.rotation.set(0, 0, 0)
      tmpObj.scale.setScalar(1.6 * scale * pulse)
      tmpObj.updateMatrix()
      gm.setMatrixAt(0, tmpObj.matrix)
      a.setXYZW(0, 0.55 * intensity, 0, seed, 0)
      gm.instanceMatrix.needsUpdate = true
      a.needsUpdate = true
      glowMat.uniforms.uIntensity.value = 1.2
    }
    const em = embers.current
    if (em) {
      for (let i = 0; i < emberCount; i++) {
        const s = emberAt(i, t, emberSeedArr, emberOpts)
        tmpObj.position.set(s.x, 0.3 * scale + s.y, s.z)
        const sz = Math.max(0.0001, 0.011 * scale * s.size * s.glow * intensity)
        tmpObj.scale.set(sz, sz * 1.6, sz)
        tmpObj.updateMatrix()
        em.setMatrixAt(i, tmpObj.matrix)
      }
      em.instanceMatrix.needsUpdate = true
      emberMat.opacity = Math.min(1, intensity * 1.2)
    }
  })

  if (intensity <= 0) return null
  return (
    <group position={position}>
      <instancedMesh ref={glow} args={[spriteQuad(), glowMat, 1]} frustumCulled={false} renderOrder={20} />
      <instancedMesh ref={flames} args={[spriteQuad(), flameMat, tongueCount]} frustumCulled={false} renderOrder={22} />
      <instancedMesh ref={embers} args={[undefined, emberMat, emberCount]} frustumCulled={false} renderOrder={23}>
        <sphereGeometry args={[1, 5, 4]} />
      </instancedMesh>
    </group>
  )
}

/**
 * The shared fire point lights. Always mounts `MAX_FIRE_LIGHTS` lights (unused ones at zero
 * intensity) so three.js never has to recompile every material when the fire count changes.
 */
export function FireLights({ budget = defaultFireBudget }: { budget?: FireLightBudget }) {
  const lights = useRef<(THREE.PointLight | null)[]>([])
  const reduced = useReducedMotion()
  const parent = useRef<THREE.Group>(null)
  const world = useRef(new THREE.Vector3())
  useFrame(({ clock }) => {
    const plan = budget.lights()
    const t = clock.elapsedTime
    const p = parent.current
    for (let i = 0; i < MAX_FIRE_LIGHTS; i++) {
      const l = lights.current[i]
      if (!l) continue
      const src = plan[i]
      // never toggle `visible`: the scene's point-light count must stay constant or three recompiles every program
      if (!src) {
        l.intensity = 0
        continue
      }
      world.current.set(src.position[0], src.position[1] + 0.7, src.position[2])
      if (p) p.worldToLocal(world.current)
      l.position.lerp(world.current, 0.2)
      const flick = reduced ? 1 : 0.8 + 0.2 * Math.sin(t * 11 + i * 2.3) * Math.sin(t * 6.7 + i)
      l.intensity = Math.min(5, 1.6 * src.intensity) * flick * 2
      l.distance = 4.5 + Math.min(4, src.fires.length) * 1.2
    }
  })
  return (
    <group ref={parent}>
      {Array.from({ length: MAX_FIRE_LIGHTS }, (_, i) => (
        <pointLight
          key={i}
          ref={(el) => {
            lights.current[i] = el
          }}
          color="#ff8a2a"
          intensity={0}
          distance={6}
          decay={2}
        />
      ))}
    </group>
  )
}
