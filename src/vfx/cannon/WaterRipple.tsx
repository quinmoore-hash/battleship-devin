import { useFrame } from '@react-three/fiber'
import { useMemo, useRef , useEffect} from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { useReducedMotion } from './motion'
import { useEffectTimeline } from './timeline'

export interface WaterRippleProps {
  /** Point on the water surface. The decal floats a few cm above it. */
  position: Vec3
  /** Final radius of the outermost ring. */
  radius?: number
  duration?: number
  delay?: number
  /** Number of concentric rings. */
  rings?: number
  onDone?: () => void
}

const vertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const fragment = /* glsl */ `
  uniform float uT;
  uniform float uRings;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float front = uT;
    if (r > front || r > 0.98) discard;
    float phase = (front - r) * uRings * 3.14159;
    float ring = pow(max(sin(phase), 0.0), 3.0);
    float trail = smoothstep(0.0, 0.08, front - r) * pow(1.0 - (front - r) / max(front, 1e-3), 0.8);
    float a = ring * trail * (1.0 - uT) * (1.0 - uT) * 0.55;
    gl_FragColor = vec4(vec3(0.9, 0.97, 1.0), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** Concentric ripples expanding on the surface from a point, fading as they spread. Reusable decal. */
export function WaterRipple({ position, radius = 3, duration = 3, delay = 0, rings = 4, onDone }: WaterRippleProps) {
  const reduced = useReducedMotion()
  const total = reduced ? duration * 0.6 : duration
  const tl = useEffectTimeline(delay + total, { onDone })
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uT: { value: 0 }, uRings: { value: rings } },
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        side: THREE.DoubleSide,
      }),
    [rings],
  )
  useEffect(() => () => material.dispose(), [material])

  const mesh = useRef<THREE.Mesh>(null)
  useFrame(() => {
    const t = (tl.t - delay) / total
    const m = mesh.current
    if (!m) return
    ;(m.material as THREE.ShaderMaterial).uniforms.uT.value = t
    m.visible = t > 0 && t < 1
  })
  return (
    <mesh ref={mesh} material={material} position={[position[0], position[1] + 0.05, position[2]]} rotation-x={-Math.PI / 2} scale={radius * 2} renderOrder={5} visible={false} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  )
}
