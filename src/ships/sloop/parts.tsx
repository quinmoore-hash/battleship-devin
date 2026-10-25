/**
 * Sloop-specific parts: hull shell (lofts, wales, keel, stem, rudder, transom), bulwarks with working
 * gun-port lids, the planked deck and its furniture (hatch, cabin trunk, tiller, bitts, pin rails, cleats,
 * chainplates), and per-cell damage. Everything static is built once per LOD and shared by all instances.
 */
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { seededRandom } from '../../vfx/random'
import { Anchor, Barrel, HullHole, Lantern, loftHull, RopeCoil } from '../kit'
import type { CellDamage, Livery } from '../types'
import {
  cleatGeometry,
  deadeyeGeometry,
  deckGeometry,
  gratingGeometry,
  hullPath,
  mergeGeometries,
  placed,
  rudderGeometry,
  sparAlong,
  splinterGeometry,
  sweepRect,
} from './geometry'
import { cellCenterX, deckEdgeHalfWidth, deckY, gunPort, HALF_LENGTH, hullHalfWidth, hullSections, keelY, SLOOP_DIMS } from './hull'
import type { SloopMaterials } from './materials'

const GEOM = new Map<string, THREE.BufferGeometry>()
const geo = (key: string, build: () => THREE.BufferGeometry) => {
  let g = GEOM.get(key)
  if (!g) {
    g = build()
    GEOM.set(key, g)
  }
  return g
}

export const DECK_TOP = (x: number) => deckY(x) - 0.004
export const CAP_RAIL_Y = (x: number) => deckY(x) + 0.1
export const BULWARK_H = 0.105

/* ------------------------------------------------------------------ hull shell */

export interface PartProps {
  m: SloopMaterials
  livery: Livery
  lod: number
}

export function HullShell({ m, livery, lod }: PartProps) {
  const n = lod >= 2 ? 13 : 25
  const rings = lod >= 2 ? 6 : 10
  const below = geo(`below${lod}`, () => loftHull(hullSections('below', n, rings), rings))
  const above = geo(`above${lod}`, () => loftHull(hullSections('above', n, rings), rings))
  const bands = geo(`bands${lod}`, () => {
    const parts: THREE.BufferGeometry[] = []
    const k = lod >= 2 ? 14 : 30
    for (const side of [1, -1] as const) {
      // lower wale and the rubbing strake just under the deck edge
      parts.push(sweepRect(hullPath((x) => deckY(x) - 0.115, side, -0.995, 0.93, k), 0.034, 0.02, 0.014))
      parts.push(sweepRect(hullPath((x) => deckY(x) - 0.03, side, -0.995, 0.96, k), 0.03, 0.02, 0.016))
    }
    return mergeGeometries(parts)
  })
  const bootTop = geo('boottop', () => mergeGeometries([1, -1].map((s) => sweepRect(hullPath(0.002, s as 1 | -1, -0.995, 0.985, 30), 0.03, 0.012, 0.007, -0.012))))
  const keel = geo('keel', () => {
    const pts = Array.from({ length: 16 }, (_, i) => {
      const x = -0.98 + (1.86 * i) / 15
      return { p: new THREE.Vector3(x, keelY(x) - 0.045, 0.022), n: new THREE.Vector3(0, 0, 1) }
    })
    const keelBand = sweepRect(pts, 0.065, 0.044)
    const stem = sparAlong(
      [
        [0.7, keelY(0.7) - 0.03, 0],
        [0.86, keelY(0.86) - 0.02, 0],
        [0.96, -0.04, 0],
        [1.0, 0.14, 0],
        [1.02, 0.3, 0],
        [1.035, 0.47, 0],
      ],
      0.026,
      4,
      14,
    )
    const sternpost = sparAlong(
      [
        [-0.88, keelY(-0.88) - 0.03, 0],
        [-0.985, -0.1, 0],
        [-1.0, 0.1, 0],
        [-1.005, 0.345, 0],
      ],
      0.024,
      4,
      8,
    )
    return mergeGeometries([keelBand, stem, sternpost])
  })
  return (
    <group>
      <mesh geometry={above} material={m.hull} castShadow receiveShadow />
      <mesh geometry={below} material={m.bottom} receiveShadow />
      <mesh geometry={bootTop} material={m.bootTop} />
      <mesh geometry={bands} material={m.wale} castShadow />
      <mesh geometry={keel} material={m.wale} castShadow />
      {lod < 2 && <Rudder m={m} />}
      {lod < 2 && <Transom m={m} livery={livery} lod={lod} />}
    </group>
  )
}

function Rudder({ m }: { m: SloopMaterials }) {
  const blade = geo('rudder', () => rudderGeometry(0.028))
  const straps = geo('rudder-straps', () =>
    mergeGeometries([
      placed(new THREE.BoxGeometry(0.1, 0.014, 0.04), [-1.02, 0.3, 0]),
      placed(new THREE.BoxGeometry(0.11, 0.014, 0.04), [-1.03, 0.02, 0]),
      placed(new THREE.BoxGeometry(0.12, 0.014, 0.04), [-1.06, -0.1, 0]),
    ]),
  )
  return (
    <group>
      <mesh geometry={blade} material={m.hull} castShadow />
      <mesh geometry={straps} material={m.kit.iron} />
    </group>
  )
}

/** Taffrail, two cabin windows in the transom, name board, stern lantern bracket. */
function Transom({ m, livery, lod }: PartProps) {
  const w = deckEdgeHalfWidth(-0.995)
  const frames = geo('transom-frames', () =>
    mergeGeometries(
      [-0.09, 0.09].flatMap((z) => [
        placed(new THREE.BoxGeometry(0.012, 0.075, 0.075), [-1.012, 0.2, z]),
        placed(new THREE.BoxGeometry(0.014, 0.012, 0.08), [-1.014, 0.2, z]),
        placed(new THREE.BoxGeometry(0.014, 0.08, 0.012), [-1.014, 0.2, z]),
      ]),
    ),
  )
  const glass = geo('transom-glass', () => mergeGeometries([-0.09, 0.09].map((z) => placed(new THREE.BoxGeometry(0.006, 0.062, 0.062), [-1.013, 0.2, z]))))
  return (
    <group>
      <mesh material={m.trim} position={[-1.0, 0.33, 0]}>
        <boxGeometry args={[0.03, 0.025, w * 2 + 0.03]} />
      </mesh>
      <mesh material={m.trim} position={[-1.0, 0.1, 0]}>
        <boxGeometry args={[0.02, 0.02, w * 1.6]} />
      </mesh>
      <mesh geometry={frames} material={m.kit.brass} />
      <mesh geometry={glass} material={m.kit.glass} />
      {lod === 0 && (
        <mesh material={m.accent} position={[-1.012, 0.285, 0]}>
          <boxGeometry args={[0.012, 0.035, 0.22]} />
        </mesh>
      )}
      {/* stern lantern on a bracket over the taffrail */}
      <mesh material={m.kit.iron} position={[-1.0, 0.41, -0.15]}>
        <boxGeometry args={[0.012, 0.13, 0.012]} />
      </mesh>
      <mesh material={m.kit.iron} position={[-1.03, 0.47, -0.15]}>
        <boxGeometry args={[0.07, 0.01, 0.01]} />
      </mesh>
      <Lantern position={[-1.06, 0.41, -0.15]} livery={livery} />
    </group>
  )
}

/* ------------------------------------------------------------------ bulwarks + gun ports */

export interface BulwarkProps {
  m: SloopMaterials
  lod: number
  /** Per cell: lid open amount 0..1 for [port, starboard]. At 0 the lid is still triced up (gun run out); 1 flings it fully open when the gun fires. */
  lids: [number, number][]
}

export function Bulwarks({ m, lod, lids }: BulwarkProps) {
  const ports = Array.from({ length: SLOOP_DIMS.length }, (_, c) => gunPort(c))
  const planks = geo(`bulwark${lod}`, () => {
    const parts: THREE.BufferGeometry[] = []
    for (const side of [1, -1] as const) {
      if (lod >= 2) {
        parts.push(sweepRect(hullPath((x) => deckY(x) - 0.005, side, -0.985, 0.975, 16), BULWARK_H, 0.03))
        continue
      }
      // runs between the gun ports, stern → bow
      const edges = [-0.985, ...[...ports].reverse().flatMap((p) => [p.x0, p.x1]), 0.975]
      for (let i = 0; i < edges.length; i += 2) {
        parts.push(sweepRect(hullPath((x) => deckY(x) - 0.005, side, edges[i], edges[i + 1], 10), BULWARK_H, 0.03))
      }
      // sills under each port
      for (const p of ports) parts.push(sweepRect(hullPath((x) => deckY(x) - 0.005, side, p.x0, p.x1, 3), p.sillY - deckY(p.x0) + 0.005, 0.03))
    }
    return mergeGeometries(parts)
  })
  const capRail = geo(`caprail${lod}`, () => mergeGeometries([1, -1].map((s) => sweepRect(hullPath(CAP_RAIL_Y, s as 1 | -1, -0.995, 0.99, lod >= 2 ? 14 : 30), 0.028, 0.058, 0.016))))
  const lining = geo('bulwark-lining', () => mergeGeometries([1, -1].map((s) => sweepRect(hullPath((x) => deckY(x) - 0.002, s as 1 | -1, -0.98, 0.95, 24), 0.095, 0.012, -0.031))))
  const frames = geo('port-frames', () => {
    const parts: THREE.BufferGeometry[] = []
    for (const side of [1, -1] as const) {
      for (const p of ports) {
        for (const x of [p.x0 - 0.011, p.x1 + 0.011]) {
          parts.push(placed(new THREE.BoxGeometry(0.022, BULWARK_H - 0.01, 0.034), [x, deckY(x) + BULWARK_H / 2 - 0.005, side * (hullHalfWidth(x, deckY(x)) - 0.014)]))
        }
      }
      // timberheads inside the bulwark
      for (let x = -0.9; x < 0.95; x += 0.16) {
        if (ports.some((p) => x > p.x0 - 0.04 && x < p.x1 + 0.04)) continue
        parts.push(placed(new THREE.BoxGeometry(0.024, 0.085, 0.022), [x, deckY(x) + 0.045, side * (hullHalfWidth(x, deckY(x)) - 0.055)]))
      }
    }
    return mergeGeometries(parts)
  })
  return (
    <group>
      <mesh geometry={planks} material={m.bulwark} castShadow receiveShadow />
      <mesh geometry={capRail} material={m.trim} castShadow />
      {lod < 2 && <mesh geometry={lining} material={m.bulwarkInner} />}
      {lod < 2 && <mesh geometry={frames} material={m.trim} />}
      {lod < 2 &&
        ports.map((p, cell) =>
          ([-1, 1] as const).map((side) => {
            const x = (p.x0 + p.x1) / 2
            const open = lids[cell]?.[side === -1 ? 0 : 1] ?? 0
            const hw = hullHalfWidth(x, deckY(x) + 0.09)
            return (
              <group key={`${cell}${side}`} position={[x, deckY(x) + BULWARK_H + 0.003, side * (hw + 0.004)]} rotation-x={-side * (1.15 + open * 0.75)}>
                <mesh material={m.bulwark} position={[0, -0.037, side * 0.011]} castShadow>
                  <boxGeometry args={[p.x1 - p.x0 + 0.006, 0.072, 0.022]} />
                </mesh>
                <mesh material={m.bulwarkInner} position={[0, -0.037, side * -0.0005]}>
                  <boxGeometry args={[p.x1 - p.x0 + 0.002, 0.068, 0.002]} />
                </mesh>
                {/* hinge straps */}
                <mesh material={m.kit.iron} position={[-0.04, -0.03, side * 0.023]}>
                  <boxGeometry args={[0.012, 0.055, 0.004]} />
                </mesh>
                <mesh material={m.kit.iron} position={[0.04, -0.03, side * 0.023]}>
                  <boxGeometry args={[0.012, 0.055, 0.004]} />
                </mesh>
              </group>
            )
          }),
        )}
    </group>
  )
}

/* ------------------------------------------------------------------ deck + furniture */

export function Deck({ m, livery, lod }: PartProps) {
  const deck = geo('deck', () => deckGeometry(DECK_TOP))
  return (
    <group>
      <mesh geometry={deck} material={m.deck} receiveShadow />
      <Cabin m={m} lod={lod} />
      {lod < 2 && <Hatch m={m} lod={lod} />}
      {lod < 2 && <Bitts m={m} />}
      {lod < 2 && <Tiller m={m} />}
      {lod < 2 && <Chainplates m={m} lod={lod} />}
      {lod < 2 && <DeckProps m={m} livery={livery} lod={lod} />}
    </group>
  )
}

const CABIN = { x0: -0.93, x1: -0.68, hw: 0.12, h: 0.1 }

/** Low cabin trunk aft: sloped sides, planked top, companionway, portlights, skylight. */
function Cabin({ m, lod }: { m: SloopMaterials; lod: number }) {
  const { x0, x1, hw, h } = CABIN
  const y = DECK_TOP((x0 + x1) / 2)
  const body = geo('cabin', () => {
    const s = new THREE.Shape()
    s.moveTo(-hw, 0)
    s.lineTo(hw, 0)
    s.lineTo(hw - 0.018, h)
    s.lineTo(-hw + 0.018, h)
    s.closePath()
    const g = new THREE.ExtrudeGeometry(s, { depth: x1 - x0, bevelEnabled: false })
    g.rotateY(Math.PI / 2)
    g.translate(x0, 0, 0)
    // extrude maps x→z after rotation; scale UVs to metres
    const uv = g.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * 3)
    return g
  })
  const trimGeom = geo('cabin-trim', () =>
    mergeGeometries([
      placed(new THREE.BoxGeometry(x1 - x0 + 0.03, 0.016, hw * 2 - 0.02), [(x0 + x1) / 2, h + 0.006, 0]),
      // companionway hood on the forward face
      placed(new THREE.BoxGeometry(0.07, 0.07, 0.11), [x1 + 0.02, h - 0.01, 0]),
    ]),
  )
  const fittings = geo('cabin-fittings', () => {
    const parts: THREE.BufferGeometry[] = []
    // portlights: brass rings on each side
    for (const side of [1, -1]) {
      for (const x of [x0 + 0.07, x1 - 0.07]) {
        const ring = new THREE.TorusGeometry(0.02, 0.005, 6, 14)
        parts.push(placed(ring, [x, h * 0.55, side * (hw - 0.0085)]))
      }
    }
    // skylight bars
    for (let i = -2; i <= 2; i++) parts.push(placed(new THREE.BoxGeometry(0.004, 0.006, 0.11), [(x0 + x1) / 2 - 0.03 + i * 0.016, h + 0.022, 0]))
    return mergeGeometries(parts)
  })
  const glass = geo('cabin-glass', () => {
    const parts: THREE.BufferGeometry[] = []
    for (const side of [1, -1]) {
      for (const x of [x0 + 0.07, x1 - 0.07]) {
        const disc = new THREE.CylinderGeometry(0.017, 0.017, 0.004, 12)
        disc.rotateX(Math.PI / 2)
        parts.push(placed(disc, [x, h * 0.55, side * (hw - 0.0095)]))
      }
    }
    parts.push(placed(new THREE.BoxGeometry(0.1, 0.01, 0.12), [(x0 + x1) / 2 - 0.03, h + 0.014, 0]))
    return mergeGeometries(parts)
  })
  return (
    <group position={[0, y, 0]}>
      <mesh geometry={body} material={m.cabin} castShadow receiveShadow />
      <mesh geometry={trimGeom} material={m.trim} castShadow />
      {lod < 2 && <mesh geometry={fittings} material={m.kit.brass} />}
      {lod < 2 && <mesh geometry={glass} material={m.kit.glass} />}
      {lod === 0 && (
        <mesh material={m.kit.brass} position={[x1 + 0.056, h - 0.02, 0.03]}>
          <sphereGeometry args={[0.007, 6, 6]} />
        </mesh>
      )}
    </group>
  )
}

const HATCH = { x: 0.55, w: 0.12, d: 0.14 }

function Hatch({ m, lod }: { m: SloopMaterials; lod: number }) {
  const y = DECK_TOP(HATCH.x)
  const coaming = geo('hatch-coaming', () =>
    mergeGeometries([
      placed(new THREE.BoxGeometry(HATCH.w + 0.03, 0.045, 0.016), [0, 0.02, HATCH.d / 2 + 0.008]),
      placed(new THREE.BoxGeometry(HATCH.w + 0.03, 0.045, 0.016), [0, 0.02, -HATCH.d / 2 - 0.008]),
      placed(new THREE.BoxGeometry(0.016, 0.045, HATCH.d), [HATCH.w / 2 + 0.008, 0.02, 0]),
      placed(new THREE.BoxGeometry(0.016, 0.045, HATCH.d), [-HATCH.w / 2 - 0.008, 0.02, 0]),
    ]),
  )
  const grating = geo('hatch-grating', () => gratingGeometry(HATCH.w, HATCH.d, 6))
  return (
    <group position={[HATCH.x, y, 0]}>
      <mesh geometry={coaming} material={m.cabin} castShadow />
      {lod === 0 ? <mesh geometry={grating} material={m.cabin} position={[0, 0.035, 0]} /> : <mesh material={m.cabin} position={[0, 0.035, 0]}><boxGeometry args={[HATCH.w, 0.012, HATCH.d]} /></mesh>}
    </group>
  )
}

/** Riding bitts forward of the hatch, and the mast partner collar. */
function Bitts({ m }: { m: SloopMaterials }) {
  const g = geo('bitts', () =>
    mergeGeometries([
      placed(new THREE.BoxGeometry(0.03, 0.12, 0.03), [0.655, 0.06, 0.07]),
      placed(new THREE.BoxGeometry(0.03, 0.12, 0.03), [0.655, 0.06, -0.07]),
      placed(new THREE.CylinderGeometry(0.014, 0.014, 0.19, 8), [0.655, 0.085, 0], [Math.PI / 2, 0, 0]),
      placed(new THREE.BoxGeometry(0.13, 0.03, 0.13), [SLOOP_DIMS.mastX, 0.015, 0]),
    ]),
  )
  return <mesh geometry={g} material={m.cabin} position={[0, DECK_TOP(0.5), 0]} castShadow />
}

function Tiller({ m }: { m: SloopMaterials }) {
  const g = geo('tiller', () =>
    sparAlong(
      [
        [-1.03, 0.46, 0],
        [-0.92, 0.505, 0],
        [-0.78, 0.5, 0],
        [-0.62, 0.465, 0],
      ],
      0.015,
      6,
      10,
    ),
  )
  const horse = geo('horse', () => placed(new THREE.CylinderGeometry(0.006, 0.006, 0.26, 6), [-0.975, 0.47, 0], [Math.PI / 2, 0, 0]))
  return (
    <group>
      <mesh geometry={g} material={m.spar} castShadow />
      <mesh material={m.kit.brass} position={[-0.62, 0.465, 0]}>
        <sphereGeometry args={[0.018, 8, 8]} />
      </mesh>
      <mesh geometry={horse} material={m.kit.iron} />
    </group>
  )
}

/** Deadeye/chainplate stations along the rail abreast of the mast. */
export const CHAINPLATE_X = [0.02, 0.15, 0.28]
export const deadeyePos = (x: number, side: 1 | -1): Vec3 => [x, CAP_RAIL_Y(x) + 0.075, side * (hullHalfWidth(x, CAP_RAIL_Y(x)) + 0.03)]

function Chainplates({ m, lod }: { m: SloopMaterials; lod: number }) {
  const deadeyes = geo('deadeyes', () => mergeGeometries(CHAINPLATE_X.flatMap((x) => [1, -1].map((s) => placed(deadeyeGeometry(), deadeyePos(x, s as 1 | -1))))))
  const straps = geo('chainplates', () =>
    mergeGeometries(
      CHAINPLATE_X.flatMap((x) =>
        [1, -1].flatMap((s) => {
          const top = deadeyePos(x, s as 1 | -1)
          const yBottom = deckY(x) - 0.13
          const zBottom = s * (hullHalfWidth(x, yBottom) + 0.012)
          const len = Math.hypot(top[1] - yBottom, top[2] - zBottom)
          const g = new THREE.BoxGeometry(0.018, len, 0.008)
          const ang = Math.atan2(top[2] - zBottom, top[1] - yBottom)
          return [placed(g, [x, (top[1] + yBottom) / 2, (top[2] + zBottom) / 2], [-ang, 0, 0])]
        }),
      ),
    ),
  )
  return (
    <group>
      <mesh geometry={deadeyes} material={m.wale} />
      {lod === 0 && <mesh geometry={straps} material={m.kit.iron} />}
    </group>
  )
}

/** Barrels, buckets, oars, rope coils, pin rails, cleats, anchor and cathead. */
function DeckProps({ m, livery, lod }: PartProps) {
  const cleats = geo('cleats', () =>
    mergeGeometries(
      (
        [
          [0.45, 1],
          [0.45, -1],
          [-0.3, 1],
          [-0.3, -1],
          [-0.82, 1],
          [-0.82, -1],
        ] as [number, 1 | -1][]
      ).map(([x, s]) => placed(cleatGeometry(0.05), [x, DECK_TOP(x) + 0.006, s * (deckEdgeHalfWidth(x) - 0.075)])),
    ),
  )
  const pins = geo('pinrails', () => {
    const parts: THREE.BufferGeometry[] = []
    for (const s of [1, -1]) {
      const x = 0.1
      const z = s * (deckEdgeHalfWidth(x) - 0.06)
      parts.push(placed(new THREE.BoxGeometry(0.26, 0.014, 0.035), [x, DECK_TOP(x) + 0.075, z]))
      for (let i = -3; i <= 3; i++) parts.push(placed(new THREE.CylinderGeometry(0.004, 0.003, 0.05, 5), [x + i * 0.036, DECK_TOP(x) + 0.09, z]))
    }
    return mergeGeometries(parts)
  })
  const oars = geo('oars', () => {
    const parts: THREE.BufferGeometry[] = []
    for (const [dx, dz] of [
      [0, 0],
      [0.05, 0.02],
    ]) {
      const x = -0.25 + dx
      const z = 0.255 + dz
      const y = DECK_TOP(x) + 0.03
      parts.push(placed(new THREE.CylinderGeometry(0.008, 0.008, 0.7, 6), [x, y, z], [0, 0, Math.PI / 2]))
      parts.push(placed(new THREE.BoxGeometry(0.16, 0.008, 0.045), [x + 0.42, y, z]))
    }
    return mergeGeometries(parts)
  })
  const buckets = geo('buckets', () =>
    mergeGeometries(
      [
        [0.02, -0.24],
        [0.07, -0.19],
      ].map(([x, z]) => placed(new THREE.CylinderGeometry(0.03, 0.024, 0.055, 10, 1, true), [x, DECK_TOP(x) + 0.028, z])),
    ),
  )
  const cathead = geo('cathead', () => placed(new THREE.BoxGeometry(0.04, 0.03, 0.14), [0.84, deckY(0.84) + 0.1, -0.12], [0, 0, 0]))
  return (
    <group>
      <Barrel position={[-0.12, DECK_TOP(-0.12), 0.2]} livery={livery} scale={0.55} />
      <Barrel position={[-0.12, DECK_TOP(-0.12), -0.2]} livery={livery} scale={0.55} />
      <Barrel position={[-0.2, DECK_TOP(-0.2), -0.23]} livery={livery} scale={0.45} />
      <RopeCoil position={[0.33, DECK_TOP(0.33), 0.17]} livery={livery} />
      <RopeCoil position={[-0.42, DECK_TOP(-0.42), -0.05]} livery={livery} />
      <mesh geometry={cathead} material={m.cabin} castShadow />
      <Anchor position={[0.84, deckY(0.84) - 0.05, -0.2]} livery={livery} scale={0.6} />
      {lod === 0 && <mesh geometry={cleats} material={m.cabin} />}
      {lod === 0 && <mesh geometry={pins} material={m.cabin} />}
      {lod === 0 && <mesh geometry={oars} material={m.spar} />}
      {lod === 0 && <mesh geometry={buckets} material={m.cabin} />}
    </group>
  )
}

/* ------------------------------------------------------------------ damage */

export function CellDamageFx({ damage, m, lod }: { damage: readonly CellDamage[]; m: SloopMaterials; lod: number }) {
  return (
    <group>
      {damage.map((d, cell) => {
        if (d === 'intact') return null
        const x = cellCenterX(cell)
        const y = 0.1
        const burning = d === 'burning'
        const splinters = geo(`splinters${cell}`, () => {
          const rnd = seededRandom(900 + cell)
          return splinterGeometry(Array.from({ length: 9 }, () => rnd()), 0.1)
        })
        const deckSplinters = geo(`deck-splinters${cell}`, () => {
          const rnd = seededRandom(300 + cell)
          return splinterGeometry(Array.from({ length: 12 }, () => rnd()), 0.16)
        })
        const w = Math.min(0.9, deckEdgeHalfWidth(x) * 2 - 0.08)
        return (
          <group key={cell}>
            {([1, -1] as const).map((side) => {
              const hw = hullHalfWidth(x, y)
              const tilt = Math.atan2(hullHalfWidth(x, y + 0.05) - hullHalfWidth(x, y - 0.05), 0.1)
              return (
                <group key={side} position={[x, y, side * (hw + 0.004)]} rotation-y={side === 1 ? 0 : Math.PI} rotation-x={-tilt}>
                  <HullHole position={[0, 0, 0]} radius={side === 1 ? 0.11 : 0.085} />
                  {lod < 2 && (
                    <mesh geometry={splinters} material={m.wale} rotation-x={Math.PI / 2} position={[0, 0, 0.006]} />
                  )}
                </group>
              )
            })}
            {/* scorched deck + broken planks */}
            <mesh material={m.char} position={[x, DECK_TOP(x) + 0.006, 0]} rotation-x={-Math.PI / 2} scale={burning ? 1.25 : 1}>
              <planeGeometry args={[0.7, w]} />
            </mesh>
            {lod < 2 && <mesh geometry={deckSplinters} material={m.wale} position={[x, DECK_TOP(x), 0]} scale={burning ? 1.3 : 1} />}
          </group>
        )
      })}
    </group>
  )
}

export { HALF_LENGTH }
