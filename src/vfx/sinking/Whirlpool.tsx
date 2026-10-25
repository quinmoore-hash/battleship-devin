import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useGameStore } from '../../store/gameStore'
import { clamp01 } from '../math'
import { window01 } from './pose'

/** Suction strength: opens as the hull goes under, spins hardest just after, and smooths out. */
export function whirlpoolStrength(progress: number): number {
  const p = clamp01(progress)
  return window01(p, 0.5, 0.74) * (1 - window01(p, 0.86, 1))
}

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const frag = /* glsl */ `
  uniform float uTime;
  uniform float uStrength;
  uniform vec3 uFoam;
  uniform vec3 uDeep;
  varying vec2 vUv;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    vec2 c = vUv * 2.0 - 1.0;
    float r = length(c);
    if (r > 1.0) discard;
    float ang = atan(c.y, c.x);
    // two interleaved spiral arms that tighten toward the centre and spin with time
    float arm = sin(ang * 2.0 - r * 14.0 + uTime * 4.0 + noise(c * 3.0 + uTime * 0.2) * 1.6);
    float lines = smoothstep(0.72, 0.98, arm) * (0.25 + 0.5 * (1.0 - r)) * smoothstep(0.08, 0.3, r);
    float rim = smoothstep(0.8, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r)) * (0.5 + 0.5 * noise(vec2(ang * 3.0, uTime)));
    float eye = 1.0 - smoothstep(0.0, 0.4, r);
    float fade = 1.0 - smoothstep(0.7, 1.0, r);
    vec3 color = mix(uDeep, uFoam, clamp(lines * 1.3 + rim, 0.0, 1.0) * (1.0 - eye * 0.7));
    float a = (lines * 0.5 + rim * 0.35 + eye * 0.7) * fade * uStrength;
    gl_FragColor = vec4(color, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface WhirlpoolProps {
  progress: number
  /** Metres; roughly the hull length. */
  radius: number
  timeScale?: number
  waterY?: number
}

/** Spinning suction ripple on the surface where the hull went under. */
export function Whirlpool({ progress, radius, timeScale = 1, waterY = 0 }: WhirlpoolProps) {
  const reduced = useGameStore((s) => s.settings.reducedMotion)
  const mesh = useRef<THREE.Mesh>(null)
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: { uTime: { value: 0 }, uStrength: { value: 0 }, uFoam: { value: new THREE.Color('#e8f4f8') }, uDeep: { value: new THREE.Color('#06304a') } },
        transparent: true,
        depthWrite: false,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  const t = useRef(0)
  useFrame((_, delta) => {
    t.current += Math.min(delta, 0.1) * timeScale * (reduced ? 0.5 : 1)
    const s = whirlpoolStrength(progress) * (reduced ? 0.6 : 1)
    material.uniforms.uTime.value = t.current
    material.uniforms.uStrength.value = s
    const m = mesh.current
    if (m) {
      m.position.y = waterY + 0.03
      m.scale.setScalar(radius * (0.55 + 0.45 * s))
      m.visible = s > 0.001
    }
  })
  return (
    <mesh ref={mesh} material={material} rotation-x={-Math.PI / 2} renderOrder={2} frustumCulled={false}>
      <circleGeometry args={[1, 72]} />
    </mesh>
  )
}
