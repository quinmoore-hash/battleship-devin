/**
 * Livery materials unique to the Sloop (hull planking, anti-fouling, wales, trim, deck, spars, canvas,
 * flags). Iron / brass / rope / glass come from the shared kit so kit upgrades flow through.
 */
import * as THREE from 'three'
import { shipMaterials, type ShipMaterials } from '../kit'
import type { Livery } from '../types'
import { antifoulTexture, canvasTexture, charTexture, jollyRogerTexture, plankBump, plankTexture, redEnsignTexture, tatterAlpha } from './textures'

export interface SloopMaterials {
  kit: ShipMaterials
  /** Topsides planking (waterline → deck). */
  hull: THREE.MeshStandardMaterial
  /** Below the waterline. */
  bottom: THREE.MeshStandardMaterial
  /** Boot-top stripe at the waterline. */
  bootTop: THREE.MeshStandardMaterial
  /** Wales / rubbing strakes. */
  wale: THREE.MeshStandardMaterial
  /** Bulwark outer planking (navy: painted gun stripe). */
  bulwark: THREE.MeshStandardMaterial
  /** Bulwark inboard face / gun-port lid inside. */
  bulwarkInner: THREE.MeshStandardMaterial
  /** Cap rail, trim mouldings, name board. */
  trim: THREE.MeshStandardMaterial
  /** Gilt / painted highlight (navy gold, pirate dull brass-red). */
  accent: THREE.MeshStandardMaterial
  deck: THREE.MeshStandardMaterial
  /** Cabin trunk & hatch coamings (varnished). */
  cabin: THREE.MeshStandardMaterial
  /** Mast, boom, gaff, bowsprit, tiller (oiled spar). */
  spar: THREE.MeshStandardMaterial
  /** Base sail material; sails clone it to animate alphaTest / scorch per sail. */
  sail: THREE.MeshStandardMaterial
  flag: THREE.MeshStandardMaterial
  char: THREE.MeshStandardMaterial
  lantern: THREE.MeshStandardMaterial
}

const CACHE = new Map<Livery, SloopMaterials>()

const std = (params: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...params })

export function sloopMaterials(livery: Livery): SloopMaterials {
  const hit = CACHE.get(livery)
  if (hit) return hit
  const kit = shipMaterials(livery)
  const pirate = livery === 'pirate'
  const seed = pirate ? 11 : 23

  const hullMap = pirate
    ? plankTexture({ seed, base: '#3a2919', dark: '#150d08', light: '#5e4428', rows: 8, nails: 6, streaks: 18 })
    : plankTexture({ seed, base: '#b4895a', dark: '#7a5531', light: '#d6b283', rows: 8, nails: 6, streaks: 8 })
  hullMap.repeat.set(1, 1)
  const hullBump = plankBump(8, seed)
  const hull = std({ map: hullMap, bumpMap: hullBump, bumpScale: 0.6, roughness: pirate ? 0.78 : 0.7 })

  const bottomMap = pirate ? antifoulTexture(seed, '#3a3b2c', '#8d8a78', '#3f5a2a') : antifoulTexture(seed, '#d8d2c0', '#b9b2a0', '#4f6b32')
  const bottom = std({ map: bottomMap, roughness: 0.95 })

  const bootTop = std({ color: pirate ? '#5a1414' : '#1d1d1f', roughness: 0.7 })
  const wale = std({ color: pirate ? '#120c08' : '#17120e', roughness: 0.6, map: plankBump(2, seed + 5) })

  const bulwarkMap = pirate
    ? plankTexture({ seed: seed + 1, base: '#241810', dark: '#100907', light: '#3f2b1a', rows: 3, nails: 10, streaks: 6 })
    : plankTexture({ seed: seed + 1, base: '#d9a441', dark: '#9c6f23', light: '#f0c766', rows: 3, nails: 10, streaks: 4 })
  const bulwark = std({ map: bulwarkMap, bumpMap: plankBump(3, seed + 1), bumpScale: 0.4, roughness: 0.75 })
  const bulwarkInner = std({ color: pirate ? '#7d1b1b' : '#9c2a24', roughness: 0.8, map: plankBump(3, seed + 2) })

  const trim = std({ color: pirate ? '#8c1d1d' : '#1f3f7a', roughness: 0.55 })
  const accent = std({ color: pirate ? '#a8431f' : '#d8b24a', roughness: 0.35, metalness: pirate ? 0.2 : 0.7 })

  const deckMap = pirate
    ? plankTexture({ seed: seed + 3, base: '#8a6f4e', dark: '#5a4530', light: '#b39a75', rows: 10, nails: 14, streaks: 3 })
    : plankTexture({ seed: seed + 3, base: '#c6ad84', dark: '#8d7452', light: '#e3d0ad', rows: 10, nails: 14, streaks: 2 })
  deckMap.repeat.set(0.8, 1.6)
  const deckBump = plankBump(10, seed + 3)
  deckBump.repeat.copy(deckMap.repeat)
  const deck = std({ map: deckMap, bumpMap: deckBump, bumpScale: 0.5, roughness: 0.9 })

  const cabinMap = pirate
    ? plankTexture({ seed: seed + 4, base: '#4c3320', dark: '#2a1a0f', light: '#6d4d30', rows: 4, nails: 8 })
    : plankTexture({ seed: seed + 4, base: '#7a5433', dark: '#4e3420', light: '#a07650', rows: 4, nails: 8 })
  const cabin = std({ map: cabinMap, bumpMap: plankBump(4, seed + 4), bumpScale: 0.35, roughness: 0.5 })

  const sparMap = plankTexture({ seed: seed + 6, base: pirate ? '#5a3f28' : '#8b6a45', dark: pirate ? '#2e1f12' : '#5a4228', light: pirate ? '#7a5a3a' : '#b08b5e', rows: 1, size: 256 })
  sparMap.repeat.set(4, 1)
  const spar = std({ map: sparMap, roughness: 0.55 })

  const sailMap = pirate ? canvasTexture(seed + 7, '#8c7b66', '#a08f78', '#5a4d40') : canvasTexture(seed + 7, '#efe4cf', '#d8c8a6', '#b9a37e')
  const sail = std({ map: sailMap, alphaMap: tatterAlpha(seed + 8), alphaTest: 0.001, side: THREE.DoubleSide, roughness: 0.95, shadowSide: THREE.DoubleSide })

  const flag = std({ map: pirate ? jollyRogerTexture() : redEnsignTexture(), side: THREE.DoubleSide, roughness: 0.9 })
  const char = std({ map: charTexture(seed + 9), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, roughness: 1, color: '#000' })
  char.color.set('#ffffff')
  const lantern = new THREE.MeshStandardMaterial({ color: '#ffb347', emissive: '#ff9a2a', emissiveIntensity: 2.2, roughness: 0.3 })

  const m: SloopMaterials = { kit, hull, bottom, bootTop, wale, bulwark, bulwarkInner, trim, accent, deck, cabin, spar, sail, flag, char, lantern }
  CACHE.set(livery, m)
  return m
}
