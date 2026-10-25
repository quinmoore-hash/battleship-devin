import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { useReducedMotion } from './motion'
import { noiseTexture } from './textures'
import { useEffectTimeline } from './timeline'

export interface FoamRingProps {
  position: Vec3
  /** Radius the foam reaches before fading. */
  radius?: number
  duration?: number
  delay?: number
  seed?: number
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
  uniform float uSeed;
  uniform sampler2D uNoise;
  varying vec2 vUv;
  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    float ang = atan(d.y, d.x) / 6.2831853 + 0.5;
    // ring radius eases out; its band thins as it spreads
    float k = 1.0 - pow(1.0 - uT, 3.0);
    float ring = 0.12 + 0.86 * k;
    float band = 0.22 - 0.1 * k;
    vec2 nUv = vec2(ang * 3.0 + uSeed, r * 1.5 - uT * 0.4);
    float n = texture2D(uNoise, nUv).r;
    float n2 = texture2D(uNoise, nUv * 2.7 + 0.37).g;
    float edge = ring + (n - 0.5) * 0.25;
    float outer = 1.0 - smoothstep(edge - 0.02, edge + 0.03, r);
    float inner = smoothstep(edge - band - (n2 - 0.5) * 0.2, edge - band * 0.3, r);
    float foam = outer * inner * (0.55 + 0.6 * n2);
    // churned white water inside the ring, fading quickly
    float fill = (1.0 - smoothstep(0.0, edge, r)) * (0.35 + 0.4 * n) * (1.0 - uT) * (1.0 - uT);
    float a = (foam + fill) * pow(1.0 - uT, 1.3);
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(0.95, 0.98, 1.0), min(a, 0.95));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** Expanding ring of foam with a ragged, noise-broken edge and churned water inside. Reusable decal. */
export function FoamRing({ position, radius = 2, duration = 2.6, delay = 0, seed = 1, onDone }: FoamRingProps) {
  const reduced = useReducedMotion()
  const total = reduced ? duration * 0.6 : duration
  const tl = useEffectTimeline(delay + total, { onDone })
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uT: { value: 0 }, uSeed: { value: (seed % 17) / 17 }, uNoise: { value: noiseTexture() } },
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        side: THREE.DoubleSide,
      }),
    [seed],
  )
  const mesh = useRef<THREE.Mesh>(null)
  useFrame(() => {
    const t = (tl.t - delay) / total
    const m = mesh.current
    if (!m) return
    ;(m.material as THREE.ShaderMaterial).uniforms.uT.value = t
    m.visible = t > 0 && t < 1
  })
  return (
    <mesh ref={mesh} material={material} position={[position[0], position[1] + 0.06, position[2]]} rotation-x={-Math.PI / 2} scale={radius * 2} renderOrder={6} visible={false} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  )
}
