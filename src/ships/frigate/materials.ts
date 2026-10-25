/**
 * Frigate materials: PBR wood / copper / cloth built on the procedural textures in `textures.ts`, plus
 * the sail & flag shader (vertex belly/flutter/furl with a rebuilt normal, fragment tear/scorch).
 * Generic metals/glass/rope come from the shared kit so liveries stay consistent across classes.
 */
import * as THREE from 'three'
import { shipMaterials } from '../kit'
import type { Livery } from '../types'
import { charTexture, copperTexture, flagTexture, gratingTexture, nettingTexture, plankTexture, sailTexture, waterlineTexture } from './textures'

export type Quality = 'low' | 'high'

export interface FrigateMaterials {
  hull: THREE.MeshStandardMaterial
  /** Tarred wales / black strakes. */
  black: THREE.MeshStandardMaterial
  /** Painted band between the wales (navy ochre gun-stripe, pirate blood-red). */
  stripe: THREE.MeshStandardMaterial
  copper: THREE.MeshStandardMaterial
  waterline: THREE.MeshStandardMaterial
  deck: THREE.MeshStandardMaterial
  /** Dark deck-furniture oak (hatches, bitts, carriage timber). */
  oak: THREE.MeshStandardMaterial
  trim: THREE.MeshStandardMaterial
  gilt: THREE.MeshStandardMaterial
  iron: THREE.Material
  brass: THREE.Material
  glass: THREE.Material
  rope: THREE.MeshStandardMaterial
  netting: THREE.MeshStandardMaterial
  grating: THREE.MeshStandardMaterial
  char: THREE.MeshStandardMaterial
  splinter: THREE.MeshStandardMaterial
  lidInside: THREE.MeshStandardMaterial
  /** Plain hull-coloured paint for gun-port lids and other small painted timbers. */
  paint: THREE.MeshStandardMaterial
  lantern: THREE.MeshStandardMaterial
}

const CACHE = new Map<string, FrigateMaterials>()

function std(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...params })
}

function withTexture(map: THREE.Texture, repeat: [number, number]): THREE.Texture {
  const t = map.clone()
  t.repeat.set(repeat[0], repeat[1])
  t.needsUpdate = true
  return t
}

export function frigateMaterials(livery: Livery, quality: Quality = 'high'): FrigateMaterials {
  const key = `${livery}:${quality}`
  const hit = CACHE.get(key)
  if (hit) return hit
  const kit = shipMaterials(livery)
  const size = quality === 'high' ? 512 : 256
  const bumpScale = quality === 'high' ? 0.004 : 0
  const pirate = livery === 'pirate'

  const hullTex = plankTexture({
    color: pirate ? '#3a2718' : '#a8865a',
    seam: pirate ? '#150c06' : '#5a4328',
    rows: 5,
    plankLen: 0.55,
    seed: 101,
    size,
    nails: true,
    variance: pirate ? 0.05 : 0.07,
  })
  const deckTex = plankTexture({
    color: pirate ? '#86704f' : '#c4aa7f',
    seam: pirate ? '#3a2a18' : '#6e5a3c',
    rows: 10,
    plankLen: 0.45,
    seed: 202,
    size,
    nails: true,
    variance: 0.06,
  })
  const blackTex = plankTexture({ color: '#17110d', seam: '#070404', rows: 2, plankLen: 0.6, seed: 303, size: size / 2, variance: 0.03 })
  const copper = copperTexture(7, size)
  const waterline = waterlineTexture(11, size / 2)
  const netting = nettingTexture(livery, size / 2)
  const grating = gratingTexture()
  const char = charTexture()

  const m: FrigateMaterials = {
    hull: std({ map: withTexture(hullTex.map, [2.2, 7]), bumpMap: quality === 'high' ? withTexture(hullTex.bump!, [2.2, 7]) : null, bumpScale, roughness: pirate ? 0.78 : 0.82 }),
    black: std({ map: withTexture(blackTex.map, [3, 4]), roughness: 0.6, color: '#8a8a8a' }),
    stripe: std({ map: withTexture(blackTex.map, [3, 6]), color: pirate ? '#7a1616' : '#e2b45a', roughness: 0.7 }),
    copper: std({ map: withTexture(copper.map, [3, 1.6]), bumpMap: quality === 'high' ? withTexture(copper.bump!, [3, 1.6]) : null, bumpScale: bumpScale * 1.5, roughness: 0.55, metalness: 0.45 }),
    waterline: std({ map: withTexture(waterline.map, [6, 1]), bumpMap: quality === 'high' ? withTexture(waterline.bump!, [6, 1]) : null, bumpScale: bumpScale * 2, roughness: 0.95 }),
    deck: std({ map: withTexture(deckTex.map, [1.2, 1.2]), bumpMap: quality === 'high' ? withTexture(deckTex.bump!, [1.2, 1.2]) : null, bumpScale, roughness: 0.9 }),
    oak: std({ map: withTexture(deckTex.map, [2, 2]), color: pirate ? '#6d5236' : '#8c6b45', roughness: 0.8 }),
    trim: std({ color: pirate ? '#8c1d1d' : '#1f3f7a', roughness: 0.55 }),
    gilt: std({ color: pirate ? '#9c7a2e' : '#d9ac3c', roughness: 0.35, metalness: 0.85 }),
    iron: kit.iron,
    brass: kit.brass,
    glass: kit.glass,
    rope: std({ color: pirate ? '#5e4b32' : '#8a7355', roughness: 1 }),
    netting: std({ map: withTexture(netting.map, [10, 1]), roughness: 0.95 }),
    grating: std({ map: grating.map, roughness: 0.9 }),
    char: std({ map: char.map, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    splinter: std({ color: '#140c07', roughness: 1 }),
    paint: std({ color: pirate ? '#3a2718' : '#a8865a', roughness: 0.8 }),
    lidInside: std({ color: pirate ? '#7a1616' : '#b5121b', roughness: 0.7 }),
    lantern: std({ color: '#ffb347', emissive: '#ff9a2a', emissiveIntensity: 1.6, roughness: 0.4 }),
  }
  CACHE.set(key, m)
  return m
}

/* ---------------------------------------------------------------- sail / flag shader */

export interface ClothUniforms {
  uTime: { value: number }
  uSet: { value: number }
  uTorn: { value: number }
  uBelly: { value: number }
  uPhase: { value: number }
  uFlutter: { value: number }
  uSeed: { value: number }
  /** 0 square/quad sail, 1 triangular sail, 2 flag. */
  uShape: { value: number }
}

const CLOTH_VERTEX_PARS = /* glsl */ `
uniform float uTime; uniform float uSet; uniform float uBelly; uniform float uPhase; uniform float uFlutter; uniform float uShape;
attribute vec3 aFurl; attribute vec3 aTanU; attribute vec3 aTanV;
varying vec2 vClothUv;
float clothEdge(vec2 q) {
  if (uShape < 0.5) {
    return pow(max(0.0, 1.0 - abs(2.0 * q.x - 1.0)), 0.8) * (0.3 + 0.7 * pow(max(0.0, 1.0 - q.y), 0.8));
  } else if (uShape < 1.5) {
    float b0 = q.y; float b1 = q.x * (1.0 - q.y); float b2 = (1.0 - q.x) * (1.0 - q.y);
    return min(1.0, 4.8 * min(b0, min(b1, b2)));
  }
  return q.x;
}
float clothDisp(vec2 q) {
  float e = clothEdge(q);
  if (uShape > 1.5) {
    float k = q.x;
    return uSet * (sin(uTime * 3.0 + k * 6.0 + uPhase) * 0.09 * k + sin(uTime * 5.1 + k * 13.0 + q.y * 3.0 + uPhase) * 0.02 * k);
  }
  float belly = uSet * e * uBelly;
  float flutter = sin(uTime * 2.0 + q.y * 7.0 + q.x * 4.0 + uPhase) * uFlutter * uSet * (0.3 + 0.7 * e)
                + sin(uTime * 3.3 + q.x * 11.0 + uPhase * 1.7) * uFlutter * 0.5 * (1.0 - q.y) * (0.2 + 0.8 * e) * uSet;
  return belly + flutter;
}
`

const CLOTH_BEGINNORMAL = /* glsl */ `
float cd0 = clothDisp(uv);
float cdu = (clothDisp(uv + vec2(0.01, 0.0)) - cd0) / 0.01;
float cdv = (clothDisp(uv + vec2(0.0, 0.01)) - cd0) / 0.01;
vec3 clothTu = aTanU + normal * cdu;
vec3 clothTv = aTanV + normal * cdv;
vec3 objectNormal = normalize(cross(clothTu, clothTv));
#ifdef USE_TANGENT
vec3 objectTangent = vec3( tangent.xyz );
#endif
`

const CLOTH_BEGIN_VERTEX = /* glsl */ `
float clothD = clothDisp(uv);
vec3 transformed = vec3(position) + normal * clothD;
{
  float roll = uShape > 1.5 ? 0.0 : 6.2831 * uv.y;
  vec3 up = normalize(aTanV);
  float rollR = 0.012 + 0.045 * length(aTanV);
  vec3 furled = aFurl + (normal * cos(roll) + up * sin(roll)) * rollR + normal * 0.01;
  float openness = uShape > 1.5 ? smoothstep(0.0, 0.6, uSet) : smoothstep(0.0, 1.0, uSet);
  transformed = mix(furled, transformed, openness);
}
vClothUv = uv;
`

const CLOTH_FRAGMENT_PARS = /* glsl */ `
uniform float uTorn; uniform float uSeed;
varying vec2 vClothUv;
float clothHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float clothNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = clothHash(i), b = clothHash(i + vec2(1.0, 0.0)), c = clothHash(i + vec2(0.0, 1.0)), d = clothHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`

const CLOTH_TEAR = /* glsl */ `
if (uTorn > 0.001) {
  float n = clothNoise(vClothUv * 6.0 + uSeed) * 0.65 + clothNoise(vClothUv * 17.0 + uSeed * 3.0) * 0.35;
  float edgeDist = min(min(vClothUv.x, 1.0 - vClothUv.x), vClothUv.y);
  float threshold = uTorn * (0.7 + 0.5 * (1.0 - smoothstep(0.0, 0.3, edgeDist)));
  if (n < threshold - 0.08) discard;
  float scorch = smoothstep(threshold - 0.08, threshold + 0.2, n);
  diffuseColor.rgb *= mix(0.1, 1.0, scorch);
}
`

export function makeClothUniforms(shape: 0 | 1 | 2, time: { value: number }): ClothUniforms {
  return {
    uTime: time,
    uSet: { value: 1 },
    uTorn: { value: 0 },
    uBelly: { value: 0.1 },
    uPhase: { value: 0 },
    uFlutter: { value: 0.015 },
    uSeed: { value: 0 },
    uShape: { value: shape },
  }
}

export function applyClothUniforms(u: ClothUniforms, v: { set: number; torn: number; phase: number; belly: number; flutter: number; seed: number }) {
  u.uSet.value = v.set
  u.uTorn.value = v.torn
  u.uPhase.value = v.phase
  u.uBelly.value = v.belly
  u.uFlutter.value = v.flutter
  u.uSeed.value = v.seed
}

function injectVertex(shader: THREE.WebGLProgramParametersWithUniforms, u: ClothUniforms) {
  Object.assign(shader.uniforms, u)
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${CLOTH_VERTEX_PARS}`)
    .replace('#include <beginnormal_vertex>', CLOTH_BEGINNORMAL)
    .replace('#include <begin_vertex>', CLOTH_BEGIN_VERTEX)
}

/**
 * A `MeshStandardMaterial` whose vertices belly, flutter and furl in the shader and whose fragments tear
 * and scorch as `uTorn` grows. One material per sail (its own uniforms); all share one compiled program.
 */
export function makeClothMaterial(map: THREE.Texture, u: ClothUniforms, params: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map, side: THREE.DoubleSide, roughness: 0.92, metalness: 0, ...params })
  mat.onBeforeCompile = (shader) => {
    injectVertex(shader, u)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CLOTH_FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${CLOTH_TEAR}`)
  }
  mat.customProgramCacheKey = () => 'frigate-cloth'
  mat.userData.uniforms = u
  return mat
}

/** Depth material matching `makeClothMaterial` so shadows follow the bellied / furled cloth. */
export function makeClothDepthMaterial(u: ClothUniforms): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  mat.onBeforeCompile = (shader) => injectVertex(shader, u)
  mat.customProgramCacheKey = () => 'frigate-cloth-depth'
  return mat
}

export const clothTextures = { sail: sailTexture, flag: flagTexture }
