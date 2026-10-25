import * as THREE from 'three'
import type { Livery } from '../types'

/**
 * Shared ship materials. PLACEHOLDER palette — the ship-detail-kit session replaces these with PBR
 * (plank normal maps, canvas weave, rope twist, worn brass) while keeping the keys stable.
 */
export interface ShipMaterials {
  hull: THREE.Material
  hullBelow: THREE.Material
  deck: THREE.Material
  trim: THREE.Material
  sail: THREE.Material
  rope: THREE.Material
  iron: THREE.Material
  brass: THREE.Material
  glass: THREE.Material
  flag: THREE.Material
}

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...extra })

const CACHE = new Map<Livery, ShipMaterials>()

export function shipMaterials(livery: Livery): ShipMaterials {
  let m = CACHE.get(livery)
  if (m) return m
  m =
    livery === 'pirate'
      ? {
          hull: std('#3b2614'),
          hullBelow: std('#5a3b22'),
          deck: std('#8a6a44'),
          trim: std('#8c1d1d'),
          sail: std('#1c1a19', { side: THREE.DoubleSide, roughness: 0.95 }),
          rope: std('#6d5a3d', { roughness: 1 }),
          iron: std('#2a2a2d', { roughness: 0.45, metalness: 0.7 }),
          brass: std('#b8893a', { roughness: 0.35, metalness: 0.8 }),
          glass: std('#9fd3e6', { roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.6 }),
          flag: std('#111', { side: THREE.DoubleSide }),
        }
      : {
          hull: std('#5b3f27'),
          hullBelow: std('#b86b45'),
          deck: std('#a98a62'),
          trim: std('#1f3f7a'),
          sail: std('#efe6d2', { side: THREE.DoubleSide, roughness: 0.95 }),
          rope: std('#8a7355', { roughness: 1 }),
          iron: std('#2a2a2d', { roughness: 0.45, metalness: 0.7 }),
          brass: std('#d1a64a', { roughness: 0.3, metalness: 0.85 }),
          glass: std('#9fd3e6', { roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.6 }),
          flag: std('#c8102e', { side: THREE.DoubleSide }),
        }
  CACHE.set(livery, m)
  return m
}
