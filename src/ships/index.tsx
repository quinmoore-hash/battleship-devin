/**
 * ships module: the five pirate/navy ship classes, the shared detail kit, and `<Fleet>` which places
 * engine `PlacedShip`s on a board using the scene layout.
 *
 *   <Fleet ships livery revealed boardOrigin? sinkProgress? firing? />
 *   <Ship id livery damage … />              one ship in its own frame (bow = +x, y = 0 waterline)
 *   SHIPS[id] -> ShipDefinition               model component + anchors (cannons, masts, impact points)
 *   shipWorldTransform(placed, boardOrigin)   position / rotationY of a placed ship
 */
import { useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import type * as THREE from 'three'
import type { PlacedShip, ShipId } from '../engine'
import { LodGroup } from '../perf/LodShip'
import { BakedShip, bakeKey, useBakeryActive } from './bake'
import { BOARD_LAYOUT, cellToWorld, type Vec3 } from '../scene/layout'
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
 * A ship model. lod 0 (and a ship mid-sink) renders the live procedural model; lod ≥ 1 renders the
 * shared baked copy from `./bake` (one merged mesh per material) when a `<ShipBakery>` is mounted.
 */
export function Ship({ id, staticWreck = false, ...rest }: ShipProps) {
  const Model = SHIPS[id].Model
  const lod = rest.lod ?? 0
  const sink = rest.sinkProgress ?? 0
  const bakery = useBakeryActive()
  const live = lod === 0 || (sink > 0 && sink < 1 && !staticWreck) || !bakery
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
  return <BakedShip bakeKey={bakeKey(id, rest.livery, lod, quality)} element={element} />
}

/**
 * Wraps a live procedural model and disposes every geometry its subtree ever held when it unmounts
 * (lod 0 → baked, end of a sink, quit), unless another object in the scene still uses it — module-level
 * shared geometry is simply re-uploaded the next time a live model needs it. The ship models build their
 * geometry in `useMemo` (and rebuild some of it while sinking), so without this each live mount leaks
 * ~100–400 `renderer.info.memory.geometries` (BUG-323 / BUG-300).
 */
function LiveShip({ children }: { children: ReactNode }) {
  const group = useRef<THREE.Group>(null)
  const scene = useThree((s) => s.scene)
  const seen = useRef(new Set<THREE.BufferGeometry>())
  useLayoutEffect(() => {
    group.current?.traverse((o) => {
      const g = (o as THREE.Mesh).geometry
      if (g) seen.current.add(g)
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
  /** Per ship id, 0..1 sink progress (driven by the sinking VFX / director). */
  sinkProgress?: Partial<Record<ShipId, number>>
  firing?: Partial<Record<ShipId, CannonRef[]>>
  /** Fixed detail level, or `'auto'` to pick per ship from camera distance each frame (`src/perf`). */
  lod?: ShipModelProps['lod'] | 'auto'
  quality?: ShipModelProps['quality']
  /** Wrecks are frozen (replay / photo): bake them like any other lod ≥ 1 ship instead of rendering the live sinking model. */
  staticWrecks?: boolean
}

export function Fleet({ ships, livery, revealed = true, boardOrigin = BOARD_LAYOUT.player.origin, cellSize = 1, sinkProgress, firing, lod, quality, staticWrecks }: FleetProps) {
  return (
    <group>
      {ships.map((ship) => {
        const sunk = ship.hits.length >= ship.spec.length
        if (!revealed && !sunk) return null
        // Low tier (fixed lod 2): a finished wreck sits under the surface and its flotsam marks the cells — skip the hull
        if (sunk && lod === 2 && (sinkProgress?.[ship.spec.id] ?? 1) >= 1) return null
        const { position, rotationY } = shipWorldTransform(ship, boardOrigin, cellSize)
        // a wreck that has finished sinking sits under the surface: always the lod-2 silhouette
        const sink = sinkProgress?.[ship.spec.id] ?? (sunk ? 1 : 0)
        const pose = sinkPose(sink, { seed: placedShipSeed(ship), hull: SHIPS[ship.spec.id].anchors.hull, damage: damageOf(ship), lastHit: lastHitIndex(ship) })
        return (
          <group key={ship.spec.id} position={[position[0], position[1] - pose.depth, position[2]]} rotation-y={rotationY + pose.yaw}>
            <group rotation={[pose.roll, 0, pose.pitch]}>
              {lod === 'auto' && sink < 1 ? (
                <LodGroup position={position} hullLength={ship.spec.length}>
                  {(autoLod) => <Ship id={ship.spec.id} livery={livery} damage={damageOf(ship)} sinkProgress={sink} firing={firing?.[ship.spec.id]} lod={autoLod} quality={quality} staticWreck={staticWrecks} phase={ship.origin.x * 1.7 + ship.origin.y} />}
                </LodGroup>
              ) : (
                <Ship id={ship.spec.id} livery={livery} damage={damageOf(ship)} sinkProgress={sink} firing={firing?.[ship.spec.id]} lod={lod === 'auto' ? 2 : lod} quality={quality} staticWreck={staticWrecks} phase={ship.origin.x * 1.7 + ship.origin.y} />
              )}
            </group>
          </group>
        )
      })}
    </group>
  )
}
