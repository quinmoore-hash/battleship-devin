import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { PlacedShip, ShipId } from '../../engine'
import { BOARD_LAYOUT, cellToWorld, type Vec3 } from '../../scene/layout'
import { sampleWaveHeight, sampleWaveNormal } from '../../scene/waves'
import { SHIPS, Ship, damageOf, shipWorldTransform } from '../../ships'
import type { CellDamage, Livery, ShipModelProps } from '../../ships/types'
import { useGameStore } from '../../store/gameStore'
import { Bubbles } from './Bubbles'
import { Debris } from './Debris'
import { HullWash } from './HullWash'
import { Steam } from './Steam'
import { Whirlpool } from './Whirlpool'
import { debrisPieces, footprintCenters } from './debris'
import { lastHitIndex, placedShipSeed, sinkBias, sinkPose, window01, type HullDims, type SinkPose } from './pose'

/** Resting height of ship roots above the water plane (the scene's board convention). */
export const SURFACE_Y: number = BOARD_LAYOUT.surfaceY

export function useSinkPose(progress: number, seed: number, hull: HullDims, damage?: readonly CellDamage[], lastHit?: number): SinkPose {
  return useMemo(() => sinkPose(progress, { seed, hull, damage, lastHit }), [progress, seed, hull, damage, lastHit])
}

/** Pose for a placed ship from the engine: seed, hull and killing blow all derived from the placement. */
export function placedSinkPose(ship: PlacedShip, progress: number): SinkPose {
  return sinkPose(progress, {
    seed: placedShipSeed(ship),
    hull: SHIPS[ship.spec.id].anchors.hull,
    damage: damageOf(ship),
    lastHit: lastHitIndex(ship),
  })
}

export interface SinkingShipProps extends Pick<ShipModelProps, 'lod' | 'quality' | 'sails' | 'phase' | 'firing'> {
  ship: ShipId
  livery: Livery
  damage: readonly CellDamage[]
  /** 0 afloat … 1 wreck on the bottom. Drive it from `sinkProgressAt` or a scrubber. */
  progress: number
  /** Either a placed ship from the engine (position, heading, seed and killing blow come from it)… */
  placed?: PlacedShip
  boardOrigin?: Vec3
  cellSize?: number
  /** …or an explicit root transform (defaults: origin at the surface, bow toward +x). */
  position?: Vec3
  rotationY?: number
  seed?: number
  lastHit?: number
  /** Multiplies the clock of every water effect (0.4 = slow motion). The pose itself follows `progress`. */
  timeScale?: number
  /** Turn off the water effects (pose only). */
  effects?: boolean
  /** Turn off the flying wreckage (keeps bubbles/wash/whirlpool/steam). */
  debris?: boolean
}

/**
 * A ship going down: wraps `<Ship>` with the sink pose and everything that happens in the water around it
 * (hull wash, bubbles, whirlpool, flung debris, steam from burning sections). Models shred their own sails
 * and snap masts from `sinkProgress`; this owns the root transform.
 */
export function SinkingShip({
  ship,
  livery,
  damage,
  progress,
  placed,
  boardOrigin = BOARD_LAYOUT.player.origin,
  cellSize = 1,
  position,
  rotationY,
  seed,
  lastHit,
  timeScale = 1,
  effects = true,
  debris = true,
  ...model
}: SinkingShipProps) {
  const reduced = useGameStore((s) => s.settings.reducedMotion)
  const def = SHIPS[ship]
  const transform = useMemo(() => {
    if (placed) return shipWorldTransform(placed, boardOrigin, cellSize)
    return { position: position ?? ([0, SURFACE_Y, 0] as Vec3), rotationY: rotationY ?? 0 }
  }, [placed, boardOrigin, cellSize, position, rotationY])
  const theSeed = seed ?? (placed ? placedShipSeed(placed) : 1)
  const theLastHit = lastHit ?? (placed ? lastHitIndex(placed) : undefined)
  const pose = useSinkPose(progress, theSeed, def.anchors.hull, damage, theLastHit)
  const bias = useMemo(() => sinkBias(theSeed, damage, theLastHit), [theSeed, damage, theLastHit])

  const centers = useMemo(
    () => (placed ? placed.cells.map((c) => cellToWorld(c, boardOrigin, cellSize)) : footprintCenters(transform.position, transform.rotationY, def.length)),
    [placed, boardOrigin, cellSize, transform, def.length],
  )
  const pieces = useMemo(
    () => debrisPieces(centers, theSeed, { position: transform.position, rotationY: transform.rotationY, hull: def.anchors.hull, deckY: def.anchors.deckY, side: bias.side }),
    [centers, theSeed, transform, def, bias.side],
  )

  const outer = useRef<THREE.Group>(null)
  const inner = useRef<THREE.Group>(null)
  // live water level under the hull; re-rendered only when it moves > 2 cm so the effects stay cheap
  const [waterY, setWaterY] = useState(0)
  const lastWater = useRef(0)
  useFrame(({ clock }) => {
    const [x, y, z] = transform.position
    const t = clock.elapsedTime
    const wave = sampleWaveHeight(x, z, t)
    if (Math.abs(wave - lastWater.current) > 0.02) {
      lastWater.current = wave
      setWaterY(wave)
    }
    // gentle bobbing that the sea stops caring about once the hull is going under
    const afloat = (1 - window01(progress, 0.3, 0.6)) * (reduced ? 0.4 : 1)
    const n = sampleWaveNormal(x, z, t)
    if (outer.current) {
      outer.current.position.set(x, y - pose.depth + wave * 0.8 * afloat, z)
      outer.current.rotation.y = transform.rotationY + pose.yaw
    }
    if (inner.current) inner.current.rotation.set(pose.roll + n[2] * 0.6 * afloat, 0, pose.pitch - n[0] * 0.6 * afloat)
  })

  const hull = def.anchors.hull
  return (
    <group>
      <group ref={outer} position={transform.position} rotation-y={transform.rotationY}>
        <group ref={inner}>
          <Ship id={ship} livery={livery} damage={damage} sinkProgress={progress} {...model} />
        </group>
      </group>
      {effects && (
        <>
          <group position={[transform.position[0], transform.position[1], transform.position[2]]} rotation-y={transform.rotationY}>
            <HullWash length={hull.length} beam={hull.beam} progress={progress} timeScale={timeScale} waterY={waterY} />
            <Bubbles progress={progress} length={hull.length} beam={hull.beam} seed={theSeed} timeScale={timeScale} waterY={waterY} />
            <Whirlpool progress={progress} radius={hull.length * 0.75} timeScale={timeScale} waterY={waterY} />
          </group>
          {debris && <Debris pieces={pieces} progress={progress} livery={livery} timeScale={timeScale} />}
          <Steam pose={pose} damage={damage} position={transform.position} rotationY={transform.rotationY} deckY={def.anchors.deckY} waterY={transform.position[1] + waterY} />
        </>
      )}
    </group>
  )
}
