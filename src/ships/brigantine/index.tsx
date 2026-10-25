/**
 * Brigantine (length 3): raider's two-master. Square-rigged foremast, gaff-rigged mainmast with a big
 * fore-and-aft mainsail and gaff topsail, bowsprit with two jibs, low sleek hull with real gun ports and
 * 6 carriage guns a side, swivel guns, aft cabin with skylight, tiller, boat on chocks, windlass, hatches.
 *
 * Frame: bow = +x, stern = −x, y = 0 waterline, one unit per cell. The root never moves itself.
 * Geometry is shared across instances (module cache); materials are cached per livery.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { useGameStore } from '../../store/gameStore'
import { Anchor, Barrel, Cannon, Crate, RopeCoil } from '../kit'
import type { CannonRef, Lod, ShipDefinition, ShipModelProps, Side } from '../types'
import { BRIGANTINE_ANCHORS, CANNON_SCALE, cannonPosition, cellCenterX, cellOfX } from './anchors'
import {
  BULWARK_THICKNESS,
  CABIN_FRONT_X,
  CABIN_TOP_Y,
  CANNON_X,
  DECK_Y,
  FOREMAST_HEIGHT,
  FOREMAST_X,
  MAINMAST_HEIGHT,
  MAINMAST_X,
  STEM_X,
  TRANSOM_X,
  buildDeckGeometry,
  buildHullGeometry,
  buildKeelGeometry,
  buildWaleGeometry,
  hullHalfWidth,
  railPath,
  sheerY,
} from './hull'
import { brigMaterials } from './materials'
import {
  Bitts,
  Breach,
  BrigLantern,
  Channel,
  Cleats,
  Companionway,
  Figurehead,
  GunPortLid,
  Hatch,
  HeadRails,
  Netting,
  PinRail,
  RudderAndTiller,
  ScorchDecal,
  ShipBoat,
  Skylight,
  SternWindows,
  SwivelGun,
  Windlass,
} from './parts'
import { Cloth, Ensign, ForeMast, MAIN_BOOM_LENGTH, MAIN_BOOM_Y, MainMast, Pennant, RopeSet, type RopeLine, gaffPose, shroudLines } from './rig'

export { BRIGANTINE_ANCHORS } from './anchors'

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const ramp = (v: number, from: number, to: number) => clamp01((v - from) / (to - from))

interface SharedGeometry {
  hull: THREE.BufferGeometry
  /** No port openings: used at lod 2 where there are no cannons behind them. */
  hullSolid: THREE.BufferGeometry
  hullTriangles: number
  deck: THREE.BufferGeometry
  cabinTop: THREE.BufferGeometry
  keel: THREE.BufferGeometry
  wales: THREE.BufferGeometry[]
  lowerWales: THREE.BufferGeometry[]
  moulding: THREE.BufferGeometry[]
}

let SHARED: SharedGeometry | null = null

function sharedGeometry(): SharedGeometry {
  if (SHARED) return SHARED
  const hull = buildHullGeometry()
  const moulding = ([1, -1] as const).map((s) => {
    const pts = railPath(s).map((p) => new THREE.Vector3(p.x, p.y - 0.035, p.z + s * (BULWARK_THICKNESS / 2 + 0.008)))
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.006, 5, false)
  })
  SHARED = {
    hull: hull.geometry,
    hullSolid: buildHullGeometry({ ports: false }).geometry,
    hullTriangles: hull.triangles,
    deck: buildDeckGeometry(CABIN_FRONT_X - 0.02, STEM_X - 0.1),
    cabinTop: buildDeckGeometry(TRANSOM_X + 0.01, CABIN_FRONT_X, CABIN_TOP_Y, 0.008, 10),
    keel: buildKeelGeometry(),
    wales: ([1, -1] as const).map((s) => buildWaleGeometry(0.295, s, 0.04, 0.012)),
    lowerWales: ([1, -1] as const).map((s) => buildWaleGeometry(0.13, s, 0.024, 0.008)),
    moulding,
  }
  return SHARED
}

/** Bowsprit geometry constants (ship frame). */
const BOWSPRIT_BASE: Vec3 = [1.38, 0.6, 0]
const BOWSPRIT_ANGLE = 0.38
const BOWSPRIT_LEN = 0.62
const JIBBOOM_EXTRA = 0.16
const bowspritPoint = (t: number): Vec3 => [BOWSPRIT_BASE[0] + Math.cos(BOWSPRIT_ANGLE) * BOWSPRIT_LEN * t, BOWSPRIT_BASE[1] + Math.sin(BOWSPRIT_ANGLE) * BOWSPRIT_LEN * t, 0]
const BOWSPRIT_TIP = bowspritPoint(1)
const JIBBOOM_TIP = bowspritPoint(1 + JIBBOOM_EXTRA / BOWSPRIT_LEN)

const FORE_LOWER_HEAD: Vec3 = [FOREMAST_X, DECK_Y + FOREMAST_HEIGHT * 0.6, 0]
const FORE_HEAD: Vec3 = [FOREMAST_X + 0.035, DECK_Y + FOREMAST_HEIGHT, 0]
const MAIN_LOWER_HEAD: Vec3 = [MAINMAST_X, DECK_Y + MAINMAST_HEIGHT * 0.64, 0]
const MAIN_HEAD: Vec3 = [MAINMAST_X + 0.035, DECK_Y + MAINMAST_HEIGHT, 0]

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

function railPoint(x: number, side: 1 | -1, inset = BULWARK_THICKNESS / 2): Vec3 {
  const y = sheerY(x)
  return [x, y + 0.01, side * (hullHalfWidth(x, y) - inset)]
}

function channelPoint(x: number, side: 1 | -1): Vec3 {
  const y = sheerY(x) - 0.04
  return [x, y, side * (hullHalfWidth(x, y) + 0.055)]
}

/** Standing rigging that stays with the hull (bowsprit gear, lifelines), independent of mast state. */
function hullRopes(lod: Lod): RopeLine[] {
  const lines: RopeLine[] = [
    [BOWSPRIT_TIP, [STEM_X - 0.02, 0.05, 0], 0.011], // bobstay
    [BOWSPRIT_TIP, [1.3, 0.47, 0.3], 0.008],
    [BOWSPRIT_TIP, [1.3, 0.47, -0.3], 0.008],
  ]
  if (lod === 0) {
    // gammoning turns round the bowsprit heel
    for (let i = 0; i < 4; i++) {
      const t = 0.05 + i * 0.035
      const p = bowspritPoint(t)
      lines.push([[p[0], p[1] + 0.03, 0.03], [p[0] - 0.02, p[1] - 0.06, -0.03], 0.006])
      lines.push([[p[0], p[1] + 0.03, -0.03], [p[0] - 0.02, p[1] - 0.06, 0.03], 0.006])
    }
  }
  return lines
}

function foreRopes(lod: Lod): RopeLine[] {
  const lines: RopeLine[] = []
  for (const s of [1, -1] as const) {
    const bases = [0.63, 0.75, 0.87].map((x) => channelPoint(x, s))
    lines.push(...shroudLines(bases, FORE_LOWER_HEAD, lod === 0 ? 11 : 0))
    // topmast shrouds from the top rim
    lines.push([[FOREMAST_X, FORE_LOWER_HEAD[1], s * 0.09], [FORE_HEAD[0], FORE_HEAD[1] - 0.03, s * 0.015], 0.007])
    // backstay
    lines.push([[FORE_HEAD[0], FORE_HEAD[1] - 0.05, 0], railPoint(0.15, s), 0.008])
  }
  lines.push([FORE_LOWER_HEAD, bowspritPoint(0.42), 0.012]) // fore stay
  lines.push([[FORE_HEAD[0], FORE_HEAD[1] - 0.02, 0], BOWSPRIT_TIP, 0.009]) // fore topmast stay
  lines.push([[FORE_HEAD[0], FORE_HEAD[1], 0], JIBBOOM_TIP, 0.006]) // jib stay
  return lines
}

function mainRopes(lod: Lod, sails: number): RopeLine[] {
  const lines: RopeLine[] = []
  const { peak } = gaffPose(MAINMAST_HEIGHT, sails)
  const peakW: Vec3 = [MAINMAST_X + peak[0], DECK_Y + peak[1], 0]
  for (const s of [1, -1] as const) {
    const bases = [-0.54, -0.4, -0.26].map((x) => channelPoint(x, s))
    lines.push(...shroudLines(bases, MAIN_LOWER_HEAD, lod === 0 ? 12 : 0))
    lines.push([[MAINMAST_X, MAIN_LOWER_HEAD[1], s * 0.12], [MAIN_HEAD[0], MAIN_HEAD[1] - 0.03, s * 0.015], 0.007])
    lines.push([[MAIN_HEAD[0], MAIN_HEAD[1] - 0.05, 0], railPoint(-1.05, s), 0.008]) // backstays
    // boom topping lift to the masthead
    lines.push([[MAINMAST_X - MAIN_BOOM_LENGTH + 0.03, DECK_Y + MAIN_BOOM_Y + 0.01, s * 0.02], [MAINMAST_X, MAIN_LOWER_HEAD[1] - 0.02, s * 0.02], 0.006])
  }
  lines.push([MAIN_LOWER_HEAD, [FOREMAST_X + 0.05, DECK_Y + 0.2, 0], 0.012]) // main stay to the fore bitts
  lines.push([[MAIN_HEAD[0], MAIN_HEAD[1] - 0.02, 0], [FOREMAST_X, FORE_LOWER_HEAD[1] + 0.02, 0], 0.008]) // main topmast stay
  lines.push([peakW, [MAIN_HEAD[0], MAIN_HEAD[1] - 0.06, 0], 0.007]) // peak halyard
  // main sheet from the boom end down to the quarterdeck
  lines.push([[MAINMAST_X - MAIN_BOOM_LENGTH + 0.05, DECK_Y + MAIN_BOOM_Y - 0.02, 0], [TRANSOM_X + 0.12, CABIN_TOP_Y + 0.02, 0], 0.007])
  return lines
}

function BrigantineModel({ livery, damage, sinkProgress = 0, lod = 0, quality = 'high', sails = 1, phase = 0, firing = [] }: ShipModelProps) {
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const motion = reducedMotion ? 0 : 1
  const mats = useMemo(() => brigMaterials(livery), [livery])
  const geo = useMemo(sharedGeometry, [])
  const shadows = quality === 'high'
  const sink = clamp01(sinkProgress)

  const foreSnap = ramp(sink, 0.12, 0.42)
  const mainSnap = ramp(sink, 0.4, 0.72)
  const bowspritSnap = ramp(sink, 0.6, 0.85)
  const flagDrop = ramp(sink, 0.28, 0.5)
  const sailsSet = sails * (1 - sink * 0.25)
  const jibTorn = ramp(sink, 0.1, 0.6)

  const cellBurning = (cell: number) => damage[cell] === 'burning'
  const isFiring = (x: number, side: Side) => firing.some((f: CannonRef) => f.cell === cellOfX(x) && f.side === side)

  const hullMaterials = useMemo(() => [mats.hull, mats.bulwarkInner, mats.trim], [mats])
  const waleMat = livery === 'pirate' ? mats.trim : mats.timber
  const { peak } = gaffPose(MAINMAST_HEIGHT, sailsSet)
  const peakW: Vec3 = [MAINMAST_X + peak[0] - 0.02, DECK_Y + peak[1] - 0.02, 0]
  const boomEnd: Vec3 = [MAINMAST_X - MAIN_BOOM_LENGTH + 0.1, DECK_Y + MAIN_BOOM_Y - 0.05, 0.05]

  const hullLines = useMemo(() => hullRopes(lod), [lod])
  const foreLines = useMemo(() => foreRopes(lod), [lod])
  const mainLines = useMemo(() => mainRopes(lod, Math.round(sailsSet * 20) / 20), [lod, sailsSet])

  return (
    <group>
      {/* ---------- hull ---------- */}
      <mesh geometry={lod === 2 ? geo.hullSolid : geo.hull} material={hullMaterials} castShadow receiveShadow />
      <mesh geometry={geo.deck} material={mats.deck} receiveShadow />
      <mesh geometry={geo.keel} material={mats.timber} castShadow />
      {geo.wales.map((g, i) => (
        <mesh key={`w${i}`} geometry={g} material={waleMat} castShadow={shadows} />
      ))}
      {lod < 2 && geo.lowerWales.map((g, i) => <mesh key={`lw${i}`} geometry={g} material={mats.timber} />)}
      {lod === 0 && geo.moulding.map((g, i) => <mesh key={`m${i}`} geometry={g} material={mats.accent} />)}
      <RudderAndTiller mats={mats} tillerY={CABIN_TOP_Y} lod={lod} />
      {lod < 2 && <SternWindows mats={mats} />}
      <Figurehead mats={mats} x={STEM_X - 0.02} y={0.46} livery={livery} />
      {lod < 2 && <HeadRails mats={mats} from={[1.2, 0.53, hullHalfWidth(1.2, 0.53) + 0.02]} to={[STEM_X + 0.03, 0.52, 0.03]} />}

      {/* ---------- aft cabin / quarterdeck ---------- */}
      <mesh geometry={geo.cabinTop} material={mats.deck} receiveShadow castShadow />
      <mesh material={mats.bulwarkInner} position={[CABIN_FRONT_X + 0.005, (DECK_Y + CABIN_TOP_Y) / 2, 0]} castShadow>
        <boxGeometry args={[0.03, CABIN_TOP_Y - DECK_Y, 2 * (hullHalfWidth(CABIN_FRONT_X, DECK_Y) - BULWARK_THICKNESS)]} />
      </mesh>
      {/* cabin door + two small lights in the forward bulkhead */}
      <mesh material={mats.splinter} position={[CABIN_FRONT_X + 0.022, DECK_Y + 0.065, 0.12]}>
        <boxGeometry args={[0.006, 0.12, 0.08]} />
      </mesh>
      {lod < 2 &&
        [-0.1, -0.24].map((z) => (
          <mesh key={z} material={mats.window} position={[CABIN_FRONT_X + 0.022, DECK_Y + 0.09, z]} rotation-y={Math.PI / 2}>
            <planeGeometry args={[0.06, 0.045]} />
          </mesh>
        ))}
      {/* steps up to the quarterdeck */}
      {lod < 2 &&
        [0, 1, 2].map((i) => (
          <mesh key={i} material={mats.timber} position={[CABIN_FRONT_X + 0.1 - i * 0.045, DECK_Y + 0.025 + i * 0.05, -0.02]} castShadow={shadows}>
            <boxGeometry args={[0.05, 0.05, 0.16]} />
          </mesh>
        ))}
      {/* quarterdeck rail across the break */}
      <mesh material={mats.trim} position={[CABIN_FRONT_X - 0.03, CABIN_TOP_Y + 0.08, 0.2]}>
        <boxGeometry args={[0.02, 0.02, 0.3]} />
      </mesh>
      {lod < 2 &&
        [0.08, 0.2, 0.32].map((z) => (
          <mesh key={z} material={mats.timber} position={[CABIN_FRONT_X - 0.03, CABIN_TOP_Y + 0.04, z]}>
            <boxGeometry args={[0.016, 0.08, 0.016]} />
          </mesh>
        ))}
      {lod < 2 && <Skylight position={[-1.3, CABIN_TOP_Y, 0.0]} mats={mats} lod={lod} />}
      {lod < 2 && <Companionway position={[-1.17, CABIN_TOP_Y, -0.14]} mats={mats} />}
      {lod < 2 && <BrigLantern position={[TRANSOM_X + 0.02, sheerY(TRANSOM_X) + 0.03, 0.27]} mats={mats} scale={0.9} />}
      {lod < 2 && <BrigLantern position={[TRANSOM_X + 0.02, sheerY(TRANSOM_X) + 0.03, -0.27]} mats={mats} scale={0.9} />}

      {/* ---------- guns ---------- */}
      {lod < 2 &&
        CANNON_X.map((x) =>
          (['port', 'starboard'] as const).map((side) => {
            const fire = isFiring(x, side)
            return (
              <group key={`${x}${side}`}>
                <Cannon position={cannonPosition(x, side)} rotationY={side === 'starboard' ? 0 : Math.PI} livery={livery} recoil={fire ? 1 : 0} scale={CANNON_SCALE} />
                <GunPortLid x={x} side={side} open={fire ? 1 : 0.55} mats={mats} />
                {lod === 0 && <RopeCoil position={[x + 0.07, DECK_Y, side === 'starboard' ? 0.1 : -0.1]} livery={livery} />}
              </group>
            )
          }),
        )}
      {lod < 2 &&
        [1.18, -1.2].map((x) =>
          (['port', 'starboard'] as const).map((side) => <SwivelGun key={`${x}${side}`} x={x} side={side} mats={mats} />),
        )}

      {/* ---------- deck furniture ---------- */}
      {lod < 2 && (
        <>
          <Hatch position={[0.45, DECK_Y, 0]} size={[0.2, 0.24]} mats={mats} lod={lod} />
          <Hatch position={[-0.76, DECK_Y, 0]} size={[0.16, 0.18]} mats={mats} lod={lod} />
          <ShipBoat position={[0.05, DECK_Y, 0]} mats={mats} lod={lod} />
          <Windlass position={[1.12, DECK_Y, 0]} mats={mats} lod={lod} />
          <Bitts position={[FOREMAST_X + 0.1, DECK_Y, 0]} mats={mats} />
          <Bitts position={[MAINMAST_X + 0.1, DECK_Y, 0]} mats={mats} />
        </>
      )}
      {lod < 2 && (
        <>
          <PinRail x0={0.55} x1={0.95} side="port" mats={mats} />
          <PinRail x0={0.55} x1={0.95} side="starboard" mats={mats} />
          <PinRail x0={-0.6} x1={-0.2} side="port" mats={mats} />
          <PinRail x0={-0.6} x1={-0.2} side="starboard" mats={mats} />
          <Barrel position={[-0.9, DECK_Y, 0.2]} livery={livery} scale={0.75} />
          <Barrel position={[-0.9, DECK_Y, -0.2]} livery={livery} scale={0.75} />
          <Barrel position={[-1.0, DECK_Y, 0.05]} livery={livery} scale={0.6} />
          <Crate position={[0.42, DECK_Y, -0.3]} livery={livery} size={0.13} />
          <Crate position={[0.42, DECK_Y, 0.28]} livery={livery} size={0.1} />
          <Channel x={0.75} width={0.34} side="port" mats={mats} deadeyes={3} lod={lod} />
          <Channel x={0.75} width={0.34} side="starboard" mats={mats} deadeyes={3} lod={lod} />
          <Channel x={-0.4} width={0.38} side="port" mats={mats} deadeyes={3} lod={lod} />
          <Channel x={-0.4} width={0.38} side="starboard" mats={mats} deadeyes={3} lod={lod} />
          {/* catheads + anchors */}
          {([1, -1] as const).map((s) => (
            <group key={s}>
              <mesh material={mats.timber} position={[1.24, sheerY(1.24) + 0.01, s * (hullHalfWidth(1.24, sheerY(1.24)) + 0.02)]} rotation-y={s * 0.3}>
                <boxGeometry args={[0.05, 0.04, 0.16]} />
              </mesh>
              <Anchor position={[1.26, 0.38, s * (hullHalfWidth(1.26, 0.4) + 0.07)]} livery={livery} scale={0.55} />
            </group>
          ))}
        </>
      )}
      {lod === 0 && (
        <>
          <RopeCoil position={[FOREMAST_X - 0.12, DECK_Y, 0.08]} livery={livery} />
          <RopeCoil position={[MAINMAST_X - 0.14, DECK_Y, -0.1]} livery={livery} />
          <RopeCoil position={[1.0, DECK_Y, 0]} livery={livery} />
          <Cleats xs={[1.05, 0.45, -0.05, -0.75, -1.3]} mats={mats} />
          <Netting x0={-1.0} x1={-0.65} side="port" height={0.07} mats={mats} />
          <Netting x0={-1.0} x1={-0.65} side="starboard" height={0.07} mats={mats} />
          <Netting x0={0.0} x1={0.5} side="port" height={0.07} mats={mats} />
          <Netting x0={0.0} x1={0.5} side="starboard" height={0.07} mats={mats} />
          <BrigLantern position={[MAINMAST_X + 0.12, DECK_Y + 0.22, 0.02]} mats={mats} scale={0.7} />
        </>
      )}

      {/* ---------- masts & sails ---------- */}
      <ForeMast base={[FOREMAST_X, DECK_Y, 0]} height={FOREMAST_HEIGHT} sails={sailsSet} snapped={foreSnap} damaged={cellBurning(0)} phase={phase} lod={lod} mats={mats} motion={motion} shadows={shadows} />
      <MainMast base={[MAINMAST_X, DECK_Y, 0]} height={MAINMAST_HEIGHT} sails={sailsSet} snapped={mainSnap} damaged={cellBurning(1)} phase={phase + 1.1} lod={lod} mats={mats} motion={motion} shadows={shadows} />
      {foreSnap < 0.5 && <Pennant position={[FORE_HEAD[0], FORE_HEAD[1] + 0.01, 0]} mats={mats} motion={motion} phase={phase} />}
      <Ensign position={peakW} drop={Math.max(flagDrop, mainSnap)} dropTo={boomEnd} phase={phase} mats={mats} motion={motion} />

      {/* ---------- bowsprit & jibs ---------- */}
      <group position={BOWSPRIT_BASE} rotation-z={-bowspritSnap * 0.8}>
        <group rotation-z={-(Math.PI / 2 - BOWSPRIT_ANGLE)}>
          <mesh material={mats.timber} position={[0, BOWSPRIT_LEN / 2 - 0.05, 0]} castShadow>
            <cylinderGeometry args={[0.022, 0.034, BOWSPRIT_LEN + 0.1, 10]} />
          </mesh>
          <mesh material={mats.spar} position={[0.0, BOWSPRIT_LEN * 0.55 + (BOWSPRIT_LEN * 0.45 + JIBBOOM_EXTRA) / 2, 0.028]} castShadow={shadows}>
            <cylinderGeometry args={[0.009, 0.015, BOWSPRIT_LEN * 0.45 + JIBBOOM_EXTRA, 8]} />
          </mesh>
          <mesh material={mats.iron} position={[0, BOWSPRIT_LEN - 0.01, 0.012]}>
            <boxGeometry args={[0.05, 0.03, 0.08]} />
          </mesh>
          {lod < 2 && (
            <mesh material={mats.iron} position={[0, BOWSPRIT_LEN * 0.6, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 0.02, 10]} />
            </mesh>
          )}
          {/* dolphin striker */}
          {lod < 2 && (
            <mesh material={mats.spar} position={[-0.08, BOWSPRIT_LEN * 0.95, 0]} rotation-z={Math.PI / 2}>
              <cylinderGeometry args={[0.007, 0.01, 0.16, 6]} />
            </mesh>
          )}
        </group>
      </group>
      {bowspritSnap < 0.3 && (
        <>
          <Cloth
            corners={[
              [JIBBOOM_TIP[0] - 0.05, JIBBOOM_TIP[1] - 0.01, 0],
              [1.08, DECK_Y + 0.42, 0],
              lerp3(FORE_HEAD, JIBBOOM_TIP, 0.14),
              lerp3(FORE_HEAD, JIBBOOM_TIP, 0.14),
            ]}
            billow={[0, 0, 1]}
            set={sailsSet}
            torn={Math.max(jibTorn, cellBurning(0) ? 0.5 : 0)}
            scorched={cellBurning(0)}
            phase={phase + 3}
            mats={mats}
            segments={lod === 0 ? 8 : 5}
            motion={motion}
            amp={0.08}
            shadows={shadows}
          />
          <Cloth
            corners={[bowspritPoint(0.4), [0.98, DECK_Y + 0.3, 0], lerp3(FORE_LOWER_HEAD, bowspritPoint(0.42), 0.14), lerp3(FORE_LOWER_HEAD, bowspritPoint(0.42), 0.14)]}
            billow={[0, 0, 1]}
            set={sailsSet}
            torn={Math.max(jibTorn, cellBurning(0) ? 0.5 : 0)}
            scorched={cellBurning(0)}
            phase={phase + 4.2}
            mats={mats}
            segments={lod === 0 ? 8 : 5}
            motion={motion}
            amp={0.07}
            shadows={shadows}
          />
        </>
      )}

      {/* ---------- rigging ---------- */}
      {lod < 2 && (
        <>
          <RopeSet lines={hullLines} mats={mats} visible={bowspritSnap < 0.3} />
          <RopeSet lines={foreLines} mats={mats} visible={foreSnap < 0.15} />
          <RopeSet lines={mainLines} mats={mats} visible={mainSnap < 0.15} />
        </>
      )}

      {/* ---------- damage ---------- */}
      {damage.map((d, cell) => {
        if (d === 'intact') return null
        const cx = cellCenterX(cell)
        const burning = d === 'burning'
        return (
          <group key={cell}>
            <Breach x={cx - 0.08} side="port" mats={mats} burning={burning} seed={cell * 11 + 1} lod={lod} />
            <Breach x={cx + 0.11} side="starboard" mats={mats} burning={burning} seed={cell * 11 + 2} lod={lod} />
            {burning && <ScorchDecal position={[cx, cell === 2 && cx < CABIN_FRONT_X ? CABIN_TOP_Y : DECK_Y, 0]} radius={0.34} mats={mats} seed={cell + 3} />}
            {burning && lod < 2 && <ScorchDecal position={[cx + 0.2, DECK_Y, 0.18]} radius={0.16} mats={mats} seed={cell + 7} />}
          </group>
        )
      })}
      {sink > 0.5 && (
        <>
          <Breach x={-0.45} side="port" mats={mats} burning={false} seed={91} lod={lod} />
          <Breach x={0.95} side="starboard" mats={mats} burning={false} seed={92} lod={lod} />
          <ScorchDecal position={[0.5, DECK_Y, -0.1]} radius={0.3} mats={mats} seed={93} />
        </>
      )}
    </group>
  )
}
BrigantineModel.displayName = 'Brigantine'

export const BRIGANTINE: ShipDefinition = {
  id: 'brigantine',
  name: 'Brigantine',
  length: 3,
  Model: BrigantineModel,
  anchors: BRIGANTINE_ANCHORS,
}
