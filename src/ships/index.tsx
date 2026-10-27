/**
 * ships module: the five pirate/navy ship classes, the shared detail kit, and `<Fleet>` which places
 * engine `PlacedShip`s on a board using the scene layout.
 *
 *   <Fleet ships livery revealed boardOrigin? sinkProgress? firing? />
 *   <Ship id livery damage … />              one ship in its own frame (bow = +x, y = 0 waterline)
 *   SHIPS[id] -> ShipDefinition               model component + anchors (cannons, masts, impact points)
 *   shipWorldTransform(placed, boardOrigin)   position / rotationY of a placed ship
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type ReactNode } from 'react'
import type * as THREE from 'three'
import type { PlacedShip, ShipId } from '../engine'
import { LodGroup } from '../perf/LodShip'
import { BakedShip, bakeKey, useBakeryActive } from './bake'
import { LiveShip } from './LiveShip'
import { BOARD_LAYOUT, cellToWorld, type Vec3 } from '../scene/layout'
import { sampleWaveHeight } from '../scene/waves'
import { BRIGANTINE } from './brigantine'
import { FRIGATE } from './frigate'
import { GALLEON } from './galleon'
import { MAN_O_WAR } from './man-o-war'
import { SLOOP } from './sloop'
import type { CannonRef, CellDamage, Livery, ShipDefinition, ShipModelProps } from './types'
import { lastHitIndex, placedShipSeed, sinkPose } from '../vfx/sinking/pose'

export * from './types'
export * as kit from './kit'

export const SHIPS: Record<ShipId, ShipDefinition> = {
  'man-o-war': MAN_O_WAR,
  galleon: GALLEON,
  frigate: FRIGATE,
  brigantine: BRIGANTINE,
  sloop: SLOOP,
}

export interface ShipProps extends ShipModelProps {
  id: ShipId
  /** A wreck frozen at a fixed `sinkProgress` (replay / photo): render the baked copy instead of the live sinking model. */
  staticWreck?: boolean
}

/**
 * A ship model. lod 0 renders the live procedural model (including the live sinking animation); lod ≥ 1
 * renders the shared baked copy from `./bake` (one merged mesh per material) when a `<ShipBakery>` is
 * mounted — a sinking ship too, posed by `<Fleet>` (a live lod-1 galleon is ~480 draws while it goes down,
 * BUG-404), and a settled wreck as one collapsed silhouette mesh.
 */
export function Ship({ id, staticWreck: _staticWreck, ...rest }: ShipProps) {
  const Model = SHIPS[id].Model
  const lod = rest.lod ?? 0
  const sink = rest.sinkProgress ?? 0
  const bakery = useBakeryActive()
  const live = lod === 0 || !bakery
  const wreck = sink >= 1
  const quality = rest.quality ?? 'high'
  const cells = rest.damage.length
  const intact = useMemo<CellDamage[]>(() => Array.from({ length: cells }, () => 'intact'), [cells])
  const element = useMemo(() => <Model livery={rest.livery} damage={intact} lod={lod} quality={quality} />, [Model, rest.livery, intact, lod, quality])
  if (live)
    return (
      <LiveShip>
        <Model {...rest} />
      </LiveShip>
    )
  return <BakedShip bakeKey={bakeKey(id, rest.livery, lod, quality) + (wreck ? '|wreck' : '')} element={element} wreck={wreck} />
}


/** Ships are modelled along +x (bow forward). Horizontal ships point toward +x; vertical ships point toward +z. */
export const shipRotationY = (orientation: PlacedShip['orientation']): number =>
  orientation === 'horizontal' ? 0 : -Math.PI / 2

export function shipWorldTransform(ship: PlacedShip, boardOrigin: Vec3 = BOARD_LAYOUT.player.origin, cellSize = 1) {
  const a = cellToWorld(ship.cells[0], boardOrigin, cellSize)
  const b = cellToWorld(ship.cells[ship.cells.length - 1], boardOrigin, cellSize)
  const position: Vec3 = [(a[0] + b[0]) / 2, boardOrigin[1], (a[2] + b[2]) / 2]
  return { position, rotationY: shipRotationY(ship.orientation) }
}

/** Per-cell damage from the engine's hit list; index 0 = the ship's origin cell (bow). */
export function damageOf(ship: PlacedShip, burning = true): CellDamage[] {
  return ship.cells.map((c) => (ship.hits.some((h) => h.x === c.x && h.y === c.y) ? (burning ? 'burning' : 'hit') : 'intact'))
}

export interface FleetProps {
  ships: PlacedShip[]
  livery: Livery
  /** false = only sunk ships are drawn (the enemy fleet stays hidden until sunk). */
  revealed?: boolean
  boardOrigin?: Vec3
  cellSize?: number
  /** Per `PlacedShip.uid`, 0..1 sink progress (driven by the sinking VFX / director). */
  sinkProgress?: Partial<Record<string, number>>
  firing?: Partial<Record<string, CannonRef[]>>
  /** Fixed detail level, or `'auto'` to pick per ship from camera distance each frame (`src/perf`). */
  lod?: ShipModelProps['lod'] | 'auto'
  quality?: ShipModelProps['quality']
  /** Wrecks are frozen (replay / photo): bake them like any other lod ≥ 1 ship instead of rendering the live sinking model. */
  staticWrecks?: boolean
}

/**
 * Ship root: rests with its waterline (model y = 0) on the board surface and rides the same wave bank as the
 * water and the grid floats; sinking lowers it by `depth` (BUG-110b: hulls used to hover 0.2 above the sea).
 */
function Afloat({ position, depth, rotationY, children }: { position: Vec3; depth: number; rotationY: number; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    const g = ref.current
    if (g) g.position.y = position[1] - depth + sampleWaveHeight(position[0], position[2], clock.elapsedTime)
  })
  return (
    <group ref={ref} position={[position[0], position[1] - depth, position[2]]} rotation-y={rotationY}>
      {children}
    </group>
  )
}

export function Fleet({ ships, livery, revealed = true, boardOrigin = BOARD_LAYOUT.player.origin, cellSize = 1, sinkProgress, firing, lod, quality, staticWrecks }: FleetProps) {
  return (
    <group>
      {ships.map((ship) => {
        const sunk = ship.hits.length >= ship.spec.length
        if (!revealed && !sunk) return null
        // Low tier (fixed lod 2): a finished wreck sits under the surface and its flotsam marks the cells — skip the hull
        if (sunk && lod === 2 && (sinkProgress?.[ship.uid] ?? 1) >= 1) return null
        const { position, rotationY } = shipWorldTransform(ship, boardOrigin, cellSize)
        // a wreck that has finished sinking sits under the surface: always the lod-2 silhouette
        const sink = sinkProgress?.[ship.uid] ?? (sunk ? 1 : 0)
        const pose = sinkPose(sink, { seed: placedShipSeed(ship), hull: SHIPS[ship.spec.id].anchors.hull, damage: damageOf(ship), lastHit: lastHitIndex(ship) })
        return (
          <Afloat key={ship.uid} position={position} depth={pose.depth} rotationY={rotationY + pose.yaw}>
            <group rotation={[pose.roll, 0, pose.pitch]}>
              {lod === 'auto' && sink < 1 ? (
                <LodGroup position={position} hullLength={ship.spec.length}>
                  {(autoLod) => <Ship id={ship.spec.id} livery={livery} damage={damageOf(ship)} sinkProgress={sink} firing={firing?.[ship.uid]} lod={autoLod} quality={quality} staticWreck={staticWrecks} phase={ship.origin.x * 1.7 + ship.origin.y} />}
                </LodGroup>
              ) : (
                <Ship id={ship.spec.id} livery={livery} damage={damageOf(ship)} sinkProgress={sink} firing={firing?.[ship.uid]} lod={lod === 'auto' ? 2 : lod} quality={quality} staticWreck={staticWrecks} phase={ship.origin.x * 1.7 + ship.origin.y} />
              )}
            </group>
          </Afloat>
        )
      })}
    </group>
  )
}
