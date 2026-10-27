/**
 * Cloth shader shared by sails and flags: wind billow + flap in the vertex stage (no CPU vertex updates),
 * `set` (furl toward the head), `torn` (noise cut-outs with scorched edges) in the fragment stage.
 * Built by patching `MeshStandardMaterial` so the cloth is lit, shadowed and tone-mapped like everything else;
 * a matching depth material keeps shadows in sync with the displaced surface.
 */
import * as THREE from 'three'

export type ClothMode = 'sail' | 'flag'

export interface ClothUniforms {
  uTime: { value: number }
  /** Wind strength multiplier (reduced motion → ~0.25). */
  uWind: { value: number }
  /** 0 furled … 1 full (sails only). */
  uSet: { value: number }
  /** 0 pristine … 1 shredded. */
  uTorn: { value: number }
  uPhase: { value: number }
  /** Cloth width / height in metres (plane extents). */
  uSize: { value: THREE.Vector2 }
  /** 0 sail (hung from the head), 1 flag (attached at the hoist). */
  uMode: { value: number }
}

const GLSL_COMMON = /* glsl */ `
uniform float uTime;
uniform float uWind;
uniform float uSet;
uniform float uTorn;
uniform float uPhase;
uniform vec2 uSize;
uniform float uMode;
varying vec2 vClothUv;
`

const GLSL_DISPLACE = /* glsl */ `
vec3 clothPoint(vec2 p) {
  float w = uSize.x;
  float h = uSize.y;
  float u = p.x / w + 0.5;      // 0 left/hoist … 1 right/fly
  float v = p.y / h + 0.5;      // 0 foot … 1 head
  float t = uTime + uPhase;
  vec3 out3 = vec3(p, 0.0);
  if (uMode < 0.5) {
    float s = max(uSet, 0.03);
    // furl: gather the cloth toward the yard
    out3.y = h * 0.5 - (h * 0.5 - p.y) * s;
    out3.x = p.x * (0.9 + 0.1 * s);
    float edge = 1.0 - pow(abs(p.x) / (w * 0.5), 2.0);
    // the normal probe samples v slightly past the head (v > 1): keep pow()'s base ≥ 0 — a negative base is
    // undefined in GLSL and yields NaN on some drivers, which bloom then smears over the whole frame (BUG-223)
    float down = clamp(1.0 - v, 0.0, 1.0);
    float belly = 0.22 * min(w, h * 1.6) * edge * pow(down, 0.7) * (1.0 - 0.55 * pow(down, 4.0));
    float flap = (0.012 * w * sin(t * 2.3 + u * 7.0 + v * 3.0) + 0.006 * w * sin(t * 4.7 + v * 9.0 - u * 4.0)) * (0.35 + 0.65 * down) * edge;
    float gust = 0.9 + 0.1 * sin(t * 0.7 + uPhase);
    out3.z = (belly * gust + flap * uWind) * s;
  } else {
    float k = u;
    // narrow cloth (pennants) ripples: scale the wave by the aspect so a 6:1 ribbon doesn't corkscrew
    float slim = clamp(h / w * 3.0, 0.3, 1.0);
    float wave = (sin(t * 3.1 + k * 6.5) * 0.11 * w * k * k + sin(t * 5.3 + k * 12.0 + v * 4.0) * 0.025 * w * k) * slim;
    out3.z = wave * uWind;
    out3.y = p.y - k * k * 0.08 * w * (1.0 - 0.7 * uWind) - 0.015 * w * k * sin(t * 2.0 + k * 4.0) * uWind;
    out3.x = p.x - k * 0.04 * w * uWind;
  }
  return out3;
}
`

export function patchClothShader(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, { value: unknown }> }, uniforms: ClothUniforms, lit: boolean) {
  Object.assign(shader.uniforms, uniforms)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${GLSL_COMMON}\n${GLSL_DISPLACE}`)
    .replace(
      '#include <beginnormal_vertex>',
      /* glsl */ `
      vec2 cp = position.xy;
      float e = 0.01;
      vec3 cP = clothPoint(cp);
      vec3 cDx = clothPoint(cp + vec2(e, 0.0)) - cP;
      vec3 cDy = clothPoint(cp + vec2(0.0, e)) - cP;
      vec3 cN = cross(cDx, cDy);
      // degenerate probe (flat cloth / zero wind): never normalize a zero vector (NaN)
      vec3 objectNormal = dot(cN, cN) > 1e-12 ? normalize(cN) : vec3(0.0, 0.0, 1.0);
      #ifdef USE_TANGENT
      vec3 objectTangent = vec3( tangent.xyz );
      #endif
      `,
    )
    .replace(
      '#include <begin_vertex>',
      /* glsl */ `
      ${lit ? '' : 'vec3 cP = clothPoint(position.xy);'}
      vec3 transformed = cP;
      vClothUv = vec2(position.x / uSize.x + 0.5, position.y / uSize.y + 0.5);
      `,
    )
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      /* glsl */ `#include <common>
      ${GLSL_COMMON}
      float clothHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float clothNoise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(clothHash(i), clothHash(i + vec2(1.0, 0.0)), f.x), mix(clothHash(i + vec2(0.0, 1.0)), clothHash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float clothFbm(vec2 p) { return 0.55 * clothNoise(p) + 0.3 * clothNoise(p * 2.3 + 7.1) + 0.15 * clothNoise(p * 5.1 + 3.3); }
      `,
    )
    .replace(
      '#include <map_fragment>',
      /* glsl */ `#include <map_fragment>
      {
        vec2 q = vClothUv * vec2(uSize.x, uSize.y) * 2.2 + uPhase;
        float n = clothFbm(q);
        float edgeBias = (1.0 - vClothUv.y) * 0.25 + (1.0 - abs(vClothUv.x - 0.5) * 2.0) * -0.1;
        float cut = uTorn * (0.62 + edgeBias);
        if (n < cut) discard;
        ${lit ? 'float scorch = smoothstep(cut + 0.14, cut, n); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.02, 0.012), scorch * 0.92);' : ''}
      }
      `,
    )
}

export function makeClothUniforms(width: number, height: number, mode: ClothMode): ClothUniforms {
  return {
    uTime: { value: 0 },
    uWind: { value: 1 },
    uSet: { value: 1 },
    uTorn: { value: 0 },
    uPhase: { value: 0 },
    uSize: { value: new THREE.Vector2(width, height) },
    uMode: { value: mode === 'flag' ? 1 : 0 },
  }
}

/** Per-instance cloth material pair (lit material + shadow depth material) derived from a shared base. */
export function makeClothMaterial(base: THREE.MeshStandardMaterial, uniforms: ClothUniforms, mode: ClothMode) {
  const material = base.clone()
  material.side = THREE.DoubleSide
  material.shadowSide = THREE.DoubleSide
  material.onBeforeCompile = (shader) => patchClothShader(shader, uniforms, true)
  material.customProgramCacheKey = () => `cloth-${mode}-lit`
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide })
  depth.onBeforeCompile = (shader) => patchClothShader(shader, uniforms, false)
  depth.customProgramCacheKey = () => `cloth-${mode}-depth`
  return { material, depth }
}
