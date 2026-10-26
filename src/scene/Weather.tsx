import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import { useParticlesScale } from '../perf/store'
import { seededRandom } from '../vfx/random'
import { sampleWaveHeight } from './waves'

/** Lightning strike info passed to `onLightning` (and used by the scene for the flash). */
export interface LightningStrike {
  /** Seconds since the scene clock started. */
  time: number
  /** Unit direction toward the strike from the cove centre. */
  direction: THREE.Vector3
  /** 0..1 — how close/loud the strike is. */
  intensity: number
}

export interface LightningState {
  flash: number
  dir: THREE.Vector3
}

/**
 * Drives lightning for a storm: schedules seeded strikes, decays the flash each frame and
 * reports strikes through `onLightning` so audio can play a rumble.
 */
export function useLightning(storm: number, onLightning?: (strike: LightningStrike) => void): LightningState {
  const state = useMemo<LightningState>(() => ({ flash: 0, dir: new THREE.Vector3(0.3, 0.6, -0.7).normalize() }), [])
  const next = useRef(-1)
  const rnd = useMemo(() => seededRandom(1313), [])
  const cb = useRef(onLightning)
  cb.current = onLightning
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  useFrame((three, dt) => {
    const t = three.clock.elapsedTime
    if (storm <= 0) {
      state.flash = 0
      next.current = -1
      return
    }
    if (next.current < 0) next.current = t + 1.5 + rnd() * 2
    if (t >= next.current) {
      const intensity = 0.5 + rnd() * 0.5
      state.flash = reducedMotion ? 0.35 : intensity
      const a = rnd() * Math.PI * 2
      state.dir.set(Math.cos(a) * 0.8, 0.45 + rnd() * 0.3, Math.sin(a) * 0.8).normalize()
      next.current = t + 3 + rnd() * 7
      cb.current?.({ time: t, direction: state.dir.clone(), intensity })
      return // render the full flash this frame
    }
    // sharp attack, exponential decay with a small secondary flicker; dt is clamped so the
    // flash still spans a few frames when the frame rate is low
    state.flash = Math.max(0, state.flash - Math.min(dt, 1 / 30) * 3.2) * (1 - 0.3 * Math.max(0, Math.sin(t * 60)) * (state.flash > 0.3 ? 1 : 0))
  })
  return state
}

/** Rain streaks falling around the camera, with a bias in the wind direction. */
export function Rain({ storm, quality }: { storm: number; quality: 'low' | 'high' }) {
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const particlesScale = useParticlesScale()
  const count = Math.round((quality === 'high' ? 2600 : 900) * (reducedMotion ? 0.4 : 1) * particlesScale)
  const camera = useThree((s) => s.camera)
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 6)
    const seed = new Float32Array(count * 2)
    const rnd = seededRandom(909)
    for (let i = 0; i < count; i++) {
      const x = (rnd() - 0.5) * 70
      const y = rnd() * 40
      const z = (rnd() - 0.5) * 70
      pos.set([x, y, z, x + 0.16, y - 0.9, z + 0.06], i * 6)
      seed[i * 2] = rnd()
      seed[i * 2 + 1] = rnd()
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2).setUsage(THREE.StaticDrawUsage))
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 80)
    return g
  }, [count])
  useEffect(() => () => geometry.dispose(), [geometry])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uCenter: { value: new THREE.Vector3() } },
        vertexShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uCenter;
          varying float vFade;
          void main() {
            vec3 p = position;
            // wrap each drop inside a 70x40x70 box that follows the camera
            p.y = mod(p.y - uTime * 28.0, 40.0);
            p.x += uTime * 4.0;
            p.x = mod(p.x + 35.0, 70.0) - 35.0;
            p += vec3(uCenter.x, 0.0, uCenter.z);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            vFade = 1.0 - smoothstep(20.0, 45.0, length(mv.xyz));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uOpacity;
          varying float vFade;
          void main() { gl_FragColor = vec4(0.75, 0.82, 0.95, uOpacity * vFade * 0.35); }`,
      }),
    [],
  )
  useFrame((state) => {
    material.uniforms.uTime.value = state.clock.elapsedTime
    material.uniforms.uOpacity.value = storm
    material.uniforms.uCenter.value.copy(camera.position)
  })
  if (storm <= 0.01) return null
  return <lineSegments geometry={geometry} material={material} frustumCulled={false} renderOrder={5} />
}

/** Gulls: flap, bank into turns, and sit lower when it storms. */
export function Gulls({ count = 7, storm = 0 }: { count?: number; storm?: number }) {
  const group = useRef<THREE.Group>(null)
  const birds = useMemo(() => {
    const rnd = seededRandom(3)
    return Array.from({ length: count }, (_, i) => ({
      offset: i * 1.1 + rnd() * 0.5,
      height: 18 + rnd() * 10,
      radius: 26 + rnd() * 20,
      flap: 5 + rnd() * 3,
      phase: rnd() * Math.PI * 2,
      cx: (rnd() - 0.5) * 40,
      cz: -40 + (rnd() - 0.5) * 24,
      dir: rnd() > 0.5 ? 1 : -1,
    }))
  }, [count])
  const body = useMemo(() => new THREE.MeshStandardMaterial({ color: '#eef1f4', roughness: 0.8 }), [])
  const tip = useMemo(() => new THREE.MeshStandardMaterial({ color: '#222a33', roughness: 0.8 }), [])
  useFrame((state) => {
    const g = group.current
    if (!g) return
    const t = state.clock.elapsedTime
    g.children.forEach((bird, i) => {
      const b = birds[i]
      const a = (t * 0.08 + b.offset) * b.dir
      const h = b.height * (1 - storm * 0.5)
      bird.position.set(b.cx + Math.cos(a) * b.radius, h + Math.sin(t * 0.6 + b.phase) * 1.4, b.cz + Math.sin(a) * b.radius * 0.7)
      bird.rotation.set(0, -a * b.dir + (b.dir > 0 ? Math.PI / 2 : -Math.PI / 2), 0.25 * b.dir)
      // glide for a while, then a burst of flaps
      const cycle = Math.sin(t * 0.35 + b.phase)
      const wing = cycle > 0.2 ? Math.sin(t * b.flap + b.phase) * 0.8 : 0.15 + Math.sin(t * 1.5 + b.phase) * 0.05
      const [left, right] = [bird.children[1], bird.children[2]]
      left.rotation.z = wing
      right.rotation.z = -wing
    })
  })
  return (
    <group ref={group}>
      {birds.map((_, i) => (
        <group key={i}>
          <mesh material={body} rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.1, 0.5, 3, 6]} />
          </mesh>
          {[1, -1].map((s) => (
            <group key={s} position={[0, 0, 0]}>
              <mesh material={body} position={[0, 0, s * 0.55]} rotation={[0, 0, 0]}>
                <boxGeometry args={[0.36, 0.03, 1.1]} />
              </mesh>
              <mesh material={tip} position={[-0.05, 0, s * 1.2]} rotation={[0, s * 0.3, 0]}>
                <boxGeometry args={[0.28, 0.025, 0.4]} />
              </mesh>
            </group>
          ))}
          <mesh material={tip} position={[0.42, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
            <coneGeometry args={[0.05, 0.22, 5]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** A pod of dolphins that breaches out of the cove mouth every so often. */
export function Dolphins({ storm = 0 }: { storm?: number }) {
  const group = useRef<THREE.Group>(null)
  const pod = useMemo(
    () => [
      { lead: 0, side: 0 },
      { lead: 0.9, side: 2.2 },
      { lead: 1.6, side: -2.4 },
    ],
    [],
  )
  const skin = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5f7585', roughness: 0.35, metalness: 0.05 }), [])
  const belly = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c9d4d8', roughness: 0.4 }), [])
  const bodyGeo = useMemo(() => {
    const g = new THREE.CapsuleGeometry(0.28, 1.5, 6, 10)
    g.rotateZ(Math.PI / 2)
    const pos = g.attributes.position as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const k = x > 0 ? 1 - x * 0.35 : 1 - Math.abs(x) * 0.5
      pos.setY(i, pos.getY(i) * Math.max(0.15, k))
      pos.setZ(i, pos.getZ(i) * Math.max(0.15, k))
    }
    g.computeVertexNormals()
    return g
  }, [])
  const PERIOD = 26
  useFrame((state) => {
    const g = group.current
    if (!g) return
    const t = state.clock.elapsedTime
    g.visible = storm < 0.5
    const cycle = (t % PERIOD) / PERIOD
    // travel along a line across the cove mouth, arcing out of the water three times
    const px = -40 + cycle * 80
    g.children.forEach((d, i) => {
      const p = pod[i]
      const x = px - p.lead * 3
      const z = -46 + p.side
      const phase = (x / 80) * Math.PI * 2 * 3 + p.lead
      const arc = Math.sin(phase)
      const surface = sampleWaveHeight(x, z, t)
      const y = surface + (arc > 0 ? arc * 2.4 : arc * 1.4) - 0.3
      d.position.set(x, y, z)
      d.rotation.set(0, 0, Math.cos(phase) * 0.9)
    })
  })
  return (
    <group ref={group}>
      {pod.map((_, i) => (
        <group key={i}>
          <mesh geometry={bodyGeo} material={skin} />
          <mesh material={belly} position={[0.1, -0.12, 0]} scale={[0.8, 0.5, 0.7]}>
            <capsuleGeometry args={[0.26, 1.3, 4, 8]} />
          </mesh>
          <mesh material={skin} position={[0.1, 0.35, 0]} rotation={[0, 0, -0.5]}>
            <coneGeometry args={[0.14, 0.45, 3]} />
          </mesh>
          <mesh material={skin} position={[-1.05, 0, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.25]}>
            <coneGeometry args={[0.35, 0.5, 4]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}
