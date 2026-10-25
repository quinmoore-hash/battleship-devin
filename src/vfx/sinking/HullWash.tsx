import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { clamp01 } from '../math'
import { window01 } from './pose'

/** Foam strength around the hull: rises while the ship lists, hangs, boils during the slide, gone when settled. */
export function washIntensity(progress: number): number {
  const p = clamp01(progress)
  const list = window01(p, 0.02, 0.3) * 0.55
  const slide = window01(p, 0.42, 0.62) * 0.6
  const fade = 1 - window01(p, 0.82, 0.96)
  return clamp01(list + slide) * fade
}

const vert = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const frag = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColor;
  varying vec2 vLocal;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.1 + 7.0; a *= 0.5; } return v; }
  void main() {
    float r = length(vLocal);            // 1.0 is the hull edge; ring spans 0.78..1.4
    float ang = atan(vLocal.y, vLocal.x);
    float band = smoothstep(0.78, 0.95, r) * (1.0 - smoothstep(1.0, 1.4, r));
    float n = fbm(vec2(ang * 2.2 + uTime * 0.25, r * 7.0 - uTime * 0.9));
    float streak = fbm(vec2(ang * 6.0 - uTime * 0.6, r * 3.0 + uTime * 0.3));
    float foam = smoothstep(0.42, 0.75, n * 0.7 + streak * 0.45);
    float edge = smoothstep(0.95, 1.0, r) * (1.0 - smoothstep(1.0, 1.08, r));
    float a = (foam * band * 0.85 + edge * 0.6) * uIntensity;
    gl_FragColor = vec4(uColor, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface HullWashProps {
  length: number
  beam: number
  progress: number
  /** Multiplies the simulation clock (slow motion). */
  timeScale?: number
  /** Live water level under the hull. */
  waterY?: number
}

/** Churning foam collar around the hull footprint, lying on the water (not tilted with the ship). */
export function HullWash({ length, beam, progress, timeScale = 1, waterY = 0 }: HullWashProps) {
  const group = useRef<THREE.Group>(null)
  const geom = useMemo(() => new THREE.RingGeometry(0.78, 1.4, 64, 3), [])
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vert,
        fragmentShader: frag,
        uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uColor: { value: new THREE.Color('#eef7fb') } },
        transparent: true,
        depthWrite: false,
      }),
    [],
  )
  useEffect(
    () => () => {
      material.dispose()
      geom.dispose()
    },
    [material, geom],
  )
  const t = useRef(0)
  useFrame((_, delta) => {
    t.current += Math.min(delta, 0.1) * timeScale
    material.uniforms.uTime.value = t.current
    material.uniforms.uIntensity.value = washIntensity(progress)
    if (group.current) group.current.position.y = waterY + 0.035
  })
  return (
    <group ref={group} rotation-x={-Math.PI / 2} scale={[length / 2 + 0.25, beam / 2 + 0.28, 1]}>
      <mesh geometry={geom} material={material} renderOrder={2} frustumCulled={false} />
    </group>
  )
}
