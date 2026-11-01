/** The one revealed cell as seen through the glass: a dark hull silhouette flash (ship) or a water glint (open water), 1.5 s. */
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { BOARD_LAYOUT, cellToWorld } from '../scene/layout'
import { useGameStore } from '../store/gameStore'
import { SPYGLASS_REVEAL_MS, useSpyglassStore, type SpyglassReveal as Reveal } from './Spyglass'

export function SpyglassReveal() {
  const reveal = useSpyglassStore((s) => s.reveal)
  const perspective = useGameStore((s) => s.perspective)
  if (!reveal) return null
  return <Flash key={reveal.at} reveal={reveal} origin={BOARD_LAYOUT[perspective === 'human' ? 'enemy' : 'player'].origin} />
}

function Flash({ reveal, origin }: { reveal: Reveal; origin: readonly [number, number, number] }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  const group = useRef<THREE.Group>(null)
  const p = cellToWorld(reveal.coord, origin as [number, number, number])
  useFrame(() => {
    const k = (performance.now() - reveal.at) / SPYGLASS_REVEAL_MS
    if (k >= 1) {
      const st = useSpyglassStore.getState()
      if (st.reveal === reveal) st.setReveal(null)
      return
    }
    const pulse = 0.5 + 0.5 * Math.sin(k * Math.PI * 6)
    if (mat.current) mat.current.opacity = (1 - k) * (reveal.seen === 'ship' ? 0.55 + 0.35 * pulse : 0.35 + 0.45 * pulse)
    if (group.current) {
      const sc = reveal.seen === 'ship' ? 1 : 0.6 + 1.2 * k
      group.current.scale.set(sc, 1, sc)
    }
  })
  return (
    <group ref={group} position={[p[0], BOARD_LAYOUT.surfaceY + 0.04, p[2]]} rotation={reveal.seen === 'water' ? [-Math.PI / 2, 0, 0] : [0, 0, 0]}>
      {reveal.seen === 'ship' ? (
        <mesh position={[0, 0.1, 0]}>
          <boxGeometry args={[0.9, 0.2, 0.34]} />
          <meshBasicMaterial ref={mat} color="#120b05" transparent opacity={0.8} depthWrite={false} />
        </mesh>
      ) : (
        <mesh>
          <ringGeometry args={[0.18, 0.42, 24]} />
          <meshBasicMaterial ref={mat} color="#fff6d8" transparent opacity={0.6} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  )
}
