import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { easeInCubic, easeOutCubic } from '../math'
import { seededRandom } from '../random'
import { FoamRing } from './FoamRing'
import { DEFAULT_WIND, useReducedMotion } from './motion'
import { useParticlesScale } from '../../perf/store'
import { SpriteCloud, type SpriteCloudHandle } from './SpriteCloud'
import { noiseTexture, smokeTexture, sprayTexture } from './textures'
import { useEffectTimeline } from './timeline'
import { WaterRipple } from './WaterRipple'

export interface SplashProps {
  /** Impact point on the water (y = surface). */
  position: Vec3
  seed?: number
  /** 1 = a cannonball. Scales height, radius and particle spread. */
  scale?: number
  delay?: number
  wind?: Vec3
  onDone?: () => void
}

const G = 9.8
const SPLASH_DURATION = 3
const COLUMN = { rise: 0.42, hold: 0.75, fall: 1.65 }

const columnVertex = /* glsl */ `
  uniform float uHeight;
  uniform float uRadius;
  uniform float uTime;
  uniform float uCollapse;
  uniform float uSeed;
  uniform sampler2D uNoise;
  varying float vH;
  varying float vNoise;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    float h = position.y;
    float ang = atan(position.z, position.x);
    float n = texture2D(uNoise, vec2(ang / 6.2831853 + uSeed, h * 0.7 - uTime * 0.5)).r;
    float n2 = texture2D(uNoise, vec2(ang / 6.2831853 * 2.0 + uSeed * 1.7, h * 1.4 - uTime * 0.9)).g;
    float profile = (1.0 - 0.62 * h) + 0.45 * h * h * uCollapse;
    float r = uRadius * profile * (0.7 + 0.55 * n + 0.2 * n2);
    vec3 p = vec3(cos(ang) * r, h * uHeight, sin(ang) * r);
    p.x += (n - 0.5) * 0.35 * h * uRadius;
    p.z += (n2 - 0.5) * 0.35 * h * uRadius;
    vH = h;
    vNoise = n;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * vec3(cos(ang), 0.3 + 0.5 * h, sin(ang)));
    vViewDir = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`
const columnFragment = /* glsl */ `
  uniform float uFade;
  uniform float uTop;
  varying float vH;
  varying float vNoise;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    float facing = abs(dot(normalize(vNormalW), normalize(vViewDir)));
    float rim = pow(1.0 - facing, 1.6);
    float ragged = 1.0 - smoothstep(uTop - 0.15, uTop + 0.2, vH + (vNoise - 0.5) * 0.45);
    vec3 deep = vec3(0.30, 0.58, 0.66);
    vec3 foam = vec3(0.96, 0.98, 1.0);
    vec3 col = mix(deep, foam, clamp(vH * 1.1 + vNoise * 0.7 - 0.25, 0.0, 1.0));
    col += rim * 0.2;
    float breakup = smoothstep(0.15, 0.75, vNoise + 0.35 * (1.0 - vH));
    float a = (0.75 - 0.35 * vH) * ragged * uFade * (1.0 - 0.8 * rim) * breakup;
    if (a < 0.01) discard;
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

interface Drop {
  delay: number
  x0: number
  z0: number
  vx: number
  vy: number
  vz: number
  size: number
  land: number
  rot: number
  tint: number
}

/** Seconds until a particle launched upward at `vy` from height `y0` is back at the surface. */
const landingTime = (vy: number, y0: number) => (vy + Math.sqrt(vy * vy + 2 * G * y0)) / G

function makeDrops(rnd: () => number, count: number, delay: [number, number], up: [number, number], out: [number, number], size: [number, number], scale: number): Drop[] {
  return Array.from({ length: count }, () => {
    const a = rnd() * Math.PI * 2
    const r = rnd() * 0.25 * scale
    const vUp = (up[0] + rnd() * (up[1] - up[0])) * Math.sqrt(scale)
    const vOut = (out[0] + rnd() * (out[1] - out[0])) * scale
    const y0 = 0.1 + rnd() * 0.6 * scale
    return {
      delay: delay[0] + rnd() * (delay[1] - delay[0]),
      x0: Math.cos(a) * r,
      z0: Math.sin(a) * r,
      vx: Math.cos(a) * vOut,
      vy: vUp,
      vz: Math.sin(a) * vOut,
      size: (size[0] + rnd() * (size[1] - size[0])) * scale,
      land: landingTime(vUp, y0) + 0.05,
      rot: rnd() * Math.PI * 2,
      tint: rnd(),
    }
  })
}

const tmpObj = new THREE.Object3D()
const DROPLET_GEOMETRY = new THREE.SphereGeometry(1, 8, 6)
let dropletMaterial: THREE.MeshStandardMaterial | null = null
const getDropletMaterial = () =>
  (dropletMaterial ??= new THREE.MeshStandardMaterial({ color: '#e6f4fb', emissive: '#8cc4dc', emissiveIntensity: 0.9, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.8 }))

/**
 * A cannonball missing into the sea: a tall water column that shoots up, breaks apart and collapses, a
 * crown of spray, droplets that fall back with gravity, lingering mist, an expanding foam ring and
 * ripples on the surface. Reads well from the overview camera (column + ring) and close up (droplets).
 */
export function Splash({ position, seed = 1, scale = 1, delay = 0, wind = DEFAULT_WIND, onDone }: SplashProps) {
  const reduced = useReducedMotion()
  const total = reduced ? SPLASH_DURATION * 0.65 : SPLASH_DURATION
  const tl = useEffectTimeline(delay + total, { onDone })
  const density = (reduced ? 0.4 : 1) * useParticlesScale()
  const spray = useMemo(() => {
    const rnd = seededRandom(seed * 13 + 5)
    return [
      ...makeDrops(rnd, Math.round(34 * density), [0, 0.3], [4.5, 9.5], [0.3, 2.2], [0.05, 0.16], scale),
      ...makeDrops(rnd, Math.round(16 * density), [COLUMN.hold + 0.1, COLUMN.hold + 0.5], [1.2, 3], [1, 3.2], [0.08, 0.2], scale),
    ]
  }, [seed, density, scale])
  const droplets = useMemo(() => makeDrops(seededRandom(seed * 17 + 3), Math.round(60 * density), [0.02, 0.4], [3.5, 8.5], [0.4, 2.6], [0.014, 0.04], scale), [seed, density, scale])
  const mist = useMemo(() => makeDrops(seededRandom(seed * 19 + 1), Math.round(14 * density), [0.1, 0.6], [0.6, 1.4], [0.1, 0.7], [0.6, 1.3], scale), [seed, density, scale])

  const column = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: columnVertex,
        fragmentShader: columnFragment,
        uniforms: {
          uHeight: { value: 0 },
          uRadius: { value: 0.27 * scale },
          uTime: { value: 0 },
          uCollapse: { value: 0 },
          uSeed: { value: (seed % 13) / 13 },
          uNoise: { value: noiseTexture() },
          uFade: { value: 0 },
          uTop: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [seed, scale],
  )
  const columnGeometry = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 40, 24, true).translate(0, 0.5, 0), [])

  const columnMesh = useRef<THREE.Mesh>(null)
  const sprayCloud = useRef<SpriteCloudHandle>(null)
  const mistCloud = useRef<SpriteCloudHandle>(null)
  const dropMesh = useRef<THREE.InstancedMesh>(null)

  useFrame(() => {
    const t = tl.t - delay
    const cm = columnMesh.current
    if (!cm) return
    const u = (cm.material as THREE.ShaderMaterial).uniforms
    const height = 2.3 * scale
    let h = 0
    let top = 1
    let collapse = 0
    if (t >= 0 && t < COLUMN.rise) h = height * easeOutCubic(t / COLUMN.rise)
    else if (t < COLUMN.hold) h = height * (1 + 0.04 * Math.sin((t - COLUMN.rise) * 9))
    else if (t < COLUMN.fall) {
      const k = (t - COLUMN.hold) / (COLUMN.fall - COLUMN.hold)
      h = height * (1 - easeInCubic(k) * 0.85)
      top = 1 - k * 1.1
      collapse = k
    }
    u.uHeight.value = h
    u.uTop.value = top
    u.uCollapse.value = collapse
    u.uTime.value = Math.max(0, t)
    u.uFade.value = t < 0 ? 0 : t < 0.1 ? t / 0.1 : t < COLUMN.fall ? 1 : Math.max(0, 1 - (t - COLUMN.fall) / 0.3)
    cm.visible = t >= 0 && t < COLUMN.fall + 0.3

    const sc = sprayCloud.current
    if (sc) {
      for (let i = 0; i < spray.length; i++) {
        const d = spray[i]
        const age = t - d.delay
        if (age < 0 || age > d.land) {
          sc.hide(i)
          continue
        }
        const k = age / d.land
        const y = position[1] + 0.1 + d.vy * age - 0.5 * G * age * age
        sc.write(i, position[0] + d.x0 + d.vx * age + wind[0] * age * 0.5, Math.max(position[1], y), position[2] + d.z0 + d.vz * age + wind[2] * age * 0.5, d.size * (1 + k * 1.8), 0.6 * Math.min(1, age / 0.05) * (1 - k * k), d.rot + age * 1.5, d.tint)
      }
      sc.commit()
    }
    const mc = mistCloud.current
    if (mc) {
      for (let i = 0; i < mist.length; i++) {
        const d = mist[i]
        const age = t - d.delay
        const life = total - d.delay
        if (age < 0 || age > life) {
          mc.hide(i)
          continue
        }
        const k = age / life
        mc.write(i, position[0] + d.x0 + d.vx * age * 0.4 + wind[0] * age, position[1] + 0.2 + d.vy * age * 0.5, position[2] + d.z0 + d.vz * age * 0.4 + wind[2] * age, d.size * (0.6 + k * 1.6), 0.32 * Math.min(1, age / 0.25) * Math.pow(1 - k, 1.4), d.rot + age * 0.3, d.tint)
      }
      mc.commit()
    }
    const dm = dropMesh.current
    if (dm) {
      for (let i = 0; i < droplets.length; i++) {
        const d = droplets[i]
        const age = t - d.delay
        if (age < 0 || age > d.land) {
          tmpObj.position.set(0, -1000, 0)
          tmpObj.scale.setScalar(0.0001)
        } else {
          const y = position[1] + 0.1 + d.vy * age - 0.5 * G * age * age
          tmpObj.position.set(position[0] + d.x0 + d.vx * age, Math.max(position[1], y), position[2] + d.z0 + d.vz * age)
          const stretch = 1 + Math.abs(d.vy - G * age) * 0.08
          tmpObj.scale.set(d.size, d.size * stretch, d.size)
        }
        tmpObj.updateMatrix()
        dm.setMatrixAt(i, tmpObj.matrix)
      }
      dm.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group>
      <mesh ref={columnMesh} geometry={columnGeometry} material={column} position={position} renderOrder={8} visible={false} frustumCulled={false} />
      <SpriteCloud ref={sprayCloud} count={spray.length} map={sprayTexture()} colorA="#cfe6f2" colorB="#ffffff" shading={0.4} renderOrder={13} />
      <SpriteCloud ref={mistCloud} count={mist.length} map={smokeTexture()} colorA="#bfd9e6" colorB="#f4fbff" shading={0.3} renderOrder={12} floorY={position[1] + 0.1} floorFade={0.7} />
      <instancedMesh ref={dropMesh} args={[DROPLET_GEOMETRY, getDropletMaterial(), droplets.length]} frustumCulled={false} castShadow />
      <FoamRing position={position} radius={2.4 * scale} delay={delay + 0.05} seed={seed} />
      <WaterRipple position={position} radius={3.6 * scale} delay={delay + 0.1} />
    </group>
  )
}
