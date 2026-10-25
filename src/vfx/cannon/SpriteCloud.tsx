import { forwardRef, useImperativeHandle, useMemo } from 'react'
import * as THREE from 'three'

/**
 * Fixed-size pool of camera-facing textured quads (soft particles) rendered as ONE instanced draw call.
 * Effects write per-sprite position / size / alpha / rotation / tint every frame through the handle; nothing
 * is allocated per frame. Billboarding happens in the vertex shader so there is no point-size limit and
 * sprites stay soft at any camera distance.
 */
export interface SpriteCloudHandle {
  /** `tint` 0..1 blends `colorA` → `colorB`. `rotation` in radians. */
  write(i: number, x: number, y: number, z: number, size: number, alpha: number, rotation: number, tint: number): void
  hide(i: number): void
  /** Upload this frame's writes. */
  commit(): void
  readonly count: number
}

export interface SpriteCloudProps {
  count: number
  map: THREE.Texture
  colorA?: THREE.ColorRepresentation
  colorB?: THREE.ColorRepresentation
  /** `additive` for fire / light, `normal` for smoke and spray. */
  blending?: 'normal' | 'additive'
  /** Fake top-down light: how much brighter the top of each sprite is (0 = flat). */
  shading?: number
  depthTest?: boolean
  renderOrder?: number
}

const vertex = /* glsl */ `
  attribute vec3 iPos;
  attribute vec4 iData;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vTint;
  varying float vUp;
  void main() {
    vUv = uv;
    vAlpha = iData.y;
    vTint = iData.w;
    float c = cos(iData.z);
    float s = sin(iData.z);
    vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iData.x;
    vUp = corner.y / max(iData.x, 1e-5) + 0.5;
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    mv.xy += corner;
    gl_Position = projectionMatrix * mv;
  }
`

const fragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uShading;
  uniform float uPremultiply;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vTint;
  varying float vUp;
  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float a = tex.a * vAlpha;
    if (a < 0.004) discard;
    vec3 col = mix(uColorA, uColorB, vTint) * tex.rgb;
    col *= 1.0 - uShading * 0.5 + uShading * clamp(vUp, 0.0, 1.0);
    gl_FragColor = vec4(mix(col, col * a, uPremultiply), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export const SpriteCloud = forwardRef<SpriteCloudHandle, SpriteCloudProps>(function SpriteCloud(
  { count, map, colorA = '#ffffff', colorB = '#ffffff', blending = 'normal', shading = 0, depthTest = true, renderOrder = 10 },
  ref,
) {
  const geometry = useMemo(() => {
    const g = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    g.setAttribute('position', quad.getAttribute('position'))
    g.setAttribute('uv', quad.getAttribute('uv'))
    g.setIndex(quad.getIndex())
    const pos = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3)
    const data = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4)
    pos.setUsage(THREE.DynamicDrawUsage)
    data.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('iPos', pos)
    g.setAttribute('iData', data)
    g.instanceCount = count
    // the pool spans the whole effect; skip frustum culling by giving it an infinite sphere
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity)
    return g
  }, [count])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: {
          uMap: { value: map },
          uColorA: { value: new THREE.Color(colorA) },
          uColorB: { value: new THREE.Color(colorB) },
          uShading: { value: shading },
          uPremultiply: { value: blending === 'additive' ? 1 : 0 },
        },
        transparent: true,
        depthWrite: false,
        depthTest,
        blending: blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
        toneMapped: true,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, blending, depthTest],
  )
  material.uniforms.uColorA.value.set(colorA)
  material.uniforms.uColorB.value.set(colorB)
  material.uniforms.uShading.value = shading

  useImperativeHandle(
    ref,
    () => {
      const pos = geometry.getAttribute('iPos') as THREE.InstancedBufferAttribute
      const data = geometry.getAttribute('iData') as THREE.InstancedBufferAttribute
      const p = pos.array as Float32Array
      const d = data.array as Float32Array
      return {
        count,
        write(i, x, y, z, size, alpha, rotation, tint) {
          p[i * 3] = x
          p[i * 3 + 1] = y
          p[i * 3 + 2] = z
          d[i * 4] = size
          d[i * 4 + 1] = alpha
          d[i * 4 + 2] = rotation
          d[i * 4 + 3] = tint
        },
        hide(i) {
          d[i * 4] = 0
          d[i * 4 + 1] = 0
        },
        commit() {
          pos.needsUpdate = true
          data.needsUpdate = true
        },
      }
    },
    [geometry, count],
  )

  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={renderOrder} />
})
