import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Atmosphere } from './sun'
import type { LightningState } from './Weather'

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // keep the dome on the far plane so nothing is ever clipped by it
    gl_Position.z = gl_Position.w * 0.99999;
  }
`

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;
  uniform float uStars;
  uniform float uDaylight;
  uniform float uClouds;
  uniform float uStorm;
  uniform float uFlash;
  uniform vec3 uFlashDir;
  varying vec3 vDir;

  float hash(vec3 p) {
    p = fract(p * vec3(443.897, 441.423, 437.195));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  float hash2(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x),
               mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.03 + 11.7;
      a *= 0.5;
    }
    return v;
  }
  // billowing cumulus: domain-warped fbm, thresholded by coverage
  float cloudDensity(vec2 cp, float coverage) {
    vec2 warp = vec2(fbm(cp * 0.7 + 3.1), fbm(cp * 0.7 - 7.3)) - 0.5;
    float c = fbm(cp + warp * 1.4);
    float lo = mix(0.58, 0.28, coverage);
    float hi = mix(0.82, 0.62, coverage);
    return smoothstep(lo, hi, c);
  }

  void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(up, 0.5));
    col = mix(col, uHorizon * 0.9, smoothstep(0.0, -0.08, d.y));

    // ---- sun disc + glow
    float sd = dot(d, uSunDir);
    float disc = smoothstep(0.9993, 0.9997, sd);
    float glow = pow(max(sd, 0.0), 32.0) * 0.55 + pow(max(sd, 0.0), 6.0) * 0.18;
    glow *= mix(1.0, 1.6, 1.0 - clamp(uSunDir.y, 0.0, 1.0));
    float sunUp = step(-0.08, uSunDir.y);
    col += uGlow * glow * sunUp * (1.0 - uStorm * 0.8);
    col += uSunColor * disc * 4.0 * step(0.0, d.y + 0.02) * (1.0 - uStorm);

    // ---- moon opposite the sun
    vec3 moonDir = normalize(vec3(-uSunDir.x, -uSunDir.y, uSunDir.z));
    float md = dot(d, moonDir);
    float moon = smoothstep(0.99955, 0.9998, md);
    // a shaded limb so the moon reads as a sphere
    vec3 moonTex = vec3(0.85, 0.9, 1.0) * (0.75 + 0.25 * smoothstep(0.9996, 0.99985, md));
    float moonGlow = pow(max(md, 0.0), 60.0) * 0.25;
    col += moonTex * (moon * 1.6 + moonGlow) * uStars;

    // ---- stars + milky way
    vec3 cell = floor(d * 160.0);
    float h = hash(cell);
    float star = step(0.9965, h);
    float dist = length(d * 160.0 - (cell + 0.5));
    float twinkle = 0.6 + 0.4 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
    float starLum = star * smoothstep(0.55, 0.0, dist) * twinkle * (0.5 + h);
    col += vec3(0.9, 0.95, 1.0) * starLum * uStars * smoothstep(0.0, 0.15, d.y) * 1.4;
    float band = exp(-pow((d.x * 0.8 + d.y * 0.6) * 3.0, 2.0)) * 0.06;
    col += vec3(0.5, 0.6, 0.9) * band * uStars * fbm(d.xz * 6.0 + 3.0) * smoothstep(0.0, 0.2, d.y);

    // ---- clouds (two layers) and god rays
    if (d.y > 0.0) {
      float coverage = clamp(uClouds * 0.35 + uStorm * 0.95, 0.0, 1.0);
      vec2 cp = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.010, uTime * 0.004);
      float cloud = cloudDensity(cp, coverage) * smoothstep(0.0, 0.18, d.y) * max(uClouds, uStorm);
      vec2 cp2 = d.xz / (d.y + 0.2) * 3.4 + vec2(-uTime * 0.016, uTime * 0.007) + 40.0;
      float cloud2 = cloudDensity(cp2, coverage * 0.8) * smoothstep(0.0, 0.3, d.y) * 0.6 * max(uClouds, uStorm);
      float sunSide = clamp(dot(d, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
      // sun-lit tops, shaded undersides; storm clouds are heavy and dark
      vec3 lit = mix(uHorizon * 0.55, vec3(1.0), uDaylight);
      vec3 shade = mix(uHorizon * 0.35, uZenith * 0.7 + 0.25, uDaylight);
      lit = mix(lit, vec3(0.42, 0.45, 0.5) * (0.3 + 0.7 * uDaylight), uStorm);
      shade = mix(shade, vec3(0.16, 0.18, 0.22) * (0.3 + 0.7 * uDaylight), uStorm);
      float thickness = clamp(cloud + cloud2, 0.0, 1.0);
      vec3 cloudCol = mix(lit, shade, thickness * 0.8) + uGlow * pow(sunSide, 8.0) * 0.6 * (1.0 - uDaylight * 0.6) * (1.0 - uStorm);
      // silver lining where the sun is just behind the cloud edge
      cloudCol += uGlow * pow(sunSide, 24.0) * (1.0 - thickness) * thickness * 1.5 * (1.0 - uStorm);
      // lightning lights the clouds from inside near the strike
      float fd = clamp(dot(d, uFlashDir) * 0.5 + 0.5, 0.0, 1.0);
      cloudCol += vec3(0.8, 0.85, 1.0) * uFlash * (0.5 + 2.5 * pow(fd, 6.0));
      col = mix(col, cloudCol, thickness * 0.9);

      // god rays: angular streaks radiating from the sun, strongest where clouds break
      if (uSunDir.y > 0.02 && sd > 0.3) {
        vec3 sx = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
        vec3 sy = cross(sx, uSunDir);
        float ang = atan(dot(d, sy), dot(d, sx));
        float rays = noise(vec2(ang * 9.0 + 100.0, uTime * 0.05)) * noise(vec2(ang * 23.0 - 50.0, -uTime * 0.03));
        float reach = smoothstep(0.3, 0.98, sd) * (1.0 - smoothstep(0.995, 1.0, sd));
        float gap = 1.0 - thickness;
        col += uGlow * rays * reach * gap * 0.9 * (0.4 + 0.6 * cloud) * (1.0 - uStorm) * (1.0 - clamp(uSunDir.y * 1.4, 0.0, 0.75));
      }
    }
    // whole-sky flash
    col += vec3(0.7, 0.75, 0.9) * uFlash * 0.35;

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export interface SkyDomeProps {
  atmosphere: Atmosphere
  /** Cloud amount in calm weather (0..1). A storm overrides this with full overcast. */
  clouds?: number
  /** Live lightning state (from `useLightning`). */
  lightning?: LightningState
}

/** Procedural sky dome: sun disc + glow, god rays, drifting cumulus, moon, twinkling stars, storm overcast. */
export function SkyDome({ atmosphere, clouds = 1, lightning }: SkyDomeProps) {
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uStars: { value: 0 },
      uDaylight: { value: 1 },
      uClouds: { value: clouds },
      uStorm: { value: 0 },
      uFlash: { value: 0 },
      uFlashDir: { value: new THREE.Vector3(0, 1, 0) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    uniforms.uSunDir.value.set(...atmosphere.sunDir)
    uniforms.uSunColor.value.set(atmosphere.sunColor)
    uniforms.uZenith.value.set(atmosphere.skyZenith)
    uniforms.uHorizon.value.set(atmosphere.skyHorizon)
    uniforms.uGlow.value.set(atmosphere.sunGlow)
    uniforms.uStars.value = atmosphere.stars
    uniforms.uDaylight.value = atmosphere.daylight
    uniforms.uStorm.value = atmosphere.storm
  }, [atmosphere, uniforms])

  useEffect(() => {
    uniforms.uClouds.value = clouds
  }, [clouds, uniforms])

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime
    uniforms.uFlash.value = lightning?.flash ?? 0
    if (lightning) uniforms.uFlashDir.value.copy(lightning.dir)
  })

  const material = useMemo(
    () => new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, side: THREE.BackSide, depthWrite: false }),
    [uniforms],
  )
  useEffect(() => () => material.dispose(), [material])
  return (
    <mesh frustumCulled={false} renderOrder={-100} material={material}>
      <sphereGeometry args={[800, 48, 24]} />
    </mesh>
  )
}

/** Sun + moon directional lights, hemisphere fill, ambient and fog, all driven by the atmosphere. */
export function Lighting({ atmosphere, quality, lightning }: { atmosphere: Atmosphere; quality: 'low' | 'high'; lightning?: LightningState }) {
  const sun = useRef<THREE.DirectionalLight>(null)
  const bolt = useRef<THREE.DirectionalLight>(null)
  useFrame(() => {
    if (!bolt.current) return
    const f = lightning?.flash ?? 0
    bolt.current.intensity = f * 4
    if (lightning) bolt.current.position.copy(lightning.dir).multiplyScalar(80)
  })
  const [sx, sy, sz] = atmosphere.sunDir
  const sunPos: [number, number, number] = [sx * 70, Math.max(sy, 0.08) * 70, sz * 70]
  const moonPos: [number, number, number] = [-sx * 70, Math.max(-sy, 0.1) * 70, sz * 70]
  const shadowSize = quality === 'high' ? 2048 : 1024
  const fogNear = 55 - atmosphere.storm * 25
  const fogFar = 230 - atmosphere.storm * 110
  return (
    <>
      <fog attach="fog" args={[atmosphere.fogColor, fogNear, fogFar]} />
      <directionalLight
        ref={sun}
        position={sunPos}
        color={atmosphere.sunColor}
        intensity={atmosphere.sunIntensity}
        castShadow
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-near={10}
        shadow-camera-far={160}
        shadow-camera-left={-22}
        shadow-camera-right={22}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
      />
      <directionalLight position={moonPos} color="#9fb4ff" intensity={atmosphere.moonIntensity} />
      {/* lightning: a cold flash from above */}
      <directionalLight ref={bolt} position={[20, 80, -60]} color="#dfe8ff" intensity={0} />
      <hemisphereLight color={atmosphere.skyZenith} groundColor={atmosphere.waterDeep} intensity={0.35 + 0.45 * atmosphere.daylight} />
      <ambientLight color={atmosphere.ambientColor} intensity={atmosphere.ambientIntensity * 0.5} />
    </>
  )
}
