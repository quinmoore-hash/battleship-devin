import { useFrame, useThree } from '@react-three/fiber'
import { useRef, useState } from 'react'
import * as THREE from 'three'
import type { Lod } from '../ships/types'
import { stepLod, type LodState } from './lod'
import { usePerf } from './store'

const tmp = new THREE.Vector3()

/**
 * Picks a ship's `lod` from its camera distance each frame with hysteresis and a 1 s dwell, capped
 * by the tier's `lod`. Re-renders the ship only when the level actually changes.
 */
export function useDistanceLod(position: readonly [number, number, number], hullLength: number): Lod {
  const maxDetail = usePerf().lod
  const camera = useThree((s) => s.camera)
  const [initial] = useState<LodState>(() => {
    const d = camera.position.distanceTo(tmp.set(position[0], position[1], position[2]))
    return stepLod({ lod: 2, since: -Infinity }, d, hullLength, 0, maxDetail)
  })
  const [lod, setLod] = useState<Lod>(initial.lod)
  const state = useRef<LodState>(initial)
  useFrame(({ camera, clock }) => {
    const d = camera.position.distanceTo(tmp.set(position[0], position[1], position[2]))
    const next = stepLod(state.current, d, hullLength, clock.elapsedTime, maxDetail)
    if (next !== state.current) {
      state.current = next
      setLod(next.lod)
    }
  })
  return Math.max(lod, maxDetail) as Lod
}

export interface LodGroupProps {
  position: readonly [number, number, number]
  hullLength: number
  children: (lod: Lod) => React.ReactNode
}

/** Render-prop wrapper around `useDistanceLod` for `<Fleet lod="auto">`. */
export function LodGroup({ position, hullLength, children }: LodGroupProps) {
  const lod = useDistanceLod(position, hullLength)
  return <>{children(lod)}</>
}
