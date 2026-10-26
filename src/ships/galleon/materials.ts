/**
 * Galleon-specific PBR materials per livery, built on the procedural textures. The generic kit palette
 * (`shipMaterials`) is still used for kit parts (cannons, ropes, barrels); these cover the hull, decks,
 * castles, carvings and sails that the galleon authors itself.
 */
import * as THREE from 'three'
import type { Livery } from '../types'
import { barnacleTexture, carvedTexture, flagTexture, ironTexture, panelTexture, plankTexture, sailTexture, tornAlpha } from './textures'

export interface GalleonMaterials {
  planks: THREE.MeshStandardMaterial
  below: THREE.MeshStandardMaterial
  deck: THREE.MeshStandardMaterial
  deckInner: THREE.MeshStandardMaterial
  wale: THREE.MeshStandardMaterial
  panels: THREE.MeshStandardMaterial
  carved: THREE.MeshStandardMaterial
  trim: THREE.MeshStandardMaterial
  gilt: THREE.MeshStandardMaterial
  iron: THREE.MeshStandardMaterial
  brass: THREE.MeshStandardMaterial
  glass: THREE.MeshPhysicalMaterial
  rope: THREE.MeshStandardMaterial
  sail: THREE.MeshStandardMaterial
  sailScorched: THREE.MeshStandardMaterial
  flag: THREE.MeshStandardMaterial
  charred: THREE.MeshStandardMaterial
  splinter: THREE.MeshStandardMaterial
  lantern: THREE.MeshStandardMaterial
  portLid: THREE.MeshStandardMaterial
  /** Sail with torn alpha, per quantised torn level (0.25 … 1). */
  tornSail: (level: number, scorched: boolean) => THREE.MeshStandardMaterial
}

const CACHE = new Map<Livery, GalleonMaterials>()

const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...p })

function withMaps(mat: THREE.MeshStandardMaterial, map: THREE.Texture | null, bump: THREE.Texture | null, repeat: [number, number], bumpScale = 0.02) {
  if (map) {
    map.repeat.set(...repeat)
    mat.map = map
  }
  if (bump) {
    bump.repeat.set(...repeat)
    mat.bumpMap = bump
    mat.bumpScale = bumpScale
  }
  return mat
}

export function galleonMaterials(livery: Livery): GalleonMaterials {
  const hit = CACHE.get(livery)
  if (hit) return hit
  const pirate = livery === 'pirate'

  const hullWood = pirate ? { base: '#3a2516', dark: '#160c06', light: '#5a3d26' } : { base: '#a4805a', dark: '#5a3e24', light: '#cdaa7d' }
  const deckWood = pirate ? { base: '#6d5236', dark: '#3a2816', light: '#8f7352' } : { base: '#b89b72', dark: '#6e5536', light: '#d9c39c' }
  const planks = withMaps(std({ color: '#ffffff', roughness: 0.78 }), plankTexture({ ...hullWood, rows: 8, perRow: 3, seed: 21 }), plankTexture({ ...hullWood, rows: 8, perRow: 3, seed: 21, bump: true }), [1, 1], 0.015)
  const below = withMaps(std({ color: '#ffffff', roughness: 0.9 }), barnacleTexture(pirate ? '#3a2a1c' : '#8a4a30'), null, [1, 1])
  const deck = withMaps(std({ color: '#ffffff', roughness: 0.82 }), plankTexture({ ...deckWood, rows: 12, perRow: 4, seed: 33 }), plankTexture({ ...deckWood, rows: 12, perRow: 4, seed: 33, bump: true }), [1, 1], 0.012)
  const deckInner = withMaps(std({ color: '#ffffff', roughness: 0.85 }), plankTexture({ ...deckWood, rows: 6, perRow: 3, seed: 34, nails: false }), null, [1, 1])
  const wale = std({ color: pirate ? '#0f0a07' : '#1c120a', roughness: 0.7 })
  const panels = withMaps(std({ color: '#ffffff', roughness: 0.6 }), pirate ? panelTexture('#141010', '#8c1d1d', '#b8893a') : panelTexture('#1f3f7a', '#d1a64a', '#d1a64a'), null, [1, 1])
  const carved = withMaps(std({ color: '#ffffff', roughness: 0.5, metalness: 0.25 }), pirate ? carvedTexture('#1a0f0a', '#b8893a') : carvedTexture('#1f3f7a', '#e0b84f'), null, [1, 1])
  const trim = std({ color: pirate ? '#8c1d1d' : '#1f3f7a', roughness: 0.55 })
  const gilt = std({ color: pirate ? '#b8893a' : '#e0b84f', roughness: 0.3, metalness: 0.85 })
  const iron = withMaps(std({ color: '#ffffff', roughness: 0.5, metalness: 0.75 }), ironTexture(), null, [2, 2])
  const brass = std({ color: pirate ? '#9c7a3a' : '#d1a64a', roughness: 0.3, metalness: 0.9 })
  const glass = new THREE.MeshPhysicalMaterial({ color: '#b9dfe8', roughness: 0.08, metalness: 0, transmission: 0, /* transmission > 0 makes three render the whole opaque scene twice (transmission pass) */ thickness: 0.02, transparent: true, opacity: 0.85, emissive: '#ffb347', emissiveIntensity: pirate ? 0.25 : 0.15 })
  const rope = std({ color: pirate ? '#5e4a30' : '#8a7355', roughness: 1 })
  const sailColor = pirate ? '#8c7b66' : '#efe4cc'
  const seam = pirate ? '#3a3330' : '#c9b793'
  const sailMap = sailTexture(sailColor, seam)
  const sailBump = sailTexture(sailColor, seam, 3, true)
  const sail = withMaps(std({ color: '#ffffff', roughness: 0.95, side: THREE.DoubleSide }), sailMap, sailBump, [1, 1], 0.004)
  const sailScorched = withMaps(std({ color: pirate ? '#5a4a40' : '#6b5a48', roughness: 1, side: THREE.DoubleSide }), sailMap, sailBump, [1, 1], 0.004)
  const flag = withMaps(std({ color: '#ffffff', roughness: 0.9, side: THREE.DoubleSide }), flagTexture(livery), null, [1, 1])
  const charred = std({ color: '#0b0806', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  const splinter = std({ color: pirate ? '#5a3f28' : '#c9a373', roughness: 0.9 })
  const lantern = std({ color: '#ffb347', emissive: '#ff9a2a', emissiveIntensity: 2.2, roughness: 0.4 })
  const portLid = withMaps(std({ color: pirate ? '#8c1d1d' : '#c0392b', roughness: 0.7 }), null, null, [1, 1])

  const tornCache = new Map<string, THREE.MeshStandardMaterial>()
  const tornSail = (level: number, scorched: boolean) => {
    const q = Math.min(1, Math.max(0.25, Math.round(level * 4) / 4))
    const key = `${q}:${scorched}`
    let m = tornCache.get(key)
    if (!m) {
      m = (scorched ? sailScorched : sail).clone()
      const a = tornAlpha(q)
      if (a) {
        m.alphaMap = a
        m.transparent = true
        m.alphaTest = 0.5
        m.transparent = false
      }
      tornCache.set(key, m)
    }
    return m
  }

  const out: GalleonMaterials = { planks, below, deck, deckInner, wale, panels, carved, trim, gilt, iron, brass, glass, rope, sail, sailScorched, flag, charred, splinter, lantern, portLid, tornSail }
  CACHE.set(livery, out)
  return out
}
