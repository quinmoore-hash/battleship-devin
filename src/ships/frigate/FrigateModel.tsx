/**
 * The frigate model component. Composes the static hull/furniture geometry (`hull.ts`, `furniture.ts`),
 * kit cannons behind hinged gun-port lids, the three masts + bowsprit (`rig.tsx`), flags, deck props and
 * per-cell damage. Shape-only: the root never moves (see `ShipModelProps`).
 */
import { useFrame } from '@react-three/fiber'
import { useMemo, useState } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { useGameStore } from '../../store/gameStore'
import { seededRandom } from '../../vfx/random'
import { Anchor, Barrel, Cannon, Crate, HullHole, RopeCoil, Wheel } from '../kit'
import type { CannonRef, CellDamage, Lod, ShipModelProps } from '../types'
import { CANNON_SCALE, FRIGATE_ANCHORS, GUN_AXIS_Y, MUZZLE_OUT } from './anchors'
import { FRIGATE as F, GUN_PORT_W, GUN_X, MASTS, bulwarkHalfWidth, cellCenterX, deckY, gunCell, gunX, railY, sectionHalfWidth } from './form'
import { PROP_SPOTS, buildFurniture } from './furniture'
import { box, breachGeometry, mergeGeometries } from './geometry'
import { PORT_LINTEL, PORT_SILL, buildHullParts, capRailTop, type PartKey } from './hull'
import { frigateMaterials, type FrigateMaterials } from './materials'
import { ClothTime } from './clothTime'
import { Bowsprit, FlagMesh, FrigateMast } from './rig'

const NO_SHADOW: Set<PartKey> = new Set(['glass', 'lantern', 'char', 'netting', 'waterline', 'lidInside'])
/** Kit cannon muzzle sits at local z = 0.45 × scale. */
const CANNON_MUZZLE = 0.45 * CANNON_SCALE

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const tick = (t: { value: number }, v: number) => {
  t.value = v
}

function cannonZ(x: number, runOut: boolean): number {
  const hw = bulwarkHalfWidth(x, deckY(x) + GUN_AXIS_Y)
  return hw + (runOut ? MUZZLE_OUT : -0.04) - CANNON_MUZZLE
}

function StaticParts({ parts, mats }: { parts: Partial<Record<PartKey, THREE.BufferGeometry>>; mats: FrigateMaterials }) {
  return (
    <>
      {(Object.keys(parts) as PartKey[]).map((key) => (
        <mesh key={key} geometry={parts[key]} material={mats[key]} castShadow={!NO_SHADOW.has(key)} receiveShadow={key !== 'glass' && key !== 'char'} />
      ))}
    </>
  )
}

/** Hinged gun-port lid: closed hangs over the port, open swings up and outboard. */
function PortLid({ x, side, open, mats }: { x: number; side: 1 | -1; open: boolean; mats: FrigateMaterials }) {
  const rail = railY(x)
  const hingeY = rail + PORT_LINTEL + 0.004
  const z = side * (bulwarkHalfWidth(x, hingeY) + 0.006)
  const h = PORT_LINTEL - PORT_SILL + 0.02
  return (
    <group position={[x, hingeY, z]} rotation-x={open ? -side * 1.95 : 0}>
      <mesh material={mats.paint} position={[0, -h / 2, side * 0.008]} castShadow>
        <boxGeometry args={[GUN_PORT_W + 0.016, h, 0.016]} />
      </mesh>
      <mesh material={mats.lidInside} position={[0, -h / 2, 0]}>
        <boxGeometry args={[GUN_PORT_W + 0.012, h - 0.004, 0.004]} />
      </mesh>
      <mesh material={mats.iron} position={[0, -0.004, side * 0.012]}>
        <boxGeometry args={[GUN_PORT_W - 0.03, 0.01, 0.012]} />
      </mesh>
    </group>
  )
}

/** Blackened splinters radiating from a hull breach. */
function splinterGeometry(seed: number, radius: number): THREE.BufferGeometry {
  const rnd = seededRandom(seed)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2
    const len = radius * (0.5 + rnd() * 0.9)
    const g = new THREE.BoxGeometry(0.012 + rnd() * 0.01, len, 0.006)
    g.translate(0, len / 2 + radius * 0.55, 0)
    g.rotateX((rnd() - 0.5) * 0.9)
    g.rotateZ(a)
    parts.push(g)
  }
  return mergeGeometries(parts)
}

function CellDamageFx({ cell, state, mats, lod }: { cell: number; state: CellDamage; mats: FrigateMaterials; lod: Lod }) {
  const x = cellCenterX(cell)
  const impact = FRIGATE_ANCHORS.impactPoints[cell]
  const splinters = useMemo(() => splinterGeometry(cell * 31 + 7, 0.11), [cell])
  const breach = useMemo(() => breachGeometry(0.1, 0.14, cell * 17 + 3), [cell])
  const deck = deckY(x)
  const burning = state === 'burning'
  const charSize = burning ? 0.78 : 0.6
  const stbdHw = sectionHalfWidth(x + 0.12, impact[1] + 0.03)
  // sit just outside the wales (which stand 0.012 proud of the planking) so the breach is never hidden
  const out = 0.018
  return (
    <group>
      <group position={[impact[0], impact[1], impact[2] - out]} rotation-y={Math.PI}>
        <HullHole position={[0, 0, 0.001]} radius={0.1} />
        <mesh geometry={breach} material={mats.splinter} />
        {lod < 2 && <mesh geometry={splinters} material={mats.splinter} />}
      </group>
      <group position={[x + 0.12, impact[1] + 0.03, stbdHw + out]}>
        <HullHole position={[0, 0, 0.001]} radius={0.085} />
        <mesh geometry={breach} material={mats.splinter} scale={0.85} />
        {lod < 2 && <mesh geometry={splinters} material={mats.splinter} scale={0.85} />}
      </group>
      <mesh material={mats.char} position={[x, deck + 0.004, 0]} rotation-x={-Math.PI / 2} renderOrder={2}>
        <planeGeometry args={[charSize, charSize * 0.8]} />
      </mesh>
      {burning && (
        <mesh material={mats.char} position={[x + 0.1, deck + 0.006, 0.08]} rotation-x={-Math.PI / 2} rotation-z={0.7} renderOrder={2}>
          <planeGeometry args={[0.5, 0.45]} />
        </mesh>
      )}
    </group>
  )
}

export function FrigateModel({ livery, damage, sinkProgress = 0, lod = 0, quality = 'high', sails = 1, phase = 0, firing = [] }: ShipModelProps) {
  const mats = frigateMaterials(livery, quality)
  const hull = buildHullParts(lod)
  const furniture = buildFurniture(lod)
  const [time] = useState(() => ({ value: 0 }))
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  useFrame(({ clock }) => tick(time, clock.getElapsedTime() * (reducedMotion ? 0.12 : 1) + phase))
  const sink = clamp01(sinkProgress)
  const isFiring = (c: CannonRef) => firing.some((f) => f.cell === c.cell && f.side === c.side)
  const snap = [clamp01((sink - 0.2) / 0.25), clamp01((sink - 0.4) / 0.25), clamp01((sink - 0.6) / 0.25)]
  const cellTorn = (cell: number) => (damage[cell] === 'burning' ? 0.45 : damage[cell] === 'hit' ? 0.18 : 0)
  const sinkTorn = clamp01((sink - 0.1) * 1.25)
  const flagSet = clamp01(1 - (sink - 0.35) / 0.15)
  const navy = livery === 'navy'
  const mainTruck: Vec3 = [0, 0.03, 0]
  const sternStaff: Vec3 = [F.xStern + 0.05, F.qdY, 0]

  return (
    <ClothTime.Provider value={time}>
      <group>
        <StaticParts parts={hull} mats={mats} />
        <StaticParts parts={furniture} mats={mats} />

        {lod < 2 &&
          GUN_X.map((gx) =>
            (['port', 'starboard'] as const).map((side) => {
              const x = gunX(gx, side)
              const ref = { cell: gunCell(gx), side }
              const fire = isFiring(ref)
              const sign = side === 'starboard' ? 1 : -1
              return (
                <group key={`${x}${side}`}>
                  <Cannon position={[x, deckY(x), sign * cannonZ(x, fire)]} rotationY={side === 'starboard' ? 0 : Math.PI} livery={livery} recoil={fire ? 1 : 0} scale={CANNON_SCALE} lod={lod} />
                  <PortLid x={x} side={sign} open={fire} mats={mats} />
                </group>
              )
            }),
          )}

        {MASTS.map((_, i) => (
          <FrigateMast
            key={i}
            index={i}
            mats={mats}
            livery={livery}
            sails={sails}
            snapped={snap[i]}
            torn={Math.max(cellTorn(i), sinkTorn)}
            phase={phase}
            lod={lod}
            fallSide={i === 1 ? 1 : -1}
            flag={
              i === 1 && lod < 2 ? (
                navy ? (
                  <FlagMesh at={mainTruck} width={0.42} height={0.05} livery={livery} set={flagSet} phase={phase + 1} seed={3} />
                ) : (
                  <FlagMesh at={mainTruck} width={0.46} height={0.24} livery={livery} set={flagSet} phase={phase + 1} />
                )
              ) : undefined
            }
          />
        ))}
        <Bowsprit mats={mats} livery={livery} sails={sails} torn={Math.max(cellTorn(0), sinkTorn)} phase={phase} lod={lod} snapped={snap[0]} />

        {navy && lod < 2 && (
          <group position={sternStaff} rotation-z={0.18}>
            <mesh material={mats.oak} position={[0, 0.3, 0]} castShadow>
              <cylinderGeometry args={[0.008, 0.012, 0.6, 6]} />
            </mesh>
            <FlagMesh at={[0, 0.58, 0]} width={0.4} height={0.2} livery={livery} set={flagSet} phase={phase + 2} />
          </group>
        )}

        {lod < 2 && (
          <>
            <Wheel position={[-1.2, F.qdY, 0]} livery={livery} radius={0.09} />
            {([1, -1] as const).map((side) => (
              <Anchor key={side} position={[1.2, F.fcY - 0.02, side * (bulwarkHalfWidth(1.2, F.fcY) + 0.12)]} livery={livery} scale={0.7} />
            ))}
            {lod === 0 &&
              PROP_SPOTS.map((p, i) =>
                p.kind === 'barrel' ? (
                  <Barrel key={i} position={p.at} livery={livery} scale={p.scale} />
                ) : p.kind === 'crate' ? (
                  <Crate key={i} position={p.at} livery={livery} size={0.16 * (p.scale ?? 1)} />
                ) : (
                  <RopeCoil key={i} position={p.at} livery={livery} radius={0.05} />
                ),
              )}
          </>
        )}

        {damage.map((d, i) => (d === 'intact' ? null : <CellDamageFx key={i} cell={i} state={d} mats={mats} lod={lod} />))}

        {sink > 0.55 && lod < 2 && (
          <mesh geometry={wreckDebris} material={mats.splinter} position={[0, capRailTop(0) - 0.05, 0]} />
        )}
      </group>
    </ClothTime.Provider>
  )
}
FrigateModel.displayName = 'Frigate'

/** Loose spars and planks scattered across the deck once the ship is going down. */
const wreckDebris = (() => {
  const rnd = seededRandom(1234)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 10; i++) {
    const x = -1.1 + rnd() * 2.1
    parts.push(box(0.25 + rnd() * 0.4, 0.02, 0.03, [x, (rnd() - 0.5) * 0.04, (rnd() - 0.5) * 0.6], rnd() * Math.PI))
  }
  return mergeGeometries(parts)
})()

