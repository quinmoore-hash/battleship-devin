import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Coord } from '../../engine'
import { BOARD_LAYOUT, cellToWorld, type Vec3 } from '../../scene/layout'
import { sampleWaveHeight } from '../../scene/waves'
import type { Livery } from '../../ships/types'
import { useGameStore } from '../../store/gameStore'
import { bobAt, debrisState, flotsamLayout, type DebrisPiece, type FlotsamPiece } from './debris'
import { DebrisMesh } from './pieces'
import { BakedGroup } from '../../ships/bake'

/** Water surface under a floating object. The water mesh is at y = 0 plus the Gerstner displacement. */
/** Absolute world y of the water under (x, z) at scene time t. */
export const waterLevelAt = (x: number, z: number, t: number): number => BOARD_LAYOUT.surfaceY + sampleWaveHeight(x, z, t)

export interface DebrisProps {
  pieces: DebrisPiece[]
  progress: number
  livery: Livery
  timeScale?: number
}

/** Wreckage flung off the listing hull that lands and bobs exactly where `<Flotsam>` will later show it. */
export function Debris({ pieces, progress, livery, timeScale = 1 }: DebrisProps) {
  const reduced = useGameStore((s) => s.settings.reducedMotion)
  const refs = useRef<(THREE.Group | null)[]>([])
  const t = useRef(0)
  useFrame((_, delta) => {
    t.current += Math.min(delta, 0.1) * timeScale
    for (let i = 0; i < pieces.length; i++) {
      const g = refs.current[i]
      if (!g) continue
      const p = pieces[i]
      const s = debrisState(p, progress, t.current, waterLevelAt(p.x, p.z, t.current), reduced)
      g.visible = s.visible
      if (!s.visible) continue
      g.position.set(s.x, s.y, s.z)
      g.rotation.set(s.rx, s.ry, s.rz)
      g.scale.setScalar(s.scale)
    }
  })
  return (
    <group name="flotsam">
      {pieces.map((p, i) => (
        <group
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          visible={false}
        >
          <DebrisMesh kind={p.kind} livery={livery} />
        </group>
      ))}
    </group>
  )
}

export interface FlotsamProps {
  /** Board cells the wreck covered. */
  cells: readonly Coord[]
  boardOrigin?: Vec3
  cellSize?: number
  seed: number
  livery?: Livery
}

/** Persistent wreckage bobbing on a sunk ship's cells. Same seed as the sink sequence => same pieces. */
export function Flotsam({ cells, boardOrigin = BOARD_LAYOUT.player.origin, cellSize = 1, seed, livery = 'pirate' }: FlotsamProps) {
  const pieces = useMemo(
    () => flotsamLayout(cells.map((c) => cellToWorld(c, boardOrigin, cellSize)), seed),
    [cells, boardOrigin, cellSize, seed],
  )
  return <FlotsamPieces pieces={pieces} livery={livery} />
}

export function FlotsamPieces({ pieces, livery }: { pieces: FlotsamPiece[]; livery: Livery }) {
  // One bake per wreck field (a few draw calls per sunk ship instead of ~3 per piece); the field
  // rides the swell as a whole, sampled at its centre.
  const root = useRef<THREE.Group>(null)
  const centre = useMemo(() => {
    if (pieces.length === 0) return { x: 0, z: 0, phase: 0 }
    let x = 0
    let z = 0
    for (const p of pieces) {
      x += p.x
      z += p.z
    }
    return { x: x / pieces.length, z: z / pieces.length, phase: pieces[0].phase }
  }, [pieces])
  useFrame(({ clock }) => {
    const g = root.current
    if (!g) return
    const t = clock.elapsedTime
    const bob = bobAt(t, centre.phase)
    g.position.y = waterLevelAt(centre.x, centre.z, t) + bob.y
    g.rotation.set(bob.rx * 0.5, 0, bob.rz * 0.5)
  })
  return (
    <group ref={root} name="flotsam">
      <BakedGroup>
        {pieces.map((p, i) => (
          <group key={i} position={[p.x, 0, p.z]} rotation-y={p.rotY} scale={p.scale}>
            <DebrisMesh kind={p.kind} livery={livery} />
          </group>
        ))}
      </BakedGroup>
    </group>
  )
}
