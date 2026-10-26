import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from 'react'
import * as THREE from 'three'
import { bakeObject, bakeStats, type BakeStats } from './bakeGeometry'

export { bakeObject, bakeStats, materialKey, geometrySignature, type BakeStats } from './bakeGeometry'

/**
 * Ship bake — turns a live procedural ship model (hundreds of small meshes) into a handful of
 * merged meshes, one per distinct material, shared by every instance of the same
 * (shipId, livery, lod, quality) key.
 *
 * How it works: `<ShipBakery>` (mounted once inside the Canvas) renders ONE hidden live copy of
 * every requested key. After it has had a frame to build, `bakeObject()` walks its Object3D tree,
 * bakes every static mesh's local transform into a cloned geometry and merges the clones per
 * material (`mergeGeometries`). `<BakedShip>` instances then render a cheap `clone()` of that
 * baked group — the clone shares geometry and materials, so N ships cost N × (#materials) draw
 * calls and zero extra GPU memory. The hidden live copy stays mounted so shared materials keep
 * their `useFrame`-driven uniforms (cloth wind, flags) and are never disposed under the bake.
 *
 * Rules (see ARCHITECTURE.md › Performance):
 * - Baked ships are static: damage / sinkProgress / firing do not change their shape. Only the
 *   lod-0 (camera-focused, cinematic) ship is rendered live, so those effects still show close up.
 * - Materials are grouped by `materialKey()` — parameter signature for stock materials, identity
 *   for anything with a custom shader hook — so two parts with identical-looking materials merge.
 * - The cache is bounded by the number of keys (≤ ships × liveries × lods × qualities) and lives
 *   for the page: rematches / Play Again re-use it, nothing grows per game.
 */

export type BakeKey = string

export const bakeKey = (id: string, livery: string, lod: number, quality: string): BakeKey => `${id}|${livery}|${lod}|${quality}`

interface Entry {
  key: BakeKey
  element: ReactElement
  object: THREE.Group | null
  framesMounted: number
}

const entries = new Map<BakeKey, Entry>()
const listeners = new Set<() => void>()
let version = 0
let bakeries = 0

const emit = () => {
  version++
  for (const l of listeners) l()
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const getVersion = () => version

/** True while a `<ShipBakery>` is mounted; without one `<Ship>` renders live models. */
export const bakeryActive = () => bakeries > 0

export function requestBake(key: BakeKey, element: ReactElement) {
  if (entries.has(key)) return
  entries.set(key, { key, element, object: null, framesMounted: 0 })
  emit()
}

export const getBaked = (key: BakeKey): THREE.Group | null => entries.get(key)?.object ?? null

/** Test / perf hook. */
export const bakeCacheSize = () => entries.size
export const bakeReport = (): Record<BakeKey, BakeStats | null> => Object.fromEntries([...entries.values()].map((e) => [e.key, (e.object?.userData.bakeStats as BakeStats | undefined) ?? null]))

/** Drops everything (tests only — the live app keeps the cache for the page lifetime). */
export function clearBakeCache() {
  for (const e of entries.values()) e.object?.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.())
  entries.clear()
  emit()
}

/**
 * Bakes its own children in place: they are rendered hidden for one frame, merged with
 * `bakeObject()` and replaced by the merged meshes. For static dressing (buoy corners, cove props)
 * that is built from many small JSX meshes. Children must be static — the baked copy never updates.
 */
export function BakedGroup({ children, castShadow }: { children: ReactNode; castShadow?: boolean }) {
  const src = useRef<THREE.Group>(null)
  const [baked, setBaked] = useState<THREE.Group | null>(null)
  const frames = useRef(0)
  useFrame(() => {
    if (baked || !src.current) return
    if (frames.current++ < 1) return
    const g = bakeObject(src.current)
    if (castShadow !== undefined) g.traverse((o) => void ((o as THREE.Mesh).isMesh && (o.castShadow = castShadow)))
    setBaked(g)
  })
  useEffect(() => () => baked?.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.()), [baked])
  return baked ? (
    <primitive object={baked} />
  ) : (
    <group ref={src} visible={false}>
      {children}
    </group>
  )
}

/**
 * Mount once inside the Canvas. Renders the hidden live copy of each requested key and bakes it
 * on the frame after it mounts.
 */
export function ShipBakery() {
  useSyncExternalStore(subscribe, getVersion)
  const groups = useRef(new Map<BakeKey, THREE.Group>())
  useEffect(() => {
    bakeries++
    emit()
    return () => {
      bakeries--
    }
  }, [])
  useFrame(() => {
    let changed = false
    for (const e of entries.values()) {
      if (e.object) continue
      const g = groups.current.get(e.key)
      if (!g) continue
      if (e.framesMounted++ < 1) continue
      e.object = bakeObject(g)
      changed = true
      if (typeof location !== 'undefined' && /[?&]perf/.test(location.search)) console.info('[bake]', e.key, JSON.stringify(e.object.userData.bakeStats), JSON.stringify(e.object.children.map((c, i) => `${(e.object!.userData.buckets as string[])[i] ?? c.type}:${bakeStats(c).triangles}`)))
    }
    if (changed) emit()
  })
  return (
    <group visible={false} name="ship-bakery">
      {[...entries.values()].map((e) => (
        <group
          key={e.key}
          ref={(el) => {
            if (el) groups.current.set(e.key, el)
            else groups.current.delete(e.key)
          }}
        >
          {e.element}
        </group>
      ))}
    </group>
  )
}

export interface BakedShipProps {
  bakeKey: BakeKey
  /** The live model element to bake (rendered hidden, once per key). */
  element: ReactElement
}

/** Renders the shared baked group for `bakeKey`, requesting the bake on first use. */
export function BakedShip({ bakeKey: key, element }: BakedShipProps) {
  useSyncExternalStore(subscribe, getVersion)
  useEffect(() => requestBake(key, element), [key, element])
  const baked = getBaked(key)
  const inst = useMemo(() => baked?.clone() ?? null, [baked])
  if (!inst) return null
  return <primitive object={inst} />
}
