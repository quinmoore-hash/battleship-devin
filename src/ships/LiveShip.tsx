import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SHADOW_MIN_TRIS } from './bakeGeometry'

/**
 * Wraps a live procedural model and disposes every geometry its subtree ever held when it unmounts
 * (lod 0 → baked, end of a sink, quit), unless another object in the scene still uses it — module-level
 * shared geometry is simply re-uploaded the next time a live model needs it. The ship models build their
 * geometry in `useMemo` (and rebuild some of it while sinking), so without this each live mount leaks
 * ~100–400 `renderer.info.memory.geometries` (BUG-323 / BUG-300).
 */
export function LiveShip({ children, shadowPolicy = true }: { children: ReactNode; shadowPolicy?: boolean }) {
  const group = useRef<THREE.Group>(null)
  const scene = useThree((s) => s.scene)
  const seen = useRef(new Set<THREE.BufferGeometry>())
  useLayoutEffect(() => {
    group.current?.traverse((o) => {
      const g = (o as THREE.Mesh).geometry
      if (!g) return
      seen.current.add(g)
      // same shadow policy as the baked copies (`bakeGeometry`): a close-up live model is hundreds of small meshes
      // and every one of them is a draw in the shadow pass (BUG-503's 1 000-draw frames), so only big parts cast
      if (shadowPolicy && o.castShadow && (g.index ? g.index.count : g.getAttribute('position')?.count ?? 0) / 3 < SHADOW_MIN_TRIS) o.castShadow = false
    })
  })
  useEffect(() => {
    const geometries = seen.current
    return () => {
      const inUse = new Set<THREE.BufferGeometry>()
      scene.traverse((o) => {
        const g = (o as THREE.Mesh).geometry
        if (g) inUse.add(g)
      })
      for (const g of geometries) if (!inUse.has(g)) g.dispose()
      geometries.clear()
    }
  }, [scene])
  return <group ref={group}>{children}</group>
}
