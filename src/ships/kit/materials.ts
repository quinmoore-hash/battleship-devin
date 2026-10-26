import * as THREE from 'three'
import type { Livery } from '../types'
import {
  brass,
  canvasWeave,
  castIron,
  copperPlates,
  foulBottom,
  hex,
  jollyRoger,
  pennant,
  redEnsign,
  ropeTwist,
  windowGlass,
  woodPlain,
  woodPlanks,
  type PbrMaps,
} from './textures'

/**
 * Shared ship materials per livery. Everything is cached and shared between every ship on screen, so a
 * part must never mutate one of these (clone first). Textures are procedural (see `textures.ts`).
 *
 * Keys the ship classes already use (`hull`, `hullBelow`, `deck`, `trim`, `sail`, `rope`, `iron`,
 * `brass`, `glass`, `flag`) are stable; the rest were added by the kit.
 */
export interface ShipMaterials {
  /** Topsides planking (pirate: weathered dark oak; navy: varnished oak with an ochre band). */
  hull: THREE.Material
  /** Below the waterline (pirate: fouled tallow; navy: copper sheathing). */
  hullBelow: THREE.Material
  /** Holystoned deck planks. */
  deck: THREE.Material
  /** Painted trim: rails, stern, bulwark cap. */
  trim: THREE.Material
  /** Plain sailcloth (the `<Sail>` cloth shader derives from it). */
  sail: THREE.Material
  rope: THREE.Material
  iron: THREE.Material
  brass: THREE.Material
  glass: THREE.Material
  /** Ensign cloth (Jolly Roger / red ensign). */
  flag: THREE.Material
  /** Masts and yards. */
  spar: THREE.Material
  /** Bright plain oak: carriages, barrels, blocks. */
  oak: THREE.Material
  /** Dark tarred planks: bulwark inner faces, hatch coamings. */
  tarredPlanks: THREE.Material
  /** Solid livery accent colour. */
  paint: THREE.Material
  /** Gilt carvings (figurehead, stern decoration). */
  gold: THREE.Material
  /** Bundled furled canvas on a yard. */
  canvasFurled: THREE.Material
  /** Emissive lantern flame. */
  flame: THREE.MeshStandardMaterial
  /** Window glass (greenish, semi-transparent). */
  windowGlass: THREE.Material
  /** Blackened charred wood for holes and scorch. */
  char: THREE.Material
  livery: Livery
  accent: THREE.Color
  /** Raw maps for parts that build their own shaders. */
  maps: { sail: PbrMaps; flag: THREE.Texture | null; pennant: THREE.Texture | null; rope: PbrMaps; deck: PbrMaps }
}

const CACHE = new Map<Livery, ShipMaterials>()

function std(color: string, maps: PbrMaps | null, extra: Partial<THREE.MeshStandardMaterialParameters> = {}, repeat: [number, number] = [1, 1]) {
  // The baked colour map already carries the wood/canvas colour; `color` is only the fallback for DOM-less runs.
  const m = new THREE.MeshStandardMaterial({ color: maps?.map ? '#ffffff' : color, roughness: 0.8, metalness: 0, ...extra })
  if (maps?.map) {
    const tex = repeat[0] === 1 && repeat[1] === 1 ? maps.map : maps.map.clone()
    tex.repeat.set(repeat[0], repeat[1])
    m.map = tex
    if (maps.normalMap) {
      const n = repeat[0] === 1 && repeat[1] === 1 ? maps.normalMap : maps.normalMap.clone()
      n.repeat.set(repeat[0], repeat[1])
      m.normalMap = n
      m.normalScale = new THREE.Vector2(extra.normalScale?.x ?? 0.8, extra.normalScale?.y ?? 0.8)
    }
    if (maps.roughnessMap) {
      const r = repeat[0] === 1 && repeat[1] === 1 ? maps.roughnessMap : maps.roughnessMap.clone()
      r.repeat.set(repeat[0], repeat[1])
      m.roughnessMap = r
      m.roughness = 1
    }
  }
  return m
}

function build(livery: Livery): ShipMaterials {
  const pirate = livery === 'pirate'
  const accent = new THREE.Color(pirate ? '#8c1d1d' : '#1f3f7a')

  const hullMaps = pirate
    ? woodPlanks('hull-pirate', { seed: 11, light: hex('#8a6238'), dark: hex('#4a2f17'), rows: 10, tar: 0.3, plankLength: 300 })
    : woodPlanks('hull-navy', { seed: 12, light: hex('#8a5f33'), dark: hex('#4a3015'), rows: 10, tar: 0.1, plankLength: 300 })
  const belowMaps = pirate ? foulBottom('below-pirate', 21) : copperPlates('below-navy', 22)
  const deckMaps = woodPlanks('deck', {
    seed: pirate ? 31 : 32,
    light: pirate ? hex('#a88a5e') : hex('#c9ab7a'),
    dark: pirate ? hex('#6e5536') : hex('#8c6f48'),
    rows: 12,
    plankLength: 220,
    roughness: 0.82,
  })
  const trimMaps = woodPlanks(`trim-${livery}`, {
    seed: 41,
    light: hex('#6b4a2a'),
    dark: hex('#3a2612'),
    rows: 4,
    plankLength: 512,
    nails: false,
    paint: { color: pirate ? hex('#8c1d1d') : hex('#1f3f7a'), coverage: 0.92 },
  })
  const sparMaps = woodPlain(`spar-${livery}`, { seed: 51, light: hex('#7a5a36'), dark: hex('#3b2812'), tar: pirate ? 0.3 : 0.25 })
  const oakMaps = woodPlain('oak', { seed: 52, light: hex('#9a7246'), dark: hex('#5a3d20') })
  const tarredMaps = woodPlanks('tarred', { seed: 61, light: hex('#3a2816'), dark: hex('#1a1008'), rows: 8, tar: 0.7 })
  const sailMaps = pirate
    ? canvasWeave('sail-pirate', { seed: 71, base: hex('#9c8c78'), stain: hex('#5a4e42'), grime: 0.45 })
    : canvasWeave('sail-navy', { seed: 72, base: hex('#e9dfc8'), stain: hex('#a8936c'), grime: 0.45 })
  const ropeMaps = ropeTwist(`rope-${livery}`, pirate ? [122, 98, 62] : [150, 124, 86], 81)
  const ironMaps = castIron('iron', 91, pirate ? 0.45 : 0.25)
  const brassMaps = brass('brass', 101)

  const flagTex = pirate ? jollyRoger() : redEnsign()
  const pennantTex = pennant(livery)

  const m: ShipMaterials = {
    livery,
    accent,
    hull: std(pirate ? '#7a5230' : '#6a4a2a', hullMaps, { roughness: 0.75 }, [2, 1]),
    hullBelow: pirate ? std('#6f6a5c', belowMaps, { roughness: 0.9 }, [2, 1]) : std('#b86b45', belowMaps, { roughness: 0.5, metalness: 0.55 }, [2, 1]),
    deck: std(pirate ? '#8a6a44' : '#a98a62', deckMaps, { roughness: 0.85 }, [1, 1]),
    trim: std(pirate ? '#8c1d1d' : '#1f3f7a', trimMaps, { roughness: 0.6 }),
    sail: std(pirate ? '#948270' : '#efe6d2', sailMaps, { side: THREE.DoubleSide, roughness: 0.95 }),
    rope: std(pirate ? '#6d5a3d' : '#8a7355', ropeMaps, { roughness: 1 }, [6, 1]),
    iron: std('#2a2a2d', ironMaps, { roughness: 0.5, metalness: 0.75 }),
    brass: std(pirate ? '#b8893a' : '#d1a64a', brassMaps, { roughness: 0.3, metalness: 0.9 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: '#bfe3ee',
      roughness: 0.06,
      metalness: 0,
      transparent: true,
      opacity: 0.4,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    flag: std(pirate ? '#111' : '#c8102e', flagTex ? { map: flagTex, normalMap: null, roughnessMap: null } : null, { side: THREE.DoubleSide, roughness: 0.9 }),
    spar: std(pirate ? '#5c3f22' : '#5a4024', sparMaps, { roughness: 0.7 }, [1, 4]),
    oak: std('#8a6a44', oakMaps, { roughness: 0.8 }),
    tarredPlanks: std('#2a1c10', tarredMaps, { roughness: 0.7 }),
    paint: new THREE.MeshStandardMaterial({ color: accent, roughness: 0.55, metalness: 0 }),
    gold: new THREE.MeshStandardMaterial({ color: pirate ? '#9c7a2e' : '#d9b24a', roughness: 0.35, metalness: 0.9, map: brassMaps.map ?? undefined }),
    canvasFurled: std(pirate ? '#4a403a' : '#d9cfb6', sailMaps, { roughness: 0.95 }, [1, 0.25]),
    flame: new THREE.MeshStandardMaterial({ color: "#ffe9b0", emissive: "#ffb347", emissiveIntensity: 3, roughness: 1, toneMapped: false }),
    windowGlass: new THREE.MeshPhysicalMaterial({
      map: windowGlass() ?? undefined,
      color: '#ffffff',
      roughness: 0.15,
      metalness: 0,
      transparent: true,
      opacity: 0.72,
      clearcoat: 0.8,
      side: THREE.DoubleSide,
    }),
    char: new THREE.MeshStandardMaterial({ color: '#0a0604', roughness: 1, metalness: 0 }),
    maps: { sail: sailMaps, flag: flagTex, pennant: pennantTex, rope: ropeMaps, deck: deckMaps },
  }
  return m
}

export function shipMaterials(livery: Livery): ShipMaterials {
  let m = CACHE.get(livery)
  if (m) return m
  m = build(livery)
  CACHE.set(livery, m)
  return m
}
