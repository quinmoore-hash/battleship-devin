import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Atmosphere } from './sun'
import { WAVE_COUNT, WAVE_TIME_SCALE, wavesToGlsl } from './waves'

export type Quality = 'low' | 'high'

const SIZE = 300
const SEGMENTS: Record<Quality, number> = { low: 110, high: 260 }

const vertexShader = (waveGlsl: string) => /* glsl */ `
  ${waveGlsl}
  uniform float uTime;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;
  varying float vCrest;
  #include <fog_pars_vertex>

  void main() {
    vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 base = p;
    vec3 disp = vec3(0.0);
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    float crest = 0.0;
    float cf = calm(base.xz);
    for (int i = 0; i < WAVE_COUNT; i++) {
      vec2 d = WAVES[i].xy;
      float k = WAVES[i].z;
      float a = WAVES[i].w;
      float q = STEEP[i] / (k * a * float(WAVE_COUNT));
      float f = k * (dot(d, base.xz) - SPEED[i] * uTime);
      float s = sin(f) * cf;
      float c = cos(f) * cf;
      disp.x += q * a * d.x * c;
      disp.z += q * a * d.y * c;
      disp.y += a * s;
      float wa = k * a;
      tangent  += vec3(-q * d.x * d.x * wa * s, d.x * wa * c, -q * d.x * d.y * wa * s);
      binormal += vec3(-q * d.x * d.y * wa * s, d.y * wa * c, -q * d.y * d.y * wa * s);
      crest += s * a;
    }
    p += disp;
    vNormal = normalize(cross(binormal, tangent));
    vWorldPos = p;
    vHeight = disp.y;
    vCrest = crest;
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform float uDaylight;
  uniform float uDetail;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;
  varying float vCrest;
  #include <fog_pars_fragment>

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p = p * 2.07 + vec2(17.3, 9.1);
      a *= 0.5;
    }
    return v;
  }
  // cheap animated caustic: product of two drifting noise fields, sharpened
  float caustic(vec2 p, float t) {
    float a = noise(p * 1.7 + vec2(t * 0.35, -t * 0.22));
    float b = noise(p * 1.9 - vec2(t * 0.27, t * 0.31) + 5.0);
    float c = a * b;
    return pow(c, 2.6) * 6.0;
  }

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDir);

    // ---- seabed depth: shallows along the far shoreline and the bay edges
    float edge = fbm(vWorldPos.xz * 0.05 + 3.0) * 8.0;
    float shallow = smoothstep(-24.0, -40.0, vWorldPos.z + edge)
                  + smoothstep(42.0, 58.0, abs(vWorldPos.x) + edge)
                  + smoothstep(38.0, 52.0, vWorldPos.z - edge);
    shallow = clamp(shallow, 0.0, 1.0);
    // gentle sand bar texture inside the shallows
    shallow *= 0.75 + 0.25 * fbm(vWorldPos.xz * 0.15);

    vec3 water = mix(uDeep, uShallow, shallow);
    // fake subsurface scattering on crests facing the sun
    float sss = clamp(vCrest * 2.0 + 0.2, 0.0, 1.0) * clamp(dot(-L, V) * 0.5 + 0.5, 0.0, 1.0);
    water = mix(water, uShallow, sss * 0.35 * uDaylight);

    // ---- detail normals: small animated ripples layered on the Gerstner normal
    vec2 rp = vWorldPos.xz;
    float r1 = noise(rp * 5.5 + vec2(uTime * 0.35, uTime * 0.22)) + 0.5 * noise(rp * 11.0 - vec2(uTime * 0.4, uTime * 0.1));
    float r2 = noise(rp * 6.1 - vec2(uTime * 0.27, -uTime * 0.33)) + 0.5 * noise(rp * 12.0 + vec2(uTime * 0.2, uTime * 0.45));
    vec3 ripple = vec3((r1 - 0.75), 0.0, (r2 - 0.75)) * 0.07 * uDetail;
    N = normalize(N + ripple);

    // ---- caustics in the shallows
    float ca = caustic(rp * 0.9, uTime) * shallow * uDaylight;
    water += uShallow * ca * 0.35;

    // ---- fresnel reflection of the sky
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fresnel = 0.025 + 0.975 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, N);
    float up = clamp(R.y, 0.0, 1.0);
    vec3 sky = mix(uHorizon, uZenith, pow(up, 0.45));
    float sunRefl = pow(max(dot(R, L), 0.0), 24.0);
    sky += uGlow * sunRefl * 0.6;
    vec3 color = mix(water, sky, fresnel * mix(0.6, 1.0, uDaylight));

    // ---- sun specular: tight hot highlight + broad glitter path
    vec3 H = normalize(L + V);
    float ndh = max(dot(N, H), 0.0);
    float spec = min(pow(ndh, 420.0) * 1.4 + pow(ndh, 60.0) * 0.12, 1.2);
    color += uSunColor * spec * uSunIntensity * 0.9;

    // ---- foam: breaking crests and lapping shore foam
    float foamNoise = fbm(rp * 3.6 + vec2(uTime * 0.12, -uTime * 0.08));
    float crestFoam = smoothstep(0.26, 0.4, vCrest) * smoothstep(0.5, 0.8, foamNoise) * 0.7;
    float shoreBand = sin(vWorldPos.z * 0.9 + uTime * 1.3 + edge * 0.4) * 0.5 + 0.5;
    float shoreFoam = smoothstep(0.72, 0.98, shallow) * smoothstep(0.5, 0.85, foamNoise * 0.6 + shoreBand * 0.5);
    float foam = clamp(crestFoam + shoreFoam, 0.0, 1.0) * uDetail;
    vec3 foamColor = mix(vec3(0.75, 0.85, 0.9), vec3(1.0), uDaylight) * mix(0.35, 1.0, uDaylight);
    color = mix(color, foamColor, foam * 0.7);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

export interface WaterProps {
  quality: Quality
  atmosphere: Atmosphere
}

/**
 * The bay. A single high-subdivision plane displaced by a bank of Gerstner waves in the
 * vertex shader; the fragment shader adds depth tinting, ripples, caustics, Fresnel sky
 * reflection, sun specular and foam. Colours come from the time-of-day atmosphere.
 */
export function Water({ quality, atmosphere }: WaterProps) {
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const segments = SEGMENTS[quality]
  const waveCount = WAVE_COUNT[quality]

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color('#fff') },
      uSunIntensity: { value: 1 },
      uDeep: { value: new THREE.Color('#0a5c8c') },
      uShallow: { value: new THREE.Color('#4fe3d4') },
      uZenith: { value: new THREE.Color('#3a86e0') },
      uHorizon: { value: new THREE.Color('#bfe4ff') },
      uGlow: { value: new THREE.Color('#fff0cc') },
      uDaylight: { value: 1 },
      uDetail: { value: quality === 'high' ? 1 : 0.6 },
      // three's fog chunks expect these to exist on the material
      fogColor: { value: new THREE.Color('#bfe4ff') },
      fogNear: { value: 50 },
      fogFar: { value: 200 },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    uniforms.uSunDir.value.set(...atmosphere.sunDir)
    uniforms.uSunColor.value.set(atmosphere.sunColor)
    uniforms.uSunIntensity.value = Math.min(1.4, atmosphere.sunIntensity * 0.55 + 0.1)
    uniforms.uDeep.value.set(atmosphere.waterDeep)
    uniforms.uShallow.value.set(atmosphere.waterShallow)
    uniforms.uZenith.value.set(atmosphere.skyZenith)
    uniforms.uHorizon.value.set(atmosphere.skyHorizon)
    uniforms.uGlow.value.set(atmosphere.sunGlow)
    uniforms.uDaylight.value = atmosphere.daylight
  }, [atmosphere, uniforms])

  useEffect(() => {
    uniforms.uDetail.value = quality === 'high' ? 1 : 0.6
  }, [quality, uniforms])

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime * WAVE_TIME_SCALE
    const fog = state.scene.fog as THREE.Fog | null
    if (fog) {
      uniforms.fogColor.value.copy(fog.color)
      uniforms.fogNear.value = fog.near
      uniforms.fogFar.value = fog.far
    }
  })

  const vs = useMemo(() => vertexShader(wavesToGlsl(waveCount)), [waveCount])

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false} renderOrder={-10}>
      <planeGeometry key={segments} args={[SIZE, SIZE, segments, segments]} />
      <shaderMaterial
        key={waveCount}
        ref={matRef}
        vertexShader={vs}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        fog
      />
    </mesh>
  )
}
