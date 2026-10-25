import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import { buildHeightMap, DEPTH_MAP_EXTENT, SHALLOW_DEPTH } from './cove'
import type { Atmosphere } from './sun'
import type { LightningState } from './Weather'
import { setSeaState, WAVE_COUNT, WAVE_TIME_SCALE, wavesToGlsl, waveUniforms } from './waves'

export type Quality = 'low' | 'high'

const SIZE = 300
const FAR_SIZE = 2600
const SEGMENTS: Record<Quality, number> = { low: 110, high: 260 }
const HEIGHT_MAP_SIZE = 256

const vertexShader = (waveGlsl: string) => /* glsl */ `
  ${waveGlsl}
  uniform float uTime;
  uniform float uAmp;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vCrest;
  #include <fog_pars_vertex>

  void main() {
    vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 base = p;
    vec3 disp = vec3(0.0);
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);
    float crest = 0.0;
    float cf = calm(base.xz) * uAmp;
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
  uniform float uStars;
  uniform float uDetail;
  uniform float uStorm;
  uniform float uFlash;
  uniform sampler2D uHeightMap;
  uniform float uMapExtent;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
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
  float caustic(vec2 p, float t) {
    float a = noise(p * 1.7 + vec2(t * 0.35, -t * 0.22));
    float b = noise(p * 1.9 - vec2(t * 0.27, t * 0.31) + 5.0);
    return pow(a * b, 2.6) * 6.0;
  }
  // expanding rain rings: one ring per grid cell, re-seeded every cycle
  float rainRings(vec2 p, float t) {
    vec2 cell = floor(p);
    vec2 f = fract(p) - 0.5;
    float h = hash(cell);
    float life = fract(t * (0.8 + h * 0.6) + h * 7.0);
    vec2 c = (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6;
    float r = length(f - c);
    float ring = smoothstep(0.03, 0.0, abs(r - life * 0.45)) * (1.0 - life);
    return ring;
  }
  float terrain(vec2 xz) {
    vec2 uv = xz / (2.0 * uMapExtent) + 0.5;
    return texture2D(uHeightMap, uv).r;
  }

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = normalize(uSunDir);
    vec2 rp = vWorldPos.xz;

    // ---- seabed: depth from the cove height map -> turquoise shallows, pale sand near the beach
    float h = terrain(rp);
    float depth = max(0.0, -h);
    float sandNoise = fbm(rp * 0.12);
    float shallow = 1.0 - smoothstep(0.0, ${(SHALLOW_DEPTH * 1.7).toFixed(1)}, depth - sandNoise * 1.5);
    float sand = 1.0 - smoothstep(0.0, 1.8, depth);
    vec3 sandCol = mix(uShallow, vec3(0.78, 0.86, 0.72) * (0.3 + 0.7 * uDaylight), 0.55);
    vec3 water = mix(uDeep, uShallow, shallow * shallow);
    water = mix(water, sandCol, sand * 0.8 * (1.0 - uStorm * 0.5));
    // subsurface scattering through wave crests lit from behind
    float sss = clamp(vCrest * 2.0 + 0.2, 0.0, 1.0) * clamp(dot(-L, V) * 0.5 + 0.5, 0.0, 1.0);
    water = mix(water, uShallow * 1.1, sss * 0.4 * uDaylight * (1.0 - uStorm * 0.7));

    // ---- detail normals: ripples, wind streaks and rain in a storm
    float r1 = noise(rp * 5.5 + vec2(uTime * 0.35, uTime * 0.22)) + 0.5 * noise(rp * 11.0 - vec2(uTime * 0.4, uTime * 0.1));
    float r2 = noise(rp * 6.1 - vec2(uTime * 0.27, -uTime * 0.33)) + 0.5 * noise(rp * 12.0 + vec2(uTime * 0.2, uTime * 0.45));
    vec3 ripple = vec3((r1 - 0.75), 0.0, (r2 - 0.75)) * (0.06 + 0.09 * uStorm) * uDetail;
    // storm: wind-streaked chop stretched along the wind, plus rain impact rings
    float streak = noise(vec2(rp.x * 0.9 + rp.y * 0.4 + uTime * 1.4, rp.y * 6.0)) - 0.5;
    ripple.z += streak * 0.12 * uStorm;
    float rings = rainRings(rp * 1.6, uTime * 1.5) + rainRings(rp * 2.3 + 11.0, uTime * 1.7 + 3.0);
    ripple.xz += vec2(rings) * 0.35 * uStorm * uDetail;
    N = normalize(N + ripple);

    // ---- caustics dancing on the sand in the shallows
    float ca = caustic(rp * 0.9, uTime) * shallow * uDaylight * (1.0 - uStorm);
    water += uShallow * ca * 0.4;

    // ---- fresnel reflection of the sky (sharper on calm water, softer in a storm)
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    float fresnel = 0.025 + 0.975 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, N);
    float up = clamp(R.y, 0.0, 1.0);
    vec3 sky = mix(uHorizon, uZenith, pow(up, 0.45));
    float sunRefl = pow(max(dot(R, L), 0.0), 36.0);
    sky += uGlow * sunRefl * 0.7 * (1.0 - uStorm);
    sky += vec3(0.75, 0.82, 1.0) * uFlash * 1.5;
    vec3 color = mix(water, sky, fresnel * mix(0.6, 1.0, uDaylight));

    // ---- sun specular: tight hot highlight + broad glitter path + sparkle
    vec3 H = normalize(L + V);
    float ndh = max(dot(N, H), 0.0);
    float spec = min(pow(ndh, 420.0) * 1.4 + pow(ndh, 60.0) * 0.14, 1.2);
    float sparkle = pow(ndh, 180.0) * step(0.82, noise(rp * 40.0 + uTime * 2.0)) * 2.0;
    color += uSunColor * (spec + sparkle * uDetail) * uSunIntensity * 0.9 * (1.0 - uStorm * 0.85);

    // ---- moon path: silver glitter road under the moon at night
    vec3 M = normalize(vec3(-L.x, -L.y, L.z));
    vec3 Hm = normalize(M + V);
    float ndhm = max(dot(N, Hm), 0.0);
    float moonSpec = pow(ndhm, 90.0) * 0.5 + pow(ndhm, 400.0) * 0.8;
    color += vec3(0.78, 0.84, 1.0) * moonSpec * uStars * 0.6;

    // ---- foam: breaking crests, wash on the beach, spray streaks in a storm
    float foamNoise = fbm(rp * 3.6 + vec2(uTime * 0.12, -uTime * 0.08));
    float crestFoam = smoothstep(0.26 - 0.16 * uStorm, 0.4, vCrest / (1.0 + 1.4 * uStorm)) * smoothstep(0.45, 0.8, foamNoise) * 0.75;
    float shoreWave = sin(depth * 2.4 - uTime * 1.6 + sandNoise * 3.0) * 0.5 + 0.5;
    float shoreFoam = smoothstep(2.6, 0.2, depth) * smoothstep(0.35, 0.8, foamNoise * 0.5 + shoreWave * 0.6);
    shoreFoam += smoothstep(0.45, 0.0, depth) * 0.6;
    float sprayFoam = smoothstep(0.55, 0.75, noise(vec2(rp.x * 0.5 + uTime * 0.6, rp.y * 3.0))) * uStorm * 0.5;
    float foam = clamp(crestFoam * (1.0 - 0.35 * uStorm) + shoreFoam + sprayFoam, 0.0, 1.0) * uDetail;
    vec3 foamColor = mix(vec3(0.6, 0.7, 0.78), vec3(1.0), uDaylight) * mix(0.3, 1.0, uDaylight);
    color = mix(color, foamColor, foam * 0.75);

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

export interface WaterProps {
  quality: Quality
  /** Gerstner wave count override (perf tier); defaults to `WAVE_COUNT[quality]`. */
  waves?: number
  atmosphere: Atmosphere
  /** Live lightning state (from `useLightning`); brightens the sky reflection on a flash. */
  lightning?: LightningState
}

function makeUniforms(quality: Quality, heightMap: THREE.DataTexture, amp: number) {
  return {
    uTime: waveUniforms.uTime,
    uAmp: { value: amp },
    uStorm: waveUniforms.uStorm,
    uFlash: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color('#fff') },
    uSunIntensity: { value: 1 },
    uDeep: { value: new THREE.Color('#0a5c8c') },
    uShallow: { value: new THREE.Color('#4fe3d4') },
    uZenith: { value: new THREE.Color('#3a86e0') },
    uHorizon: { value: new THREE.Color('#bfe4ff') },
    uGlow: { value: new THREE.Color('#fff0cc') },
    uDaylight: { value: 1 },
    uStars: { value: 0 },
    uDetail: { value: quality === 'high' ? 1 : 0.6 },
    uHeightMap: { value: heightMap },
    uMapExtent: { value: DEPTH_MAP_EXTENT },
    // three's fog chunks expect these to exist on the material
    fogColor: { value: new THREE.Color('#bfe4ff') },
    fogNear: { value: 50 },
    fogFar: { value: 200 },
  }
}
type WaterUniforms = ReturnType<typeof makeUniforms>

/** Square sheet of water with a square hole for the detailed centre: hides the horizon seam. */
function farRingGeometry(inner: number, outer: number): THREE.BufferGeometry {
  const shape = new THREE.Shape()
  shape.moveTo(-outer, -outer)
  shape.lineTo(outer, -outer)
  shape.lineTo(outer, outer)
  shape.lineTo(-outer, outer)
  shape.closePath()
  const hole = new THREE.Path()
  hole.moveTo(-inner, -inner)
  hole.lineTo(-inner, inner)
  hole.lineTo(inner, inner)
  hole.lineTo(inner, -inner)
  hole.closePath()
  shape.holes.push(hole)
  return new THREE.ShapeGeometry(shape, 1)
}

/**
 * The cove. A high-subdivision plane displaced by a bank of Gerstner waves in the vertex
 * shader; the fragment shader reads the cove height map for depth tinting (turquoise shallows,
 * pale sand, deep blue), adds ripples, caustics, Fresnel sky reflection, sun glitter, the moon
 * path, crest/shore foam and — in a storm — grey-green swell with wind streaks and rain rings.
 * Colours come from the time-of-day atmosphere. A flat far sheet extends the water to the horizon.
 */
export function Water({ quality, atmosphere, lightning, waves }: WaterProps) {
  const segments = SEGMENTS[quality]
  const waveCount = Math.max(1, Math.min(WAVE_COUNT.high, waves ?? WAVE_COUNT[quality]))

  const heightMap = useMemo(() => {
    const tex = new THREE.DataTexture(buildHeightMap(HEIGHT_MAP_SIZE), HEIGHT_MAP_SIZE, HEIGHT_MAP_SIZE, THREE.RedFormat, THREE.FloatType)
    tex.magFilter = THREE.LinearFilter
    tex.minFilter = THREE.LinearFilter
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
    tex.needsUpdate = true
    return tex
  }, [])
  useEffect(() => () => heightMap.dispose(), [heightMap])

  const near = useMemo(() => makeUniforms(quality, heightMap, 1), [heightMap]) // eslint-disable-line react-hooks/exhaustive-deps
  const far = useMemo(() => makeUniforms(quality, heightMap, 0), [heightMap]) // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => [near, far], [near, far])

  useEffect(() => {
    for (const u of all) {
      u.uSunDir.value.set(...atmosphere.sunDir)
      u.uSunColor.value.set(atmosphere.sunColor)
      u.uSunIntensity.value = Math.min(1.4, atmosphere.sunIntensity * 0.55 + 0.1)
      u.uDeep.value.set(atmosphere.waterDeep)
      u.uShallow.value.set(atmosphere.waterShallow)
      u.uZenith.value.set(atmosphere.skyZenith)
      u.uHorizon.value.set(atmosphere.skyHorizon)
      u.uGlow.value.set(atmosphere.sunGlow)
      u.uDaylight.value = atmosphere.daylight
      u.uStars.value = atmosphere.stars
      u.uStorm.value = atmosphere.storm
    }
    setSeaState(atmosphere.storm)
  }, [atmosphere, all])

  useEffect(() => {
    for (const u of all) u.uDetail.value = quality === 'high' ? 1 : 0.6
  }, [quality, all])

  useFrame((state) => {
    const t = state.clock.elapsedTime * WAVE_TIME_SCALE
    const fog = state.scene.fog as THREE.Fog | null
    for (const u of all) {
      u.uTime.value = t
      u.uFlash.value = lightning?.flash ?? 0
      if (fog) {
        u.fogColor.value.copy(fog.color)
        u.fogNear.value = fog.near
        u.fogFar.value = fog.far
      }
    }
  })

  const vs = useMemo(() => vertexShader(wavesToGlsl(waveCount)), [waveCount])
  const farGeo = useMemo(() => farRingGeometry(SIZE / 2, FAR_SIZE / 2), [])

  return (
    <group>
      <WaterSheet uniforms={near} vertexShader={vs} key={`near-${waveCount}-${segments}`}>
        <planeGeometry args={[SIZE, SIZE, segments, segments]} />
      </WaterSheet>
      <WaterSheet uniforms={far} vertexShader={vs} geometry={farGeo} key={`far-${waveCount}`} />
    </group>
  )
}

function WaterSheet({
  uniforms,
  vertexShader: vs,
  geometry,
  children,
}: {
  uniforms: WaterUniforms
  vertexShader: string
  geometry?: THREE.BufferGeometry
  children?: ReactNode
}) {
  // Built imperatively so the material keeps *our* uniform objects (shared `waveUniforms`);
  // the JSX `uniforms` prop is re-applied by r3f and loses that identity.
  const material = useMemo(
    // polygonOffset nudges the water back a few depth units so near-surface geometry (rope grid,
    // floats) wins depth ties on low-precision/far pixels instead of flickering under the surface.
    () =>
      new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader, uniforms, fog: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 }),
    [vs, uniforms],
  )
  useEffect(() => () => material.dispose(), [material])
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false} renderOrder={-10} geometry={geometry} material={material}>
      {children}
    </mesh>
  )
}
