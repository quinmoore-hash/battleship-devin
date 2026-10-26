/**
 * Brigantine materials per livery: PBR with procedural textures (see textures.ts). The hull material injects
 * a small shader chunk that paints the below-waterline tar/copper, a barnacle band at the waterline and the
 * livery's painted band (navy gun-stripe / pirate red wale) from the model's local y, so it works on any
 * geometry sharing the hull UV scheme.
 */
import * as THREE from 'three'
import type { Livery } from '../types'
import { DECK_Y, PORT_BOTTOM, PORT_TOP } from './hull'
import { flagTexture, metalTextures, nettingTexture, plankTextures, ropeTextures, sailclothTextures, scorchTexture, windowTexture } from './textures'

export interface BrigMaterials {
  hull: THREE.MeshStandardMaterial
  /** Same planking without the waterline shader, for small parts (gun-port lids) in their own local frame. */
  hullPlain: THREE.MeshStandardMaterial
  /** Outer face of the gun-port lids: hull planking (pirate) or the painted gun-stripe (navy). */
  lidOuter: THREE.MeshStandardMaterial
  bulwarkInner: THREE.MeshStandardMaterial
  deck: THREE.MeshStandardMaterial
  /** Dark, tarred timber for keel, wales, masts, spars. */
  timber: THREE.MeshStandardMaterial
  /** Lighter spar wood (yards, boom, gaff, boat). */
  spar: THREE.MeshStandardMaterial
  trim: THREE.MeshStandardMaterial
  accent: THREE.MeshStandardMaterial
  sail: THREE.MeshStandardMaterial
  sailScorched: THREE.MeshStandardMaterial
  rope: THREE.MeshStandardMaterial
  iron: THREE.MeshStandardMaterial
  brass: THREE.MeshStandardMaterial
  glass: THREE.MeshPhysicalMaterial
  flag: THREE.MeshStandardMaterial
  netting: THREE.MeshStandardMaterial
  scorch: THREE.MeshStandardMaterial
  splinter: THREE.MeshStandardMaterial
  window: THREE.MeshStandardMaterial
  lanternGlow: THREE.MeshStandardMaterial
}

interface Palette {
  hull: string
  belowTint: THREE.Color
  barnacle: THREE.Color
  band: [number, number]
  bandColor: THREE.Color
  bulwarkInner: string
  deck: string
  trim: string
  accent: string
  sail: string
  rope: string
  flag: 'jolly-roger' | 'red-ensign'
}

const PALETTE: Record<Livery, Palette> = {
  pirate: {
    hull: '#4a3524',
    belowTint: new THREE.Color('#5a5248'),
    barnacle: new THREE.Color('#9a9484'),
    band: [0.27, 0.315],
    bandColor: new THREE.Color('#7d1b1b'),
    bulwarkInner: '#6a1c1a',
    deck: '#7b5f3e',
    trim: '#8c1d1d',
    accent: '#8f7035',
    sail: '#1d1b19',
    rope: '#5c4a30',
    flag: 'jolly-roger',
  },
  navy: {
    hull: '#a8845a',
    belowTint: new THREE.Color('#c07a4c'),
    barnacle: new THREE.Color('#9fb39a'),
    band: [PORT_BOTTOM - 0.03, PORT_TOP + 0.025],
    bandColor: new THREE.Color('#e4c67c'),
    bulwarkInner: '#213f7c',
    deck: '#c7ab7c',
    trim: '#1f3f7a',
    accent: '#d4af37',
    sail: '#eee4cc',
    rope: '#9a8460',
    flag: 'red-ensign',
  },
}

function hullShader(mat: THREE.MeshStandardMaterial, p: Palette, livery: Livery) {
  const base = new THREE.Color(p.hull)
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBelowTint = { value: p.belowTint }
    shader.uniforms.uBarnacle = { value: p.barnacle }
    shader.uniforms.uBand = { value: new THREE.Vector2(p.band[0], p.band[1]) }
    shader.uniforms.uBandColor = { value: p.bandColor }
    shader.uniforms.uBase = { value: base }
    shader.uniforms.uDeckY = { value: DECK_Y }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBrigPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBrigPos = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vBrigPos;
uniform vec3 uBelowTint; uniform vec3 uBarnacle; uniform vec2 uBand; uniform vec3 uBandColor; uniform vec3 uBase; uniform float uDeckY;
float brigHash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec3 grain = clamp(diffuseColor.rgb / max(uBase, vec3(0.02)), 0.45, 1.6);
  float below = smoothstep(0.015, -0.03, vBrigPos.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, uBelowTint * grain * 0.9, below);
  float band = smoothstep(-0.11, -0.04, vBrigPos.y) * smoothstep(0.045, 0.0, vBrigPos.y);
  float n = brigHash(floor(vBrigPos.xz * 90.0) + floor(vBrigPos.y * 90.0));
  float n2 = brigHash(floor(vBrigPos.xz * 37.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, uBarnacle * (0.7 + 0.4 * n2), band * step(0.72, n) * 0.6);
  float paint = step(uBand.x, vBrigPos.y) * step(vBrigPos.y, uBand.y) * step(uDeckY - 0.3, vBrigPos.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, uBandColor * grain, paint);
}`,
      )
  }
  mat.customProgramCacheKey = () => `brig-hull-${livery}`
}

const CACHE = new Map<Livery, BrigMaterials>()

export function brigMaterials(livery: Livery): BrigMaterials {
  const cached = CACHE.get(livery)
  if (cached) return cached
  const p = PALETTE[livery]
  const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra })

  const hullTex = plankTextures({ color: p.hull, rows: 10, variation: 0.16, seed: livery === 'pirate' ? 7 : 8 })
  const hull = std('#ffffff', { roughness: 0.75 })
  if (hullTex) {
    hull.map = hullTex.map
    hull.bumpMap = hullTex.bumpMap
    hull.bumpScale = 0.004
    hull.roughnessMap = hullTex.roughnessMap
    hullTex.map.repeat.set(0.7, 2.2)
    hullTex.bumpMap.repeat.set(0.7, 2.2)
    hullTex.roughnessMap.repeat.set(0.7, 2.2)
  } else hull.color.set(p.hull)
  hullShader(hull, p, livery)
  const hullPlain = std('#ffffff', { roughness: 0.75 })
  if (hullTex) {
    hullPlain.map = hullTex.map
    hullPlain.bumpMap = hullTex.bumpMap
    hullPlain.bumpScale = 0.004
  } else hullPlain.color.set(p.hull)
  let lidOuter = hullPlain
  if (livery === 'navy') {
    const lidTex = plankTextures({ color: '#d9bd78', rows: 10, variation: 0.1, seed: 9 })
    lidOuter = std('#ffffff', { roughness: 0.7 })
    if (lidTex) {
      lidOuter.map = lidTex.map
      lidOuter.bumpMap = lidTex.bumpMap
      lidOuter.bumpScale = 0.003
    } else lidOuter.color.set('#d9bd78')
  }

  const deckTex = plankTextures({ color: p.deck, rows: 12, variation: 0.12, seed: 21, seam: 'rgba(20,14,8,0.9)' })
  const deck = std('#ffffff', { roughness: 0.9 })
  if (deckTex) {
    deck.map = deckTex.map
    deck.bumpMap = deckTex.bumpMap
    deck.bumpScale = 0.003
    deck.roughnessMap = deckTex.roughnessMap
    for (const t of [deckTex.map, deckTex.bumpMap, deckTex.roughnessMap]) t.repeat.set(0.6, 1.7)
  } else deck.color.set(p.deck)

  const innerTex = plankTextures({ color: p.bulwarkInner, rows: 6, variation: 0.1, seed: 31, nails: true })
  const bulwarkInner = std('#ffffff', { roughness: 0.8 })
  if (innerTex) {
    bulwarkInner.map = innerTex.map
    bulwarkInner.bumpMap = innerTex.bumpMap
    bulwarkInner.bumpScale = 0.003
    for (const t of [innerTex.map, innerTex.bumpMap]) t.repeat.set(0.8, 4)
  } else bulwarkInner.color.set(p.bulwarkInner)

  const timberTex = plankTextures({ color: '#3a2a1a', rows: 4, variation: 0.1, seed: 41, nails: false })
  const timber = std('#ffffff', { roughness: 0.8 })
  if (timberTex) {
    timber.map = timberTex.map
    timber.bumpMap = timberTex.bumpMap
    timber.bumpScale = 0.002
    for (const t of [timberTex.map, timberTex.bumpMap]) t.repeat.set(1, 1)
  } else timber.color.set('#3a2a1a')

  const sparTex = plankTextures({ color: '#8a6a44', rows: 3, variation: 0.08, seed: 43, nails: false })
  const spar = std('#ffffff', { roughness: 0.75 })
  if (sparTex) {
    spar.map = sparTex.map
    spar.bumpMap = sparTex.bumpMap
    spar.bumpScale = 0.002
  } else spar.color.set('#8a6a44')

  const sailTex = sailclothTextures(p.sail, livery === 'pirate' ? 3 : 4)
  const sail = std('#ffffff', { side: THREE.DoubleSide, roughness: 0.95 })
  if (sailTex) {
    sail.map = sailTex.map
    sail.bumpMap = sailTex.bumpMap
    sail.bumpScale = 0.004
  } else sail.color.set(p.sail)
  const sailScorched = std('#15100c', { side: THREE.DoubleSide, roughness: 1 })
  if (sailTex) {
    sailScorched.bumpMap = sailTex.bumpMap
    sailScorched.bumpScale = 0.004
  }

  const ropeTex = ropeTextures(p.rope)
  const rope = std('#ffffff', { roughness: 1 })
  if (ropeTex) {
    rope.map = ropeTex.map
    rope.bumpMap = ropeTex.bumpMap
    rope.bumpScale = 0.002
  } else rope.color.set(p.rope)

  const ironTex = metalTextures('#2b2b2e', '#6a6560', 5)
  const iron = std('#ffffff', { roughness: 0.55, metalness: 0.75 })
  if (ironTex) {
    iron.map = ironTex.map
    iron.roughnessMap = ironTex.roughnessMap
  } else iron.color.set('#2b2b2e')
  const brassTex = metalTextures(livery === 'pirate' ? '#9c7a36' : '#d1a84a', '#5a4414', 6)
  const brass = std('#ffffff', { roughness: 0.35, metalness: 0.9 })
  if (brassTex) {
    brass.map = brassTex.map
    brass.roughnessMap = brassTex.roughnessMap
  } else brass.color.set('#c19a46')

  const glass = new THREE.MeshPhysicalMaterial({ color: '#bfe3f2', roughness: 0.05, metalness: 0, transmission: 0, /* no transmission pass: it doubles every draw call in the scene */ thickness: 0.02, transparent: true, opacity: 0.75 })

  const flagTex = flagTexture(p.flag)
  const flag = std('#ffffff', { side: THREE.DoubleSide, roughness: 0.9 })
  if (flagTex) {
    flag.map = flagTex
    flag.transparent = true
    flag.alphaTest = 0.4
  } else flag.color.set(p.flag === 'jolly-roger' ? '#111' : '#c1121f')

  const netTex = nettingTexture()
  const netting = std('#8a7555', { side: THREE.DoubleSide, roughness: 1, transparent: true, alphaTest: 0.5 })
  if (netTex) {
    netting.map = netTex
    netTex.repeat.set(8, 2)
  }

  const scorchTex = scorchTexture()
  const scorch = std('#120c08', { transparent: true, roughness: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })
  if (scorchTex) scorch.map = scorchTex
  const splinter = std('#1a120b', { roughness: 1 })
  const windowTex = windowTexture(livery === 'pirate' ? '#8f7035' : '#d4af37')
  const window = std('#ffffff', { roughness: 0.3, metalness: 0.2 })
  if (windowTex) window.map = windowTex
  const lanternGlow = std('#ffb347', { emissive: '#ff9a2a', emissiveIntensity: 2.2, roughness: 0.6 })

  const m: BrigMaterials = {
    hull,
    hullPlain,
    lidOuter,
    bulwarkInner,
    deck,
    timber,
    spar,
    trim: std(p.trim, { roughness: 0.7 }),
    accent: std(p.accent, { roughness: 0.4, metalness: 0.6 }),
    sail,
    sailScorched,
    rope,
    iron,
    brass,
    glass,
    flag,
    netting,
    scorch,
    splinter,
    window,
    lanternGlow,
  }
  CACHE.set(livery, m)
  return m
}
