/**
 * Sloop (length 2): single-masted gaff cutter-rigged sloop. Bow = +x, centred, y = 0 waterline.
 *
 *   hull.ts      analytic hull (sections, sheer, keel, gun stations) — pure, unit-tested
 *   anchors.ts   SLOOP_ANCHORS derived from hull.ts (cannon muzzles, mast, impact points)
 *   geometry.ts  surface-following bands, deck cap, rudder, grating, cleats, blocks, splinters
 *   textures.ts  procedural canvas textures (planks + nails, anti-fouling, canvas, tatter mask, flags)
 *   materials.ts livery materials (kit iron/brass/rope/glass reused)
 *   parts.tsx    hull shell, bulwarks + gun-port lids, deck furniture, per-cell damage
 *   sails.tsx    fore-and-aft QuadSail + textured Ensign
 *   rigging.ts   merged rope geometry
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { Cannon } from '../kit'
import type { CannonRef, ShipDefinition, ShipModelProps } from '../types'
import { SLOOP_ANCHORS } from './anchors'
import { blockGeometry, mergeGeometries, placed } from './geometry'
import { BOW_CHASER, CANNON_SCALE, clamp01, deckY, gunStation, SLOOP_DIMS } from './hull'
import { sloopMaterials, type SloopMaterials } from './materials'
import { Bulwarks, CAP_RAIL_Y, CellDamageFx, CHAINPLATE_X, deadeyePos, Deck, HullShell } from './parts'
import { along, ratlineSegments, ropesGeometry, type RopeSeg } from './rigging'
import { Ensign, QuadSail } from './sails'

const MAST_BASE: Vec3 = [SLOOP_DIMS.mastX, deckY(SLOOP_DIMS.mastX), 0]
const MH = SLOOP_DIMS.mastHeight
/** Height above the deck at which the mast breaks when the ship goes down. */
const BREAK_Y = 0.28
const BOOM_Y = 0.42
const BOOM_LEN = 1.25
const BOOM_SWING = 0.105 // radians to starboard
const GAFF_LEN = 0.68
const GAFF_ANGLE = 0.42
const THROAT_Y = 1.28
const BOWSPRIT_ROOT: Vec3 = [0.9, 0.39, 0]
const BOWSPRIT_TIP: Vec3 = [SLOOP_DIMS.bowspritTip, 0.53, 0]
const STEMHEAD: Vec3 = [1.0, 0.44, 0]

const world = (local: Vec3): Vec3 => [local[0] + MAST_BASE[0], local[1] + MAST_BASE[1], local[2] + MAST_BASE[2]]

/** Spar end points (mast-local) for the current sail setting. */
function spars(set: number) {
  const throat: Vec3 = [0.02, 0.5 + (THROAT_Y - 0.5) * set, 0.004]
  const ang = GAFF_ANGLE * set - 0.03 * (1 - set)
  const peak: Vec3 = [throat[0] - Math.cos(ang) * GAFF_LEN, throat[1] + Math.sin(ang) * GAFF_LEN, 0.06]
  const boomEnd: Vec3 = [0.03 - Math.cos(BOOM_SWING) * BOOM_LEN, BOOM_Y, Math.sin(BOOM_SWING) * BOOM_LEN]
  return { throat, peak, ang, boomEnd }
}

function Model({ livery, damage, sinkProgress = 0, lod = 0, quality = 'high', sails = 1, phase = 0, firing = [] }: ShipModelProps) {
  const m = sloopMaterials(livery)
  const L = quality === 'low' ? Math.max(lod, 1) : lod
  const sink = clamp01(sinkProgress)
  const snapped = clamp01((sink - 0.25) / 0.45)
  const shred = clamp01((sink - 0.08) / 0.55)
  const flagDrop = clamp01((sink - 0.35) / 0.3)
  const burningMast = damage[0] === 'burning'
  const hitMast = damage[0] !== 'intact'
  const hitStern = damage[1] !== 'intact'
  const torn = Math.max(shred, burningMast ? 0.55 : hitMast ? 0.25 : 0)
  const scorch = burningMast ? 1 : hitMast ? 0.35 : sink > 0.5 ? 0.3 : 0
  const set = sails * (1 - 0.6 * shred)
  const isFiring = (c: CannonRef) => firing.some((f) => f.cell === c.cell && f.side === c.side)
  const lids = Array.from({ length: SLOOP_DIMS.length }, (_, cell) => [isFiring({ cell, side: 'port' }) ? 1 : 0, isFiring({ cell, side: 'starboard' }) ? 1 : 0] as [number, number])
  return (
    <group>
      <HullShell m={m} livery={livery} lod={L} />
      <Bulwarks m={m} lod={L} lids={lids} />
      <Deck m={m} livery={livery} lod={L} />
      <Bowsprit m={m} lod={L} sink={sink} />
      {L < 2 &&
        SLOOP_ANCHORS.cannons.map((c) => (
          <Cannon
            key={`${c.cell}-${c.side}`}
            position={gunStation(c.cell, c.side)}
            rotationY={c.side === 'starboard' ? 0 : Math.PI}
            livery={livery}
            recoil={isFiring(c) ? 1 : 0}
            scale={CANNON_SCALE}
          />
        ))}
      {L < 2 && <Cannon position={BOW_CHASER} rotationY={Math.PI / 2} livery={livery} scale={0.4} />}
      <Rig m={m} lod={L} set={set} torn={Math.max(torn, hitStern ? 0.2 : 0)} scorch={scorch} snapped={snapped} flagDrop={flagDrop} phase={phase} />
      <CellDamageFx damage={damage} m={m} lod={L} />
    </group>
  )
}
Model.displayName = 'Sloop'

/* ------------------------------------------------------------------ rig */

interface RigProps {
  m: SloopMaterials
  lod: number
  set: number
  torn: number
  scorch: number
  snapped: number
  flagDrop: number
  phase: number
}

function Rig({ m, lod, set, torn, scorch, snapped, flagDrop, phase }: RigProps) {
  const { throat, peak, ang, boomEnd } = spars(set)
  const standing = snapped < 0.12
  // mast pivots at the break point so the stump stays on deck when it goes
  const fall = snapped
  const mastGeom = useMemo(() => {
    const lower = new THREE.CylinderGeometry(0.027, 0.036, 1.32, lod >= 2 ? 7 : 12)
    lower.translate(0, 0.66, 0)
    const top = new THREE.CylinderGeometry(0.012, 0.02, MH - 1.1, lod >= 2 ? 6 : 10)
    top.translate(0.035, 1.1 + (MH - 1.1) / 2, 0)
    const parts: THREE.BufferGeometry[] = [lower, top]
    parts.push(placed(new THREE.CylinderGeometry(0.004, 0.004, 0.32, 5), [0.035, MH + 0.16, 0]))
    if (lod < 2) {
      parts.push(placed(new THREE.BoxGeometry(0.11, 0.035, 0.07), [0.015, 1.3, 0]))
      parts.push(placed(new THREE.BoxGeometry(0.03, 0.09, 0.09), [-0.03, 1.21, 0]))
      parts.push(placed(new THREE.BoxGeometry(0.1, 0.012, 0.11), [0.0, 1.235, 0]))
      parts.push(placed(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 10), [0.035, MH + 0.006, 0]))
      // boom & gaff jaws
      parts.push(placed(new THREE.BoxGeometry(0.1, 0.03, 0.03), [-0.02, BOOM_Y, 0.03]))
      parts.push(placed(new THREE.BoxGeometry(0.1, 0.03, 0.03), [-0.02, BOOM_Y, -0.03]))
    }
    return mergeGeometries(parts)
  }, [lod])
  const boomGeom = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.014, 0.022, BOOM_LEN, lod >= 2 ? 6 : 9)
    g.rotateZ(Math.PI / 2)
    g.translate(-BOOM_LEN / 2 + 0.03, 0, 0)
    return g
  }, [lod])
  const gaffGeom = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.01, 0.018, GAFF_LEN, lod >= 2 ? 6 : 8)
    g.rotateZ(Math.PI / 2)
    g.translate(-GAFF_LEN / 2, 0, 0)
    const jaws = [placed(new THREE.BoxGeometry(0.08, 0.025, 0.025), [0.02, 0, 0.03]), placed(new THREE.BoxGeometry(0.08, 0.025, 0.025), [0.02, 0, -0.03])]
    return mergeGeometries([g, ...jaws])
  }, [lod])

  // running rigging that follows the sails (mast-local)
  const running = useMemo(() => {
    if (lod >= 2) return null
    const hounds: Vec3 = [0.0, 1.22, 0]
    const segs: RopeSeg[] = [
      [[0.03, 1.5, 0.01], [boomEnd[0] + 0.03, boomEnd[1] + 0.012, boomEnd[2] - 0.004], 0.007], // topping lift
      [[0.0, 1.56, -0.012], along(throat, peak, 0.55), 0.007], // peak halyard
      [[-0.01, 1.42, 0.012], [throat[0], throat[1] + 0.02, throat[2]], 0.007], // throat halyard
      [[0.03, MH - 0.02, -0.025], [0.1 - 0.15, 0.1, -0.24], 0.006], // jib halyard down to the pin rail
      [[0.03, 1.5, 0.02], [0.1 - 0.15, 0.1, 0.24], 0.006], // topping lift fall to the pin rail
      [hounds, [0.0, 0.12, 0.0], 0.006], // main halyard fall along the mast
    ]
    return ropesGeometry(segs)
  }, [lod, boomEnd, throat, peak])

  const blocks = useMemo(() => {
    if (lod >= 1) return null
    const b = blockGeometry(0.045)
    const list: Vec3[] = [
      [boomEnd[0] + 0.03, boomEnd[1] + 0.03, boomEnd[2]],
      along(throat, peak, 0.55),
      [throat[0] - 0.01, throat[1] + 0.04, throat[2]],
      [0.03, 1.47, 0.01],
      [0.0, 1.54, -0.012],
      [0.035, MH - 0.05, -0.02],
    ]
    return mergeGeometries(list.map((p) => placed(b.clone(), p)))
  }, [lod, boomEnd, throat, peak])

  // standing rigging in ship frame: stays, shrouds, ratlines, backstays, sheets
  const standingGeom = useMemo(() => {
    const houndsW = world([0.0, 1.22, 0])
    const segs: RopeSeg[] = [
      [world([0.0, 1.25, 0]), STEMHEAD, 0.011], // forestay
      [world([0.035, MH - 0.08, 0]), [BOWSPRIT_TIP[0] - 0.03, BOWSPRIT_TIP[1] + 0.01, 0], 0.01], // jibstay
      [world([0.0, 1.6, 0.015]), [-0.9, CAP_RAIL_Y(-0.9) + 0.03, 0.185], 0.009], // backstays
      [world([0.0, 1.6, -0.015]), [-0.9, CAP_RAIL_Y(-0.9) + 0.03, -0.185], 0.009],
      [[-1.1, BOOM_Y + MAST_BASE[1] - 0.01, 0.125], [-0.975, 0.49, 0.0], 0.008], // main sheet to the horse
    ]
    for (const s of [1, -1] as const) {
      const shrouds: [Vec3, Vec3][] = CHAINPLATE_X.map((x) => {
        const d = deadeyePos(x, s)
        return [[d[0], d[1] + 0.03, d[2]], [houndsW[0], houndsW[1], s * 0.03]] as [Vec3, Vec3]
      })
      for (const [a, b] of shrouds) segs.push([a, b, 0.011])
      // lanyards between deadeye and chainplate
      for (const x of CHAINPLATE_X) {
        const d = deadeyePos(x, s)
        segs.push([[d[0], d[1] - 0.03, d[2]], [d[0], d[1] + 0.03, d[2]], 0.006])
      }
      if (lod < 2) segs.push(...ratlineSegments(shrouds, 0.62, lod === 0 ? 1.36 : 1.0, lod === 0 ? 0.065 : 0.13))
    }
    return ropesGeometry(segs)
  }, [lod])

  // sheets for the headsails (ship frame, hidden with the mast)
  const jibClew: Vec3 = [0.32, 0.36, 0.1]
  const stayClew: Vec3 = [0.42, 0.27, 0.1]
  const jibTack: Vec3 = [BOWSPRIT_TIP[0] - 0.03, BOWSPRIT_TIP[1] + 0.02, 0]
  const jibHead = world([0.04, MH - 0.1, 0])
  const stayTack: Vec3 = [STEMHEAD[0] - 0.01, STEMHEAD[1] + 0.01, 0]
  const stayHead = world([0.02, 1.2, 0])
  const sheets = useMemo(() => {
    if (lod >= 2) return null
    return ropesGeometry([
      [world(jibClew), [0.45, 0.33, 0.215], 0.006],
      [world(stayClew), [0.45, 0.33, 0.2], 0.006],
      [[-1.07, 0.75, 0.125], [-1.07, 0.49, 0.0], 0.007],
    ])
  }, [lod])

  const topSet = clamp01((set - 0.45) / 0.55)
  return (
    <group>
      {/* stump below the break */}
      <mesh material={m.spar} position={[MAST_BASE[0], MAST_BASE[1] + BREAK_Y / 2, 0]} castShadow>
        <cylinderGeometry args={[0.034, 0.036, BREAK_Y, lod >= 2 ? 7 : 12]} />
      </mesh>
      <group position={[MAST_BASE[0], MAST_BASE[1] + BREAK_Y, 0]} rotation-z={fall * 1.25} rotation-x={fall * 0.55} rotation-y={fall * 0.3}>
        <group position={[0, -BREAK_Y, 0]}>
          <mesh geometry={mastGeom} material={m.spar} castShadow />
          <group position={[0.03, BOOM_Y, 0]} rotation-y={-BOOM_SWING} rotation-z={-fall * 0.5}>
            <mesh geometry={boomGeom} material={m.spar} position={[-0.03, 0, 0]} castShadow />
          </group>
          <group position={throat} rotation-z={ang} rotation-y={-0.06}>
            <mesh geometry={gaffGeom} material={m.spar} castShadow />
          </group>
          {running && <mesh geometry={running} material={m.kit.rope} />}
          {blocks && <mesh geometry={blocks} material={m.cabin} />}
          {/* mainsail */}
          <QuadSail
            m={m}
            corners={[[0.03, BOOM_Y + 0.02, 0.004], [boomEnd[0] + 0.05, boomEnd[1] + 0.02, boomEnd[2] - 0.006], [peak[0] + 0.015, peak[1] - 0.012, peak[2]], [throat[0] + 0.01, throat[1] - 0.012, throat[2]]]}
            set={set}
            torn={torn}
            scorch={scorch}
            phase={phase}
            belly={0.13}
            segments={lod >= 2 ? [6, 5] : [12, 9]}
          />
          {/* gaff topsail */}
          {lod < 2 && (
            <QuadSail
              m={m}
              corners={[[0.035, 1.34, 0.0], [peak[0] + 0.02, peak[1] + 0.02, peak[2] + 0.01], [0.04, MH - 0.03, 0.0], [0.04, MH - 0.03, 0.0]]}
              set={topSet}
              torn={torn}
              scorch={scorch}
              phase={phase + 1.3}
              belly={0.08}
              segments={[7, 6]}
              castShadow={false}
            />
          )}
          <Ensign position={[0.035, MH + 0.31, 0]} m={m} width={0.4} height={0.22} phase={phase} drop={flagDrop} />
        </group>
      </group>
      {/* headsails hang on their stays in the ship frame: when the mast goes the stays part and they slide down onto the bowsprit */}
      {snapped < 0.85 && (
        <QuadSail
          m={m}
          corners={[jibTack, world(jibClew), along(jibHead, jibTack, snapped), along(jibHead, jibTack, snapped)]}
          set={set * (1 - snapped * 0.5)}
          torn={Math.max(torn, snapped)}
          scorch={scorch}
          phase={phase + 2.1}
          belly={0.12}
          segments={lod >= 2 ? [6, 5] : [9, 8]}
        />
      )}
      {lod < 2 && snapped < 0.85 && (
        <QuadSail
          m={m}
          corners={[stayTack, world(stayClew), along(stayHead, stayTack, snapped), along(stayHead, stayTack, snapped)]}
          set={set * (1 - snapped * 0.5)}
          torn={Math.max(torn, snapped)}
          scorch={scorch}
          phase={phase + 0.7}
          belly={0.1}
          segments={[8, 7]}
        />
      )}
      {standing && <mesh geometry={standingGeom} material={m.kit.rope} />}
      {standing && sheets && <mesh geometry={sheets} material={m.kit.rope} />}
    </group>
  )
}

/* ------------------------------------------------------------------ bowsprit */

function Bowsprit({ m, lod, sink }: { m: SloopMaterials; lod: number; sink: number }) {
  const geom = useMemo(() => {
    const dir = new THREE.Vector3(...BOWSPRIT_TIP).sub(new THREE.Vector3(...BOWSPRIT_ROOT))
    const len = dir.length()
    const g = new THREE.CylinderGeometry(0.016, 0.03, len, lod >= 2 ? 6 : 10)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()))
    g.translate(len / 2 * dir.x / len, len / 2 * dir.y / len, 0)
    const parts: THREE.BufferGeometry[] = [g]
    if (lod < 2) {
      // gammon iron at the stemhead, cap at the tip
      const ring = new THREE.TorusGeometry(0.034, 0.006, 6, 12)
      ring.rotateY(Math.PI / 2)
      parts.push(placed(ring, [STEMHEAD[0] - BOWSPRIT_ROOT[0], STEMHEAD[1] - BOWSPRIT_ROOT[1] - 0.01, 0]))
      parts.push(placed(new THREE.CylinderGeometry(0.02, 0.02, 0.025, 8), [dir.x - 0.02, dir.y, 0], [0, 0, Math.PI / 2]))
    }
    return mergeGeometries(parts)
  }, [lod])
  const ropes = useMemo(
    () =>
      ropesGeometry([
        [[BOWSPRIT_TIP[0] - 0.08, BOWSPRIT_TIP[1] - 0.02, 0], [1.0, 0.04, 0], 0.01], // bobstay
        [[BOWSPRIT_TIP[0] - 0.08, BOWSPRIT_TIP[1] - 0.01, 0.0], [0.86, 0.33, 0.14], 0.007], // bowsprit shrouds
        [[BOWSPRIT_TIP[0] - 0.08, BOWSPRIT_TIP[1] - 0.01, 0.0], [0.86, 0.33, -0.14], 0.007],
        [[0.84, 0.36, -0.2], [0.655, 0.45, -0.07], 0.008], // anchor cable to the bitts
      ]),
    [],
  )
  const droop = clamp01((sink - 0.7) / 0.3)
  return (
    <group position={BOWSPRIT_ROOT} rotation-z={-droop * 0.9}>
      <mesh geometry={geom} material={m.spar} castShadow />
      {lod < 2 && droop < 0.2 && <mesh geometry={ropes} material={m.kit.rope} position={[-BOWSPRIT_ROOT[0], -BOWSPRIT_ROOT[1], 0]} />}
    </group>
  )
}

export const SLOOP: ShipDefinition = {
  id: 'sloop',
  name: 'Sloop',
  length: SLOOP_DIMS.length,
  Model,
  anchors: SLOOP_ANCHORS,
}
