import { useFrame } from '@react-three/fiber'
import { useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { scaleCount, useParticlesScale } from '../../perf/store'
import { emberAt, emberSeeds, type EmberOptions } from './embers'
import { makeTongues, type Tongue } from './Fire'
import { defaultFireBudget, type FireLightBudget } from './fireBudget'
import { smokePuffAt, smokeSeeds, type SmokePlumeOptions } from './smoke'
import { attachParams, disposeParams, makeSpriteMaterial, spriteQuad } from './sprites'
import { useReducedMotion } from './useReducedMotion'
import { WIND } from './wind'

/**
 * Shared particle systems for every burning / smouldering cell in a layer. One `<Fires>` is three
 * draw calls (glow, flames, embers) and one `<Smokes>` is one draw call, however many emitters they
 * hold — instead of one `<Fire>`/`<Smoke>` (3 + 1 draws, 4 materials) per hit cell. Capacity is
 * fixed (`EMITTER_CAP` emitters); the instanced buffers are allocated once and `count` is set per
 * frame, so nothing is created per shot. Materials are disposed on unmount.
 */
export const EMITTER_CAP = 200

export interface FireEmitter {
  key: string
  position: Vec3
  /** 1 = a burning deck section. */
  scale?: number
  seed?: number
  /** 0 = out, 1 = full blaze. */
  intensity?: number
}

export interface SmokeEmitter {
  key: string
  position: Vec3
  scale?: number
  seed?: number
  intensity?: number
}

const tmpObj = new THREE.Object3D()

interface FireSlot {
  e: FireEmitter
  scale: number
  intensity: number
  tongues: Tongue[]
  emberOpts: EmberOptions
  emberSeeds: Float32Array
}

export function Fires({ emitters, budget = defaultFireBudget }: { emitters: readonly FireEmitter[]; budget?: FireLightBudget }) {
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
  const emberGeo = useMemo(() => new THREE.SphereGeometry(1, 5, 4), [])
  useLayoutEffect(
    () => () => {
      flameMat.dispose()
      glowMat.dispose()
      emberMat.dispose()
      emberGeo.dispose()
      disposeParams(flames.current)
      disposeParams(glow.current)
    },
    [flameMat, glowMat, emberMat, emberGeo],
  )

  const slots = useMemo<FireSlot[]>(
    () =>
      emitters.slice(0, EMITTER_CAP).map((e) => {
        const scale = e.scale ?? 1
        const seed = e.seed ?? 1
        const emberOpts: EmberOptions = { count: emberCount, seed: seed * 7 + 3, life: reduced ? 1.2 : 1.9, height: 1.5 * scale, wander: 0.12 * scale, wind: WIND, radius: 0.14 * scale }
        return { e, scale, intensity: e.intensity ?? 1, tongues: makeTongues(seed, tongueCount, scale), emberOpts, emberSeeds: emberSeeds(emberOpts) }
      }),
    [emitters, tongueCount, emberCount, reduced],
  )

  // Light budget: one registration per emitter, keyed by this layer + emitter key.
  const registered = useRef(new Map<string, () => void>())
  useEffect(() => {
    const live = new Set<string>()
    for (const s of slots) {
      const k = `${id}:${s.e.key}`
      live.add(k)
      if (registered.current.has(k)) budget.update(k, s.e.position, s.intensity * s.scale)
      else registered.current.set(k, budget.register(k, s.e.position, s.intensity * s.scale))
    }
    for (const [k, off] of registered.current) {
      if (live.has(k)) continue
      off()
      registered.current.delete(k)
    }
  }, [slots, budget, id])
  useEffect(() => {
    const reg = registered.current
    return () => {
      for (const off of reg.values()) off()
      reg.clear()
    }
  }, [budget])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const n = slots.length
    const fm = flames.current
    const gm = glow.current
    const em = embers.current
    if (!fm || !gm || !em) return
    const fa = attachParams(fm, EMITTER_CAP * tongueCount)
    const ga = attachParams(gm, EMITTER_CAP)
    flameMat.uniforms.uTime.value = t
    flameMat.uniforms.uIntensity.value = 1
    glowMat.uniforms.uIntensity.value = 1.2
    let fi = 0
    let ei = 0
    for (let s = 0; s < n; s++) {
      const slot = slots[s]
      const [px, py, pz] = slot.e.position
      const { scale, intensity, tongues } = slot
      for (let i = 0; i < tongues.length; i++) {
        const g = tongues[i]
        const flick = 0.82 + 0.18 * Math.sin(t * 9.3 + g.phase) * Math.sin(t * 5.1 + g.phase * 1.7)
        const gust = 0.5 + 0.5 * Math.sin(t * 0.9 + g.phase)
        const lean = 0.18 * gust * scale
        const h = g.h * flick * (0.4 + 0.6 * intensity)
        tmpObj.position.set(px + g.x + WIND[0] * lean, py, pz + g.z + WIND[1] * lean)
        tmpObj.rotation.set(0, 0, 0)
        tmpObj.scale.set(g.w * (0.85 + 0.15 * gust), h, 1)
        tmpObj.updateMatrix()
        fm.setMatrixAt(fi, tmpObj.matrix)
        fa.setXYZW(fi, Math.min(1, intensity * (i < 2 ? 1 : 0.8)), 0, g.seed, 0)
        fi++
      }
      const seed = slot.e.seed ?? 1
      const pulse = 0.85 + 0.15 * Math.sin(t * 7 + seed)
      tmpObj.position.set(px, py + 0.25 * scale, pz)
      tmpObj.rotation.set(0, 0, 0)
      tmpObj.scale.setScalar(1.6 * scale * pulse)
      tmpObj.updateMatrix()
      gm.setMatrixAt(s, tmpObj.matrix)
      ga.setXYZW(s, 0.55 * intensity, 0, seed, 0)
      for (let i = 0; i < emberCount; i++) {
        const e = emberAt(i, t, slot.emberSeeds, slot.emberOpts)
        tmpObj.position.set(px + e.x, py + 0.3 * scale + e.y, pz + e.z)
        const sz = Math.max(0.0001, 0.011 * scale * e.size * e.glow * intensity)
        tmpObj.scale.set(sz, sz * 1.6, sz)
        tmpObj.updateMatrix()
        em.setMatrixAt(ei++, tmpObj.matrix)
      }
    }
    fm.count = fi
    gm.count = n
    em.count = ei
    fm.instanceMatrix.needsUpdate = true
    gm.instanceMatrix.needsUpdate = true
    em.instanceMatrix.needsUpdate = true
    fa.needsUpdate = true
    ga.needsUpdate = true
    fm.visible = gm.visible = em.visible = n > 0
  })

  return (
    <group name="fires">
      <instancedMesh ref={glow} args={[spriteQuad(), glowMat, EMITTER_CAP]} frustumCulled={false} renderOrder={20} />
      <instancedMesh ref={flames} args={[spriteQuad(), flameMat, EMITTER_CAP * tongueCount]} frustumCulled={false} renderOrder={22} />
      <instancedMesh ref={embers} args={[emberGeo, emberMat, EMITTER_CAP * emberCount]} frustumCulled={false} renderOrder={23} />
    </group>
  )
}

interface SmokeSlot {
  e: SmokeEmitter
  intensity: number
  opts: SmokePlumeOptions
  seeds: Float32Array
}

export interface SmokesProps {
  emitters: readonly SmokeEmitter[]
  color?: string
  /** Puffs per emitter (default 14, 8 with reduced motion). */
  count?: number
}

export function Smokes({ emitters, color = '#2f2b28', count }: SmokesProps) {
  const reduced = useReducedMotion()
  const particles = useParticlesScale()
  const n = count ?? scaleCount(reduced ? 8 : 14, particles)
  const mesh = useRef<THREE.InstancedMesh>(null)
  const mat = useMemo(() => makeSpriteMaterial('smoke', { color, opacity: 0.75 }), [color])
  // layout cleanup: runs before React detaches the child refs, so the meshes (and their aParam geometry clones) are still reachable
  useLayoutEffect(() => () => void (mat.dispose(), disposeParams(mesh.current)), [mat])
  const slots = useMemo<SmokeSlot[]>(
    () =>
      emitters.slice(0, EMITTER_CAP).map((e) => {
        const scale = e.scale ?? 1
        const opts: SmokePlumeOptions = { count: n, seed: e.seed ?? 2, life: reduced ? 3.2 : 4.6, height: 3.4 * scale, wind: WIND, radius: [0.16 * scale, 0.75 * scale], wander: 0.14 * scale }
        return { e, intensity: e.intensity ?? 1, opts, seeds: smokeSeeds(opts) }
      }),
    [emitters, n, reduced],
  )

  useFrame(({ clock }) => {
    const m = mesh.current
    if (!m) return
    const a = attachParams(m, EMITTER_CAP * n)
    const t = clock.elapsedTime
    mat.uniforms.uTime.value = t
    let k = 0
    for (const slot of slots) {
      const [px, py, pz] = slot.e.position
      for (let i = 0; i < n; i++) {
        const s = smokePuffAt(i, t, slot.seeds, slot.opts)
        tmpObj.position.set(px + s.x, py + s.y, pz + s.z)
        tmpObj.rotation.set(0, 0, 0)
        tmpObj.scale.setScalar(Math.max(0.0001, s.radius * 2))
        tmpObj.updateMatrix()
        m.setMatrixAt(k, tmpObj.matrix)
        a.setXYZW(k, s.alpha * slot.intensity, s.spin, slot.seeds[i * 4 + 1] * 0.1, 0)
        k++
      }
    }
    m.count = k
    m.visible = k > 0
    m.instanceMatrix.needsUpdate = true
    a.needsUpdate = true
  })

  return <instancedMesh ref={mesh} args={[spriteQuad(), mat, EMITTER_CAP * n]} frustumCulled={false} renderOrder={18} />
}
