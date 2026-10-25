/**
 * Galleon (length 4): Spanish-style treasure galleon with a two-level sterncastle, raised forecastle,
 * beakhead and bowsprit with spritsail, square-rigged fore and main, lateen mizzen, 16 guns behind lidded ports.
 *
 * Frame: bow = +x, stern = −x, y = 0 waterline, one unit per cell (see ARCHITECTURE.md). The root never moves;
 * `damage`, `sinkProgress`, `sails`, `firing`, `lod`, `quality`, `phase` and `livery` only change the shape.
 * Hull maths + anchors live in `hull.ts` / `anchors.ts` (pure, unit-tested); textures in `textures.ts`.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { useGameStore } from '../../store/gameStore'
import { Anchor, Barrel, Cannon, Crate, Flag, HullHole, Lantern, Railing, Ratlines, Rope, RopeCoil, SternLantern, Wheel } from '../kit'
import type { CannonRef, CellDamage, Livery, Lod, ShipDefinition, ShipModelProps } from '../types'
import { CANNON_SCALE, GALLEON_ANCHORS, GUN_PORT_SIZE, GUN_PORT_Y, IMPACT_Y, MASTS, cannonPlacements, cellCenterX, cellOfX, mastBase, sideSign, type CannonPlacement, type MastSpec } from './anchors'
import { GALLEON as G, crossPlane, deckStrip, deckY, halfWidth, keelLine, loftProfile, railY, stations, stemCurve, triangleCount, wale } from './hull'
import { galleonMaterials, type GalleonMaterials } from './materials'
import { Beam, ClothSail, Door, Ensign, FurledBundle, Grating, Instanced, Splinters, Stairs, Window } from './parts'

export { GALLEON_ANCHORS } from './anchors'

/* ------------------------------------------------------------------------------------------------ hull geometry */

interface HullGeoms {
  below: THREE.BufferGeometry
  planks: THREE.BufferGeometry
  inner?: THREE.BufferGeometry
  railCap?: THREE.BufferGeometry
  wales: THREE.BufferGeometry[]
  panels?: THREE.BufferGeometry
  transomLow: THREE.BufferGeometry
  transomHigh: THREE.BufferGeometry
  decks: THREE.BufferGeometry[]
  bulkheads: THREE.BufferGeometry[]
  keel: THREE.BufferGeometry
  stem: THREE.BufferGeometry
  triangles: number
}

const HULL_CACHE = new Map<Lod, HullGeoms>()

/** Geometry is independent of livery/state, so one set per LOD is shared by every galleon on the water. */
export function hullGeometries(lod: Lod): HullGeoms {
  const hit = HULL_CACHE.get(lod)
  if (hit) return hit
  const xs = stations(lod === 2 ? 0.14 : lod === 1 ? 0.09 : 0.06)
  const girth = lod === 2 ? 4 : lod === 1 ? 6 : 8
  const below = loftProfile((x) => {
    const lo = keelLine(x)
    return Array.from({ length: girth }, (_, i) => ({ y: lo + ((0.03 - lo) * i) / (girth - 1), v: i / (girth - 1) }))
  }, { xs, uv: [1, 1] })
  const planks = loftProfile((x) => {
    const hi = railY(x)
    const n = girth + 2
    return Array.from({ length: n }, (_, i) => {
      const y = 0.03 + ((hi - 0.03) * i) / (n - 1)
      return { y, v: y }
    })
  }, { xs, uv: [0.8, 1.5] })
  const transomLow = crossPlane(G.xStern, keelLine(G.xStern), 0.55, -1, 0, 6)
  const transomHigh = crossPlane(G.xStern, 0.55, railY(G.xStern), -1, 0, 6)
  const decks = [
    deckStrip(G.xStern + 0.01, G.xBow - 0.02, G.mainDeckY, G.plank, [1, 1]),
    deckStrip(G.forecastleX - 0.01, G.xBow - 0.06, G.forecastleDeckY, G.plank, [1, 1]),
    deckStrip(G.xStern + 0.01, G.quarterX + 0.01, G.quarterDeckY, G.plank, [1, 1]),
    deckStrip(G.xStern + 0.01, G.poopX + 0.01, G.poopDeckY, G.plank, [1, 1]),
  ]
  const keel = loftProfile(
    (x) => {
      const k = keelLine(x)
      return [
        { y: k - 0.045, z: 0, v: 0 },
        { y: k - 0.045, z: 0.03, v: 0.3 },
        { y: k + 0.04, z: 0.03, v: 1 },
      ]
    },
    { xs, flat: true },
  )
  const stem = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(stemCurve()), lod === 2 ? 8 : 20, 0.042, lod === 2 ? 5 : 7, false)
  const out: HullGeoms = { below, planks, transomLow, transomHigh, decks, bulkheads: [], wales: [], keel, stem, triangles: 0 }
  if (lod < 2) {
    out.inner = loftProfile(
      (x) => {
        const lo = deckY(x) - 0.02
        const hi = railY(x)
        return [
          { y: lo, off: -G.plank, v: lo * 3 },
          { y: hi, off: -G.plank, v: hi * 3 },
        ]
      },
      { xs, inward: true, uv: [1, 1] },
    )
    out.railCap = loftProfile(
      (x) => {
        const r = railY(x)
        return [
          { y: r - 0.002, off: 0.012, v: 0 },
          { y: r + 0.03, off: 0.012, v: 0.3 },
          { y: r + 0.03, off: -G.plank - 0.012, v: 0.7 },
          { y: r - 0.002, off: -G.plank - 0.012, v: 1 },
        ]
      },
      { xs, flat: true },
    )
    const aftXs = xs.filter((x) => x <= G.quarterX)
    const poopXs = xs.filter((x) => x <= G.poopX)
    const foreXs = xs.filter((x) => x >= G.forecastleX)
    out.wales = [
      wale(0.07, 0.125, 0.026, { xs }),
      wale(0.4, 0.46, 0.028, { xs }),
      wale(0.88, 0.925, 0.022, { xs: aftXs }),
      wale(0.88, 0.925, 0.022, { xs: foreXs }),
      wale(1.3, 1.34, 0.02, { xs: poopXs }),
    ]
    out.panels = loftProfile(() => [{ y: 0.5, off: 0.007, v: 0 }, { y: 0.8, off: 0.007, v: 1 }], { xs, uv: [1, 1] })
    out.bulkheads = [
      crossPlane(G.forecastleX, G.mainDeckY - 0.01, G.forecastleDeckY, -1, G.plank, 4),
      crossPlane(G.quarterX, G.mainDeckY - 0.01, G.quarterDeckY, 1, G.plank, 4),
      crossPlane(G.poopX, G.quarterDeckY - 0.01, G.poopDeckY, 1, G.plank, 4),
    ]
  }
  const all = [out.below, out.planks, out.inner, out.railCap, out.panels, out.transomLow, out.transomHigh, out.keel, out.stem, ...out.decks, ...out.bulkheads, ...out.wales]
  out.triangles = all.reduce((n, g) => n + (g ? triangleCount(g) : 0), 0)
  HULL_CACHE.set(lod, out)
  return out
}

function HullShell({ lod, m }: { lod: Lod; m: GalleonMaterials }) {
  const g = useMemo(() => hullGeometries(lod), [lod])
  return (
    <group>
      <mesh geometry={g.below} material={m.below} castShadow receiveShadow />
      <mesh geometry={g.planks} material={m.planks} castShadow receiveShadow />
      {g.inner && <mesh geometry={g.inner} material={m.deckInner} receiveShadow />}
      {g.railCap && <mesh geometry={g.railCap} material={m.wale} castShadow />}
      {g.wales.map((w, i) => (
        <mesh key={i} geometry={w} material={m.wale} castShadow />
      ))}
      {g.panels && <mesh geometry={g.panels} material={m.panels} />}
      <mesh geometry={g.transomLow} material={m.planks} castShadow receiveShadow />
      <mesh geometry={g.transomHigh} material={m.carved} castShadow receiveShadow />
      {g.decks.map((d, i) => (
        <mesh key={i} geometry={d} material={m.deck} receiveShadow />
      ))}
      {g.bulkheads.map((b, i) => (
        <mesh key={i} geometry={b} material={m.deckInner} castShadow receiveShadow />
      ))}
      <mesh geometry={g.keel} material={m.wale} />
      <mesh geometry={g.stem} material={m.wale} castShadow />
      {/* sternpost and rudder */}
      <mesh material={m.wale} position={[G.xStern - 0.02, (keelLine(G.xStern) + 0.5) / 2, 0]} castShadow>
        <boxGeometry args={[0.05, 0.5 - keelLine(G.xStern), 0.05]} />
      </mesh>
      <mesh material={m.planks} position={[G.xStern - 0.085, (keelLine(G.xStern) + 0.42) / 2 + 0.02, 0]} castShadow>
        <boxGeometry args={[0.08, 0.42 - keelLine(G.xStern), 0.03]} />
      </mesh>
      {lod < 2 &&
        [0.3, 0.0, -0.25].map((y) => (
          <mesh key={y} material={m.iron} position={[G.xStern - 0.045, y, 0]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.014, 0.014, 0.09, 6]} />
          </mesh>
        ))}
    </group>
  )
}

/* -------------------------------------------------------------------------------------------- castles & decks */

function Castles({ lod, m, livery }: { lod: Lod; m: GalleonMaterials; livery: Livery }) {
  // kit `Railing`: `position` is the start of the rail, which runs along local +x after `rotationY`
  const railSeg = (x0: number, x1: number, y: number, side: 1 | -1) => {
    const z0 = side * (halfWidth(x0, y) - G.plank - 0.03)
    const z1 = side * (halfWidth(x1, y) - G.plank - 0.03)
    const len = Math.hypot(x1 - x0, z1 - z0)
    return { position: [x0, y, z0] as Vec3, length: len, rotationY: -Math.atan2(z1 - z0, x1 - x0), height: 0.2, lod }
  }
  /** Rail across the ship at `x` from `zA` to `zB` (runs toward −z from the +z end). */
  const railAcross = (x: number, y: number, zA: number, zB: number) => ({ position: [x, y, Math.max(zA, zB)] as Vec3, length: Math.abs(zA - zB), rotationY: Math.PI / 2, height: 0.2, lod })
  const sides: (1 | -1)[] = [1, -1]
  const fcY = G.forecastleDeckY + G.toeRail + 0.03
  const qdY = G.quarterDeckY + G.toeRail + 0.03
  const ppY = G.poopDeckY + G.toeRail + 0.03
  return (
    <group>
      {/* bulkhead doors and stairs */}
      {[-0.26, 0.26].map((z) => (
        <Door key={`fd${z}`} position={[G.forecastleX - G.plank, G.mainDeckY, z]} facing={-1} m={m} />
      ))}
      <Stairs x={G.forecastleX - 0.285} z={0} y0={G.mainDeckY} y1={G.forecastleDeckY} dir={1} width={0.26} m={m} />
      {[-0.27, 0.27].map((z) => (
        <Door key={`qd${z}`} position={[G.quarterX + G.plank, G.mainDeckY, z]} facing={1} m={m} />
      ))}
      <Stairs x={G.quarterX + 0.315} z={0} y0={G.mainDeckY} y1={G.quarterDeckY} dir={-1} width={0.26} m={m} />
      <Door position={[G.poopX + G.plank, G.quarterDeckY, 0]} facing={1} m={m} width={0.14} height={0.28} />
      {[-0.22, 0.22].map((z) => (
        <Stairs key={`ps${z}`} x={G.poopX + 0.3} z={z} y0={G.quarterDeckY} y1={G.poopDeckY} dir={-1} width={0.16} m={m} />
      ))}
      {/* cabin windows in the quarterdeck bulkhead */}
      {lod < 1 && [-0.42, 0.42].map((z) => <Window key={`qw${z}`} position={[G.quarterX + G.plank + 0.004, G.mainDeckY + 0.24, z]} facing={1} m={m} width={0.09} height={0.1} />)}
      {/* castle railings on top of the toe rail */}
      {sides.map((s) => (
        <group key={`r${s}`}>
          <Railing {...railSeg(G.forecastleX + 0.02, 1.33, fcY, s)} livery={livery} />
          <Railing {...railSeg(1.33, 1.64, fcY, s)} livery={livery} />
          <Railing {...railSeg(G.quarterX - 0.02, G.poopX, qdY, s)} livery={livery} />
          <Railing {...railSeg(G.poopX - 0.02, G.xStern + 0.03, ppY, s)} livery={livery} />
        </group>
      ))}
      {/* breast rails across the castle breaks (either side of the central stairs) */}
      {sides.map((s) => {
        const fw = halfWidth(G.forecastleX, G.forecastleDeckY) - G.plank - 0.03
        const qw = halfWidth(G.quarterX, G.quarterDeckY) - G.plank - 0.03
        const pw = halfWidth(G.poopX, G.poopDeckY) - G.plank - 0.03
        return (
          <group key={`b${s}`}>
            <Railing {...railAcross(G.forecastleX + 0.02, fcY, s * 0.15, s * fw)} livery={livery} />
            <Railing {...railAcross(G.quarterX - 0.02, qdY, s * 0.15, s * qw)} livery={livery} />
            <Railing {...railAcross(G.poopX - 0.02, ppY, s * (pw - 0.16), s * pw)} livery={livery} />
          </group>
        )
      })}
      <Railing {...railAcross(G.poopX - 0.02, ppY, -0.13, 0.13)} livery={livery} />
    </group>
  )
}

/* ------------------------------------------------------------------------------------------------- stern works */

function SternWorks({ lod, m, livery, sink }: { lod: Lod; m: GalleonMaterials; livery: Livery; sink: number }) {
  const x = G.xStern
  const balusterGeom = useMemo(() => new THREE.CylinderGeometry(0.009, 0.012, 0.13, 5), [])
  const balusters = useMemo(() => Array.from({ length: 9 }, (_, i): { position: Vec3 } => ({ position: [x - 0.13, G.quarterDeckY + 0.085, -0.26 + (0.52 * i) / 8] })), [x])
  const galleryW = 2 * halfWidth(x, G.quarterDeckY) - 0.04
  return (
    <group>
      {/* great-cabin windows (quarterdeck level) and poop cabin windows */}
      {[-0.21, -0.07, 0.07, 0.21].map((z) => (
        <Window key={`gw${z}`} position={[x - 0.004, 0.82, z]} facing={-1} m={m} mullions={lod < 1} />
      ))}
      {[-0.16, 0, 0.16].map((z) => (
        <Window key={`pw${z}`} position={[x - 0.004, 1.23, z]} facing={-1} m={m} width={0.1} height={0.12} mullions={lod < 1} />
      ))}
      {/* stern gallery: balcony floor, balusters, hand rail, brackets */}
      <mesh material={m.deckInner} position={[x - 0.07, G.quarterDeckY + 0.005, 0]} castShadow>
        <boxGeometry args={[0.15, 0.03, galleryW]} />
      </mesh>
      <mesh material={m.gilt} position={[x - 0.145, G.quarterDeckY - 0.005, 0]}>
        <boxGeometry args={[0.012, 0.05, galleryW + 0.02]} />
      </mesh>
      {lod < 2 && <Instanced geometry={balusterGeom} material={m.gilt} transforms={balusters} />}
      <Beam from={[x - 0.13, G.quarterDeckY + 0.165, -galleryW / 2]} to={[x - 0.13, G.quarterDeckY + 0.165, galleryW / 2]} radius={0.014} material={m.wale} />
      {[-1, 1].map((s) => (
        <mesh key={s} material={m.gilt} position={[x - 0.075, G.quarterDeckY - 0.06, (s * galleryW) / 2]} rotation-z={0.6}>
          <boxGeometry args={[0.03, 0.14, 0.03]} />
        </mesh>
      ))}
      {/* carved frieze boards and the name board */}
      <mesh material={m.gilt} position={[x - 0.008, 0.56, 0]}>
        <boxGeometry args={[0.016, 0.03, 2 * halfWidth(x, 0.56) + 0.01]} />
      </mesh>
      <mesh material={m.gilt} position={[x - 0.008, 1.02 + 0.2, 0]}>
        <boxGeometry args={[0.016, 0.03, 2 * halfWidth(x, 1.22) + 0.01]} />
      </mesh>
      <mesh material={m.trim} position={[x - 0.012, 1.4, 0]}>
        <boxGeometry args={[0.02, 0.06, 0.34]} />
      </mesh>
      {/* taffrail across the top of the transom, with the three stern lanterns */}
      <Railing position={[x + 0.02, G.poopDeckY + G.toeRail + 0.03, halfWidth(x, G.poopDeckY) - 0.05]} length={2 * halfWidth(x, G.poopDeckY) - 0.1} livery={livery} rotationY={Math.PI / 2} height={0.2} lod={lod} />
      {([
        [x + 0.02, G.poopDeckY + 0.42, 0],
        [x + 0.04, G.poopDeckY + 0.3, 0.23],
        [x + 0.04, G.poopDeckY + 0.3, -0.23],
      ] as Vec3[]).map((p, i) => (
        <group key={i}>
          <Beam from={[p[0], G.poopDeckY + 0.05, p[2]]} to={[p[0], p[1] - 0.06, p[2]]} radius={0.012} material={m.wale} />
          {i === 0 ? <SternLantern position={p} livery={livery} lit={sink < 0.6} scale={0.45} lod={lod} /> : <Lantern position={p} livery={livery} lit={sink < 0.6} scale={0.5} lod={lod} />}
        </group>
      ))}
      {/* quarter galleries (small windowed turrets on each quarter) */}
      {lod < 2 &&
        [1, -1].map((s) => {
          const qx = x + 0.3
          const qz = s * (halfWidth(qx, 0.86) + 0.03)
          return (
            <group key={`q${s}`} position={[qx, 0.86, qz]}>
              <mesh material={m.carved} castShadow>
                <boxGeometry args={[0.24, 0.36, 0.07]} />
              </mesh>
              <mesh material={m.gilt} position={[0, 0.2, 0]}>
                <boxGeometry args={[0.26, 0.03, 0.09]} />
              </mesh>
              <mesh material={m.gilt} position={[0, -0.2, 0]}>
                <boxGeometry args={[0.26, 0.03, 0.09]} />
              </mesh>
              <group rotation-y={(s * Math.PI) / 2}>
                <Window position={[0.03, 0.02, 0]} facing={1} m={m} width={0.08} height={0.1} mullions={lod < 1} />
              </group>
            </group>
          )
        })}
    </group>
  )
}

/* --------------------------------------------------------------------------------------------------- bow works */

function Figurehead({ m }: { m: GalleonMaterials }) {
  return (
    <group position={[G.xBow + 0.4, 0.8, 0]} rotation-z={-0.9}>
      {/* torso and haunches */}
      <mesh material={m.gilt} castShadow>
        <capsuleGeometry args={[0.042, 0.13, 4, 8]} />
      </mesh>
      <mesh material={m.gilt} position={[-0.01, -0.09, 0]}>
        <sphereGeometry args={[0.05, 8, 6]} />
      </mesh>
      {/* head with mane, ears, muzzle and crown */}
      <mesh material={m.gilt} position={[0.02, 0.13, 0]}>
        <sphereGeometry args={[0.05, 10, 8]} />
      </mesh>
      <mesh material={m.gilt} position={[-0.02, 0.12, 0]} rotation-y={Math.PI / 2}>
        <torusGeometry args={[0.055, 0.03, 7, 12]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`ear${s}`} material={m.gilt} position={[0.01, 0.18, s * 0.035]} rotation-x={s * 0.4}>
          <coneGeometry args={[0.014, 0.03, 5]} />
        </mesh>
      ))}
      <mesh material={m.gilt} position={[0.065, 0.11, 0]}>
        <boxGeometry args={[0.045, 0.035, 0.04]} />
      </mesh>
      <mesh material={m.trim} position={[0.085, 0.1, 0]}>
        <boxGeometry args={[0.012, 0.012, 0.03]} />
      </mesh>
      <mesh material={m.trim} position={[0.0, 0.19, 0]}>
        <cylinderGeometry args={[0.03, 0.026, 0.025, 8]} />
      </mesh>
      {/* forelegs reaching forward, tail curling back */}
      {[-1, 1].map((s) => (
        <mesh key={`leg${s}`} material={m.gilt} position={[0.055, 0.0, s * 0.032]} rotation-z={-0.65}>
          <cylinderGeometry args={[0.011, 0.016, 0.14, 6]} />
        </mesh>
      ))}
      <mesh material={m.gilt} position={[-0.04, -0.15, 0]} rotation-z={0.7}>
        <cylinderGeometry args={[0.007, 0.018, 0.14, 6]} />
      </mesh>
    </group>
  )
}

function BowWorks({ lod, m, livery, sails, sink, torn, phase, reducedMotion }: { lod: Lod; m: GalleonMaterials; livery: Livery; sails: number; sink: number; torn: number; phase: number; reducedMotion: boolean }) {
  const snap = Math.max(0, Math.min(1, (sink - 0.7) / 0.25))
  const root: Vec3 = [G.xBow - 0.3, G.forecastleDeckY + 0.06, 0]
  const tip: Vec3 = [G.xBow + 1.05, 1.52, 0]
  const yardAt: Vec3 = [root[0] + (tip[0] - root[0]) * 0.56, root[1] + (tip[1] - root[1]) * 0.56, 0]
  return (
    <group>
      {/* beakhead platform and head rails */}
      <Grating position={[G.xBow + 0.16, 0.7, 0]} width={0.34} depth={0.22} m={m} bars={5} frame={0.035} height={0.045} lod={lod} />
      <mesh material={m.wale} position={[G.xBow + 0.05, 0.55, 0]} rotation-z={0.5} castShadow>
        <boxGeometry args={[0.06, 0.34, 0.06]} />
      </mesh>
      {lod < 2 &&
        [1, -1].map((s) => (
          <group key={s}>
            <Beam from={[G.xBow - 0.02, G.forecastleDeckY + 0.03, s * (halfWidth(G.xBow - 0.02, 0.98) + 0.01)]} to={[G.xBow + 0.22, 0.88, s * 0.14]} radius={0.016} material={m.gilt} />
            <Beam from={[G.xBow + 0.22, 0.88, s * 0.14]} to={[G.xBow + 0.4, 0.84, s * 0.03]} radius={0.016} material={m.gilt} />
            <Beam from={[G.xBow - 0.02, 0.86, s * (halfWidth(G.xBow - 0.02, 0.86) + 0.01)]} to={[G.xBow + 0.3, 0.76, s * 0.1]} radius={0.014} material={m.trim} />
          </group>
        ))}
      {lod < 1 && <Figurehead m={m} />}
      {lod >= 1 && (
        <mesh material={m.gilt} position={[G.xBow + 0.42, 0.86, 0]}>
          <sphereGeometry args={[0.07, 8, 6]} />
        </mesh>
      )}
      {/* bowsprit (snaps late in the sinking) with spritsail and gammoning */}
      <group position={root} rotation-z={-snap * 0.9} rotation-y={snap * 0.3}>
        <Beam from={[0, 0, 0]} to={[tip[0] - root[0], tip[1] - root[1], 0]} radius={0.036} radiusTo={0.02} material={m.deckInner} castShadow />
        {lod < 2 && (
          <mesh material={m.rope} position={[0.33, 0.14, 0]} rotation-z={0.37}>
            <torusGeometry args={[0.05, 0.016, 6, 12]} />
          </mesh>
        )}
        <group position={[yardAt[0] - root[0], yardAt[1] - root[1], 0]}>
          <Beam from={[0, -0.05, -0.34]} to={[0, -0.05, 0.34]} radius={0.016} material={m.deckInner} />
          <group position={[0.02, -0.07, 0]}>
            <ClothSail m={m} set={sails} torn={torn} phase={phase + 2} reducedMotion={reducedMotion} square={{ width: 0.62, height: 0.34 }} segments={[8, 6]} />
            <FurledBundle length={0.62} set={sails} material={m.sail} />
          </group>
        </group>
        <Flag position={[tip[0] - root[0], tip[1] - root[1] + 0.1, 0]} livery={livery} width={0.3} height={0.07} phase={phase + 1} kind="pennant" lod={lod} />
      </group>
      {/* catheads with the anchors */}
      {lod < 2 &&
        [1, -1].map((s) => (
          <group key={`c${s}`}>
            <Beam from={[1.42, G.forecastleDeckY + 0.08, s * 0.1]} to={[1.42, G.forecastleDeckY + 0.12, s * (halfWidth(1.42, 1.0) + 0.09)]} radius={0.022} material={m.wale} />
            <Anchor position={[1.42, G.forecastleDeckY + 0.06, s * (halfWidth(1.42, 0.86) + 0.1)]} livery={livery} scale={0.32} rotationY={Math.PI / 2} />
          </group>
        ))}
    </group>
  )
}

/* ------------------------------------------------------------------------------------------------------- guns */

function Guns({ lod, m, livery, firing, damage }: { lod: Lod; m: GalleonMaterials; livery: Livery; firing: readonly CannonRef[]; damage: readonly CellDamage[] }) {
  const guns = useMemo(() => cannonPlacements(), [])
  const frameGeom = useMemo(() => new THREE.BoxGeometry(GUN_PORT_SIZE[0] + 0.05, GUN_PORT_SIZE[1] + 0.05, 0.016), [])
  const openingGeom = useMemo(() => new THREE.BoxGeometry(GUN_PORT_SIZE[0], GUN_PORT_SIZE[1], 0.03), [])
  const frames = useMemo(() => guns.map((g): { position: Vec3; rotation: Vec3 } => ({ position: [g.x, GUN_PORT_Y, sideSign(g.side) * (g.hw + 0.004)], rotation: [0, g.side === 'port' ? Math.PI : 0, 0] })), [guns])
  const openings = useMemo(() => guns.map((g): { position: Vec3; rotation: Vec3 } => ({ position: [g.x, GUN_PORT_Y, sideSign(g.side) * (g.hw + 0.012)], rotation: [0, g.side === 'port' ? Math.PI : 0, 0] })), [guns])
  const isFiring = (g: CannonPlacement) => firing.some((f) => f.cell === g.cell && f.side === g.side)
  return (
    <group>
      <Instanced geometry={frameGeom} material={m.trim} transforms={frames} />
      <Instanced geometry={openingGeom} material={m.charred} transforms={openings} />
      {guns.map((g) => {
        const s = sideSign(g.side)
        const fire = isFiring(g)
        const hit = damage[g.cell] !== 'intact'
        const open = fire ? 1 : hit ? 0.8 : 0
        // guns under the castles are only visible through an open port, so they are mounted only while it is open
        const enclosed = g.x <= G.quarterX || g.x >= G.forecastleX
        return (
          <group key={`${g.cell}-${g.side}-${g.x}`}>
            {(!enclosed || open > 0) && (
              <Cannon position={[g.x, G.mainDeckY, s * (g.hw - 0.012 - 0.45 * CANNON_SCALE)]} rotationY={s > 0 ? 0 : Math.PI} livery={livery} recoil={fire ? 1 : 0} scale={CANNON_SCALE} lod={enclosed ? (Math.max(1, lod) as Lod) : lod} />
            )}
            <group position={[g.x, GUN_PORT_Y + GUN_PORT_SIZE[1] / 2 + 0.01, s * (g.hw + 0.03)]} rotation-x={-s * open * 1.95}>
              <mesh material={m.portLid} position={[0, -GUN_PORT_SIZE[1] / 2 - 0.005, 0]} castShadow>
                <boxGeometry args={[GUN_PORT_SIZE[0] + 0.02, GUN_PORT_SIZE[1] + 0.02, 0.014]} />
              </mesh>
              {lod < 1 && (
                <mesh material={m.iron} position={[0, 0, 0]} rotation-z={Math.PI / 2}>
                  <cylinderGeometry args={[0.008, 0.008, GUN_PORT_SIZE[0] + 0.03, 5]} />
                </mesh>
              )}
            </group>
          </group>
        )
      })}
    </group>
  )
}

/* -------------------------------------------------------------------------------------------------------- rig */

interface YardSpec {
  width: number
  /** Height above the mast base. */
  y: number
  sailHeight: number
}

const YARDS: Record<MastSpec['name'], YardSpec[]> = {
  fore: [
    { width: 1.25, y: 0.95, sailHeight: 0.5 },
    { width: 0.95, y: 1.55, sailHeight: 0.42 },
  ],
  main: [
    { width: 1.6, y: 1.1, sailHeight: 0.56 },
    { width: 1.25, y: 1.75, sailHeight: 0.46 },
    { width: 0.85, y: 2.2, sailHeight: 0.3 },
  ],
  mizzen: [],
}

function GalleonMast({ spec, lod, m, livery, sails, torn, scorched, snapped, phase, reducedMotion, flag }: { spec: MastSpec; lod: Lod; m: GalleonMaterials; livery: Livery; sails: number; torn: number; scorched: boolean; snapped: number; phase: number; reducedMotion: boolean; flag?: boolean }) {
  const base = mastBase(spec)
  const h = spec.height
  const breakY = h * 0.42
  const yards = YARDS[spec.name]
  const nestY = spec.name === 'mizzen' ? h * 0.72 : h * 0.66
  const fall: Vec3 = spec.name === 'fore' ? [0.25, 0, -1.35] : spec.name === 'main' ? [-1.25, 0, -0.35] : [0.3, 0, 1.3]
  const sailMat = scorched ? m.sailScorched : m.sail
  return (
    <group position={base}>
      {/* lower mast (stays standing) with iron bands and a fife rail */}
      <mesh material={m.deckInner} position={[0, breakY / 2 - 0.02, 0]} castShadow>
        <cylinderGeometry args={[0.038, 0.05, breakY + 0.04, lod === 2 ? 6 : 10]} />
      </mesh>
      {lod < 2 &&
        [0.12, breakY * 0.5].map((y) => (
          <mesh key={y} material={m.iron} position={[0, y, 0]}>
            <cylinderGeometry args={[0.052, 0.052, 0.025, 10]} />
          </mesh>
        ))}
      {/* upper mast pivots at the break point as the ship sinks */}
      <group position={[0, breakY, 0]} rotation-x={fall[0] * snapped} rotation-z={fall[2] * snapped}>
        <mesh material={m.deckInner} position={[0, (h - breakY) / 2, 0]} castShadow>
          <cylinderGeometry args={[0.018, 0.038, h - breakY, lod === 2 ? 6 : 10]} />
        </mesh>
        <mesh material={m.gilt} position={[0, h - breakY + 0.03, 0]}>
          <sphereGeometry args={[0.03, 8, 6]} />
        </mesh>
        {lod < 2 && (
          <mesh material={m.iron} position={[0, 0.03, 0]}>
            <cylinderGeometry args={[0.045, 0.045, 0.06, 10]} />
          </mesh>
        )}
        {/* crow's nest: floor, rim and railing */}
        <group position={[0, nestY - breakY, 0]}>
          <mesh material={m.deckInner} castShadow>
            <cylinderGeometry args={[0.13, 0.09, 0.05, 12]} />
          </mesh>
          <mesh material={m.deckInner} position={[0, 0.09, 0]}>
            <cylinderGeometry args={[0.135, 0.13, 0.14, 12, 1, true]} />
          </mesh>
          <mesh material={m.wale} position={[0, 0.165, 0]}>
            <torusGeometry args={[0.135, 0.012, 5, 14]} />
          </mesh>
        </group>
        {yards.map((yd, i) => (
          <group key={i} position={[0, yd.y - breakY, 0]}>
            <Beam from={[0, 0, -yd.width / 2]} to={[0, 0, yd.width / 2]} radius={0.02} radiusTo={0.02} material={m.deckInner} castShadow />
            {lod < 2 && (
              <mesh material={m.rope} rotation-x={Math.PI / 2}>
                <torusGeometry args={[0.045, 0.01, 5, 10]} />
              </mesh>
            )}
            <group position={[0.04, -0.03, 0]}>
              <ClothSail m={m} set={sails} torn={torn} scorched={scorched} phase={phase + i * 1.3} reducedMotion={reducedMotion} square={{ width: yd.width * 0.94, height: yd.sailHeight }} segments={lod === 2 ? [6, 4] : [10, 8]} />
              <FurledBundle length={yd.width * 0.94} set={sails} material={sailMat} />
            </group>
            {lod < 2 &&
              [1, -1].map((s) => (
                <Rope key={s} from={[0, 0, (s * yd.width) / 2]} to={[0, h - breakY - 0.02, 0]} livery={livery} radius={0.006} lod={lod} />
              ))}
          </group>
        ))}
        {spec.name === 'mizzen' && (
          <>
            <Beam from={[0.6, 0.72 - breakY + 0.02, 0]} to={[-0.95, h - breakY + 0.1, 0]} radius={0.018} material={m.deckInner} castShadow />
            <ClothSail m={m} set={sails} torn={torn} scorched={scorched} phase={phase + 4} reducedMotion={reducedMotion} lateen={{ a: [0.58, 0.72 - breakY, 0], b: [-0.9, h - breakY + 0.07, 0], drop: 0.95 }} segments={lod === 2 ? [6, 4] : [10, 8]} />
          </>
        )}
        {flag ? (
          <Ensign position={[0, h - breakY - 0.02, 0]} material={m.flag} width={0.6} height={0.36} phase={phase} reducedMotion={reducedMotion} drop={snapped * 0.4} />
        ) : (
          <Flag position={[0, h - breakY - 0.04, 0]} livery={livery} width={0.4} height={0.08} phase={phase + 3} kind="pennant" lod={lod} />
        )}
      </group>
    </group>
  )
}

function Rig({ lod, m, livery, sails, sink, damage, phase, reducedMotion }: { lod: Lod; m: GalleonMaterials; livery: Livery; sails: number; sink: number; damage: readonly CellDamage[]; phase: number; reducedMotion: boolean }) {
  const tornAll = Math.max(0, Math.min(1, sink * 1.6 - 0.1))
  const flagGone = sink > 0.55
  return (
    <group>
      {MASTS.map((spec) => {
        const cell = cellOfX(spec.x)
        const burning = damage[cell] === 'burning'
        const snapped = Math.max(0, Math.min(1, (sink - (0.12 + spec.snapOrder * 0.22)) / 0.3))
        const torn = Math.max(tornAll, burning ? 0.5 : 0)
        return (
          <GalleonMast
            key={spec.name}
            spec={spec}
            lod={lod}
            m={m}
            livery={livery}
            sails={sails}
            torn={torn}
            scorched={burning || sink > 0.4}
            snapped={snapped}
            phase={phase + spec.snapOrder}
            reducedMotion={reducedMotion}
            flag={spec.name === 'main' && !flagGone}
          />
        )
      })}
      {lod < 2 && <StandingRigging lod={lod} livery={livery} sink={sink} />}
    </group>
  )
}

function StandingRigging({ lod, livery, sink }: { lod: Lod; livery: Livery; sink: number }) {
  const [fore, main, mizzen] = MASTS
  const top = (s: MastSpec, k = 1): Vec3 => [s.x, deckY(s.x) + s.height * k, 0]
  const rungs = lod === 0 ? 9 : 4
  if (sink > 0.35) return null
  return (
    <group>
      {MASTS.map((s) => {
        const ry = railY(s.x) + 0.02
        const hw = halfWidth(s.x, ry) - G.plank - 0.02
        return (
          <group key={s.name}>
            <Ratlines from={[s.x, ry, hw]} to={[s.x, deckY(s.x) + s.height * 0.62, 0.03]} livery={livery} rungs={rungs} spread={0.3} lod={lod} />
          </group>
        )
      })}
      {/* stays and backstays */}
      <Rope from={top(fore, 0.98)} to={[G.xBow + 0.95, 1.48, 0]} livery={livery} sag={0.03} lod={lod} />
      <Rope from={top(fore, 0.62)} to={[G.xBow + 0.3, 1.18, 0]} livery={livery} sag={0.03} lod={lod} />
      <Rope from={top(main, 0.98)} to={top(fore, 0.62)} livery={livery} sag={0.03} lod={lod} />
      <Rope from={top(main, 0.62)} to={[fore.x - 0.1, G.forecastleDeckY + 0.05, 0]} livery={livery} sag={0.03} lod={lod} />
      <Rope from={top(mizzen, 0.98)} to={top(main, 0.62)} livery={livery} sag={0.03} lod={lod} />
      <Rope from={top(mizzen, 0.6)} to={[main.x - 0.12, G.mainDeckY + 0.05, 0]} livery={livery} sag={0.03} lod={lod} />
      {[1, -1].map((s) => (
        <group key={s}>
          <Rope from={top(main, 0.97)} to={[G.poopX + 0.05, G.quarterDeckY + 0.08, s * (halfWidth(G.poopX + 0.05, 1.05) - 0.08)]} livery={livery} lod={lod} />
          <Rope from={top(mizzen, 0.97)} to={[G.xStern + 0.1, G.poopDeckY + 0.08, s * (halfWidth(G.xStern + 0.1, 1.45) - 0.08)]} livery={livery} lod={lod} />
        </group>
      ))}
    </group>
  )
}

/* ---------------------------------------------------------------------------------------------- deck fittings */

function DeckFittings({ lod, m, livery }: { lod: Lod; m: GalleonMaterials; livery: Livery }) {
  const pinGeom = useMemo(() => new THREE.CylinderGeometry(0.006, 0.006, 0.07, 5), [])
  const cleatGeom = useMemo(() => new THREE.BoxGeometry(0.06, 0.018, 0.02), [])
  const pins = useMemo(() => {
    const out: { position: Vec3 }[] = []
    for (let x = -0.35; x <= 0.85; x += 0.1) for (const s of [1, -1]) out.push({ position: [x, G.waistRailY + 0.04, s * (halfWidth(x, G.waistRailY) - G.plank - 0.035)] })
    return out
  }, [])
  const cleats = useMemo(() => {
    const out: { position: Vec3 }[] = []
    for (const x of [-1.7, -1.4, -0.9, -0.6, 1.1, 1.4]) for (const s of [1, -1]) out.push({ position: [x, railY(x) + 0.04, s * (halfWidth(x, railY(x)) - G.plank - 0.02)] })
    return out
  }, [])
  return (
    <group>
      {/* treasure hatch with grating and its coaming */}
      <Grating position={[0.3, G.mainDeckY, 0]} width={0.5} depth={0.36} m={m} bars={7} lod={lod} />
      {/* ship's wheel, binnacle, bell */}
      <Wheel position={[-0.75, G.quarterDeckY, 0]} livery={livery} radius={0.14} />
      <mesh material={m.deckInner} position={[-0.6, G.quarterDeckY + 0.11, 0]} castShadow>
        <boxGeometry args={[0.1, 0.22, 0.12]} />
      </mesh>
      <mesh material={m.brass} position={[-0.6, G.quarterDeckY + 0.235, 0]}>
        <sphereGeometry args={[0.035, 8, 6]} />
      </mesh>
      <group position={[1.4, G.forecastleDeckY, 0]}>
        {[-1, 1].map((s) => (
          <mesh key={s} material={m.deckInner} position={[0, 0.12, s * 0.09]}>
            <boxGeometry args={[0.035, 0.24, 0.035]} />
          </mesh>
        ))}
        <mesh material={m.deckInner} position={[0, 0.25, 0]}>
          <boxGeometry args={[0.05, 0.03, 0.22]} />
        </mesh>
        <mesh material={m.brass} position={[0, 0.19, 0]}>
          <cylinderGeometry args={[0.045, 0.028, 0.07, 10]} />
        </mesh>
      </group>
      {lod < 1 && (
        <>
          {/* cargo lashed in the waist */}
          {[1, -1].map((s) => (
            <group key={s}>
              <Barrel position={[0.45, G.mainDeckY, s * 0.3]} livery={livery} scale={0.8} lod={lod} />
              <Barrel position={[0.58, G.mainDeckY, s * 0.42]} livery={livery} scale={0.72} lod={lod} />
              <Crate position={[0.05, G.mainDeckY, s * 0.42]} livery={livery} size={0.16} />
              <Rope from={[-0.04, G.mainDeckY + 0.165, s * 0.35]} to={[0.14, G.mainDeckY + 0.165, s * 0.49]} livery={livery} radius={0.007} />
              <RopeCoil position={[-0.35, G.mainDeckY, s * 0.44]} livery={livery} radius={0.07} />
              <Crate position={[-0.62, G.quarterDeckY, s * 0.3]} livery={livery} size={0.13} />
              <RopeCoil position={[1.5, G.forecastleDeckY, s * 0.14]} livery={livery} radius={0.06} />
              <Lantern position={[G.forecastleX - 0.08, G.mainDeckY + 0.33, s * 0.42]} livery={livery} scale={0.45} lod={lod} />
            </group>
          ))}
          <Instanced geometry={pinGeom} material={m.wale} transforms={pins} />
          <Instanced geometry={cleatGeom} material={m.wale} transforms={cleats} />
          {/* belaying bitts at the foot of the main mast */}
          {[1, -1].map((s) => (
            <mesh key={`bitt${s}`} material={m.deckInner} position={[0.14, G.mainDeckY + 0.12, s * 0.12]} castShadow>
              <boxGeometry args={[0.04, 0.24, 0.04]} />
            </mesh>
          ))}
          <mesh material={m.deckInner} position={[0.14, G.mainDeckY + 0.22, 0]}>
            <boxGeometry args={[0.05, 0.03, 0.3]} />
          </mesh>
        </>
      )}
    </group>
  )
}

/* ---------------------------------------------------------------------------------------------------- damage */

function DamageLayer({ damage, lod, m }: { damage: readonly CellDamage[]; lod: Lod; m: GalleonMaterials }) {
  return (
    <group>
      {damage.map((d, cell) => {
        if (d === 'intact') return null
        const x = cellCenterX(cell)
        const hw = halfWidth(x, IMPACT_Y)
        const dy = deckY(x)
        const dw = 2 * (halfWidth(x, dy) - G.plank) - 0.08
        return (
          <group key={cell}>
            {([1, -1] as const).map((s) => (
              <group key={s}>
                <HullHole position={[x + (s > 0 ? 0.08 : -0.06), IMPACT_Y, s * (hw + 0.004)]} rotationY={s > 0 ? 0 : Math.PI} radius={0.15} seed={cell * 7 + (s > 0 ? 1 : 2)} />
                {lod < 2 && <Splinters position={[x + (s > 0 ? 0.08 : -0.06), IMPACT_Y, s * hw]} sign={s} seed={cell * 31 + (s > 0 ? 7 : 3)} m={m} count={lod === 0 ? 9 : 5} />}
              </group>
            ))}
            {d === 'burning' && (
              <mesh material={m.charred} position={[x, dy + 0.003, 0]} rotation-x={-Math.PI / 2}>
                <planeGeometry args={[0.8, Math.max(0.2, dw)]} />
              </mesh>
            )}
          </group>
        )
      })}
    </group>
  )
}

/* ------------------------------------------------------------------------------------------------------ model */

function GalleonModel({ livery, damage, sinkProgress = 0, lod = 0, quality = 'high', sails = 1, phase = 0, firing = [] }: ShipModelProps) {
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const m = galleonMaterials(livery)
  const effLod: Lod = quality === 'low' ? (Math.max(lod, 1) as Lod) : lod
  const sink = Math.max(0, Math.min(1, sinkProgress))
  const setSails = sails * (1 - Math.max(0, (sink - 0.2) / 0.6))
  const torn = Math.max(0, Math.min(1, sink * 1.6 - 0.1))
  return (
    <group name="galleon">
      <HullShell lod={effLod} m={m} />
      {effLod < 2 && <Castles lod={effLod} m={m} livery={livery} />}
      <SternWorks lod={effLod} m={m} livery={livery} sink={sink} />
      <BowWorks lod={effLod} m={m} livery={livery} sails={setSails} sink={sink} torn={torn} phase={phase} reducedMotion={reducedMotion} />
      {effLod < 2 && <Guns lod={effLod} m={m} livery={livery} firing={firing} damage={damage} />}
      <Rig lod={effLod} m={m} livery={livery} sails={setSails} sink={sink} damage={damage} phase={phase} reducedMotion={reducedMotion} />
      {effLod < 2 && <DeckFittings lod={effLod} m={m} livery={livery} />}
      <DamageLayer damage={damage} lod={effLod} m={m} />
    </group>
  )
}
GalleonModel.displayName = 'Galleon'

export const GALLEON: ShipDefinition = {
  id: 'galleon',
  name: 'Galleon',
  length: 4,
  Model: GalleonModel,
  anchors: GALLEON_ANCHORS,
}
