import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Atmosphere } from './sun'

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
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.03 + 11.7;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float up = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(up, 0.5));
    // below the horizon the dome is hidden by the water; keep it horizon-coloured
    col = mix(col, uHorizon * 0.9, smoothstep(0.0, -0.08, d.y));

    // sun disc + glow
    float sd = dot(d, uSunDir);
    float disc = smoothstep(0.9993, 0.9997, sd);
    float glow = pow(max(sd, 0.0), 32.0) * 0.55 + pow(max(sd, 0.0), 6.0) * 0.18;
    // the glow hugs the horizon at sunrise/sunset
    glow *= mix(1.0, 1.6, 1.0 - clamp(uSunDir.y, 0.0, 1.0));
    col += uGlow * glow * step(-0.08, uSunDir.y);
    col += uSunColor * disc * 4.0 * step(0.0, d.y + 0.02);

    // moon opposite the sun
    vec3 moonDir = normalize(vec3(-uSunDir.x, -uSunDir.y, uSunDir.z));
    float md = dot(d, moonDir);
    float moon = smoothstep(0.99955, 0.9998, md);
    float moonGlow = pow(max(md, 0.0), 60.0) * 0.25;
    col += vec3(0.85, 0.9, 1.0) * (moon * 1.6 + moonGlow) * uStars;

    // stars: hashed cells over the direction, twinkling
    vec3 cell = floor(d * 160.0);
    float h = hash(cell);
    float star = step(0.9965, h);
    vec3 cellCenter = (cell + 0.5) / 160.0;
    float dist = length(d * 160.0 - (cell + 0.5));
    float twinkle = 0.6 + 0.4 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
    float starLum = star * smoothstep(0.55, 0.0, dist) * twinkle * (0.5 + h);
    col += vec3(0.9, 0.95, 1.0) * starLum * uStars * smoothstep(0.0, 0.15, d.y) * 1.4;
    // milky way band, very faint
    float band = exp(-pow((d.x * 0.8 + d.y * 0.6) * 3.0, 2.0)) * 0.06;
    col += vec3(0.5, 0.6, 0.9) * band * uStars * fbm(d.xz * 6.0 + 3.0) * smoothstep(0.0, 0.2, d.y);

    // soft clouds, lit by the sun
    if (d.y > 0.02) {
      vec2 cp = d.xz / (d.y + 0.15) * 2.2 + vec2(uTime * 0.012, uTime * 0.004);
      float c = fbm(cp);
      float cloud = smoothstep(0.52, 0.78, c) * smoothstep(0.02, 0.25, d.y) * uClouds;
      vec3 lit = mix(uHorizon * 0.55, vec3(1.0), uDaylight);
      vec3 shade = mix(uHorizon * 0.35, uZenith * 0.7 + 0.25, uDaylight);
      float sunSide = clamp(dot(d, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
      vec3 cloudCol = mix(shade, lit, pow(sunSide, 2.0)) + uGlow * pow(sunSide, 8.0) * 0.6 * (1.0 - uDaylight * 0.6);
      col = mix(col, cloudCol, cloud * 0.85);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** Procedural gradient sky dome: sun disc + glow, moon, twinkling stars, drifting clouds. */
export function SkyDome({ atmosphere, clouds = 1 }: { atmosphere: Atmosphere; clouds?: number }) {
  const ref = useRef<THREE.ShaderMaterial>(null)
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
  }, [atmosphere, uniforms])

  useEffect(() => {
    uniforms.uClouds.value = clouds
  }, [clouds, uniforms])

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime
  })

  return (
    <mesh frustumCulled={false} renderOrder={-100}>
      <sphereGeometry args={[800, 48, 24]} />
      <shaderMaterial
        ref={ref}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  )
}

/** Sun + moon directional lights, hemisphere fill, ambient and fog, all driven by the atmosphere. */
export function Lighting({ atmosphere, quality }: { atmosphere: Atmosphere; quality: 'low' | 'high' }) {
  const sun = useRef<THREE.DirectionalLight>(null)
  const [sx, sy, sz] = atmosphere.sunDir
  const sunPos: [number, number, number] = [sx * 70, Math.max(sy, 0.08) * 70, sz * 70]
  const moonPos: [number, number, number] = [-sx * 70, Math.max(-sy, 0.1) * 70, sz * 70]
  const shadowSize = quality === 'high' ? 2048 : 1024
  return (
    <>
      <fog attach="fog" args={[atmosphere.fogColor, 55, 230]} />
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
      <hemisphereLight
        color={atmosphere.skyZenith}
        groundColor={atmosphere.waterDeep}
        intensity={0.35 + 0.45 * atmosphere.daylight}
      />
      <ambientLight color={atmosphere.ambientColor} intensity={atmosphere.ambientIntensity * 0.5} />
    </>
  )
}
