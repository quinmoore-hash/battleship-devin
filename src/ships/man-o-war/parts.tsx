/**
 * Man-o’-War parts authored for this class (the generic parts come from `src/ships/kit`). All static geometry
 * is built once per (lod) and shared by every instance; per-instance state (sails set, torn, firing) only
 * rebuilds the small pieces it affects.
 */
import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { hashString } from '../../vfx/random'
import { Anchor, Barrel, Cannon, Crate, Flag, HullHole, Lantern, loftHull, RopeCoil, shipMaterials, Wheel, type HullSection } from '../kit'
import type { CannonRef, CellDamage, Livery, Lod, Side } from '../types'
import {
  bulkheadGeometry,
  clothGeometry,
  deckGeometry,
  hullBand,
  hullSections,
  loftCurves,
  ropeTubes,
  scorchGeometry,
  shroudSegs,
  splinterTransforms,
  stations,
  type RopeSeg,
} from './geometry'
import {
  BOWSPRIT_TIP,
  BREAK,
  DECK,
  GUNS,
  IMPACT_Y,
  LOWER_GUN_Y,
  MAST_RAKE,
  MASTS,
  PORT_SIZE,
  RAIL,
  SIDES,
  UPPER_GUN_Y,
  X_BOW,
  X_GALLERY,
  X_STERN,
  cellX,
  deckY,
  hullHalfWidth,
  isFiring,
  keelY,
  railY,
  sideSign,
  type GunSpec,
  type MastSpec,
} from './spec'
import type { ManOWarMaterials } from './textures'

// ---------------------------------------------------------------------------------------------------------
// small helpers

export interface TRS {
  pos: Vec3
  rot?: Vec3
  scale?: Vec3 | number
}

const _p = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _e = new THREE.Euler()

export function trsMatrix({ pos, rot = [0, 0, 0], scale = 1 }: TRS, out = new THREE.Matrix4()): THREE.Matrix4 {
  _p.set(pos[0], pos[1], pos[2])
  _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]))
  if (typeof scale === 'number') _s.set(scale, scale, scale)
  else _s.set(scale[0], scale[1], scale[2])
  return out.compose(_p, _q, _s)
}

interface InstancedPartProps {
  geometry: THREE.BufferGeometry
  material: THREE.Material | THREE.Material[]
  items: readonly (TRS | THREE.Matrix4)[]
  castShadow?: boolean
  receiveShadow?: boolean
}

/** One draw call for many copies of a small part. Matrices are written once per `items` change, never per frame. */
export function InstancedPart({ geometry, material, items, castShadow, receiveShadow }: InstancedPartProps) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    items.forEach((it, i) => mesh.setMatrixAt(i, it instanceof THREE.Matrix4 ? it : trsMatrix(it, m)))
    mesh.count = items.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items])
  if (items.length === 0) return null
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={castShadow} receiveShadow={receiveShadow} frustumCulled={false} />
}

/** Build-once cache for static geometry shared by all instances. */
function once<T>(build: () => T): () => T {
  let value: T | undefined
  return () => (value ??= build())
}

const cached = <K, V>(build: (k: K) => V) => {
  const map = new Map<K, V>()
  return (k: K): V => {
    let v = map.get(k)
    if (v === undefined) {
      v = build(k)
      map.set(k, v)
    }
    return v
  }
}

const cylinder = cached((key: string) => {
  const [rt, rb, h, seg] = key.split(',').map(Number)
  return new THREE.CylinderGeometry(rt, rb, h, seg)
})
const box = cached((key: string) => {
  const [w, h, d] = key.split(',').map(Number)
  return new THREE.BoxGeometry(w, h, d)
})
const cyl = (rt: number, rb: number, h: number, seg = 8) => cylinder(`${rt},${rb},${h},${seg}`)
const bx = (w: number, h: number, d: number) => box(`${w},${h},${d}`)

/** Local (mast frame, y up the mast) → ship frame, honouring the aft rake. */
export function mastLocalToShip(m: MastSpec, local: Vec3): Vec3 {
  const c = Math.cos(MAST_RAKE)
  const s = Math.sin(MAST_RAKE)
  return [m.x + c * local[0] - s * local[1], m.baseY + s * local[0] + c * local[1], local[2]]
}

const innerSkin = (x: number, y: number) => hullHalfWidth(x, y) - 0.045

// ---------------------------------------------------------------------------------------------------------
// hull

const hullGeo = once(() => ({
  above: loftHull(hullSections('above'), 12),
  below: loftHull(hullSections('below'), 12),
  keel: (() => {
    const xs = stations(X_STERN + 0.05, X_BOW - 0.02, 20)
    const lo = (s: 1 | -1): Vec3[] => xs.map((x) => [x, keelY(x) - 0.045, s * 0.03])
    const hi = (s: 1 | -1): Vec3[] => xs.map((x) => [x, keelY(x) + 0.04, s * 0.03])
    return loftCurves([hi(1), lo(1), lo(-1), hi(-1)], { outward: (p) => [0, -1, Math.sign(p[2])] })
  })(),
  waterline: [hullBand(-0.06, 0.05, 1, 0.008), hullBand(-0.06, 0.05, -1, 0.008)],
  mainWale: [hullBand(0.08, 0.17, 1, 0.028), hullBand(0.08, 0.17, -1, 0.028)],
  channelWale: [hullBand(0.44, 0.5, 1, 0.02), hullBand(0.44, 0.5, -1, 0.02)],
  sheer: [hullBand((x) => railY(x) - 0.09, (x) => railY(x) - 0.03, 1, 0.016), hullBand((x) => railY(x) - 0.09, (x) => railY(x) - 0.03, -1, 0.016)],
  moulding: [hullBand((x) => railY(x) - 0.03, (x) => railY(x) - 0.012, 1, 0.022), hullBand((x) => railY(x) - 0.03, (x) => railY(x) - 0.012, -1, 0.022)],
  lowerStripe: [hullBand(0.2, 0.4, 1, 0.006), hullBand(0.2, 0.4, -1, 0.006)],
  upperStripe: [hullBand(0.58, 0.78, 1, 0.006, X_STERN, BREAK.fore + 0.6), hullBand(0.58, 0.78, -1, 0.006, X_STERN, BREAK.fore + 0.6)],
  capRail: ([1, -1] as const).map((s) => {
    const xs = stations(X_STERN, X_BOW - 0.02, 26)
    const innerBottom = xs.map((x) => [x, railY(x) - 0.01, s * (hullHalfWidth(x, railY(x)) - 0.055)] as Vec3)
    const innerTop = xs.map((x) => [x, railY(x) + 0.02, s * (hullHalfWidth(x, railY(x)) - 0.055)] as Vec3)
    const outerTop = xs.map((x) => [x, railY(x) + 0.02, s * (hullHalfWidth(x, railY(x)) + 0.025)] as Vec3)
    const outerBottom = xs.map((x) => [x, railY(x) - 0.01, s * (hullHalfWidth(x, railY(x)) + 0.025)] as Vec3)
    return loftCurves([innerBottom, innerTop, outerTop, outerBottom], { outward: [0, 1, 0] })
  }),
  innerBulwark: ([1, -1] as const).flatMap((s) =>
    (
      [
        [X_STERN + 0.02, BREAK.poop, DECK.poop],
        [BREAK.poop, BREAK.quarter, DECK.castle],
        [BREAK.quarter, BREAK.fore, DECK.main],
        [BREAK.fore, X_BOW - 0.08, DECK.castle],
      ] as const
    ).map(([x0, x1, dy]) => {
      const xs = stations(x0, x1, 10)
      const low = xs.map((x) => [x, dy - 0.01, s * innerSkin(x, dy)] as Vec3)
      const high = xs.map((x) => [x, railY(x), s * innerSkin(x, railY(x))] as Vec3)
      return loftCurves([low, high], { outward: [0, 0, -s], uvScale: [1, 1] })
    }),
  ),
  decks: {
    main: deckGeometry(BREAK.quarter - 0.1, BREAK.fore + 0.1, DECK.main),
    quarter: deckGeometry(X_STERN + 0.01, BREAK.quarter, DECK.castle),
    fore: deckGeometry(BREAK.fore, X_BOW - 0.05, DECK.castle),
    poop: deckGeometry(X_STERN + 0.01, BREAK.poop, DECK.poop),
  },
  bulkheads: {
    quarter: bulkheadGeometry(BREAK.quarter, DECK.main - 0.02, DECK.castle + 0.01, 0.03, 1),
    fore: bulkheadGeometry(BREAK.fore, DECK.main - 0.02, DECK.castle + 0.01, 0.03, -1),
    poop: bulkheadGeometry(BREAK.poop, DECK.castle - 0.02, DECK.poop + 0.01, 0.03, 1),
  },
  stem: (() => {
    const pts: Vec3[] = [
      [X_BOW - 0.12, keelY(X_BOW) - 0.03, 0],
      [X_BOW + 0.02, 0.2, 0],
      [X_BOW + 0.09, 0.6, 0],
      [X_BOW + 0.14, 0.95, 0],
    ]
    const w = 0.028
    const d = 0.045
    const f = (dz: number, dx: number): Vec3[] => pts.map((p) => [p[0] + dx, p[1], p[2] + dz])
    return loftCurves([f(w, -d), f(w, d), f(-w, d), f(-w, -d)], { outward: (p) => [1, 0, p[2] * 10], closeAcross: true })
  })(),
  rudder: (() => {
    const pts: [number, number][] = [
      [-0.36, 0.2],
      [-0.1, 0.18],
      [0.2, 0.14],
      [0.52, 0.1],
    ]
    const f = (dz: number, back: boolean): Vec3[] => pts.map(([y, w]) => [X_STERN - 0.025 - (back ? w : 0), y, dz])
    return loftCurves([f(0.03, false), f(0.03, true), f(-0.03, true), f(-0.03, false)], { outward: (p) => [-1, 0, p[2] * 20], closeAcross: true })
  })(),
}))

function timberHeads(): TRS[] {
  const out: TRS[] = []
  for (const s of [1, -1] as const) {
    for (const [x0, x1, dy] of [
      [BREAK.quarter + 0.1, BREAK.fore - 0.1, DECK.main],
      [X_STERN + 0.15, BREAK.quarter - 0.1, DECK.castle],
      [BREAK.fore + 0.1, X_BOW - 0.3, DECK.castle],
    ] as const) {
      for (let x = x0; x <= x1; x += 0.22) {
        const h = railY(x) - dy
        out.push({ pos: [x, dy + h / 2, s * (innerSkin(x, dy + h / 2) + 0.012)], scale: [0.04, h, 0.03] })
      }
    }
  }
  return out
}
const timberHeadItems = once(timberHeads)

export interface PartProps {
  m: ManOWarMaterials
  livery: Livery
  lod: Lod
}

export function Hull({ m, livery, lod }: PartProps) {
  const g = hullGeo()
  const navy = livery === 'navy'
  return (
    <group>
      <mesh geometry={g.above} material={m.hull} castShadow receiveShadow />
      <mesh geometry={g.below} material={m.hullBelow} receiveShadow />
      <mesh geometry={g.keel} material={m.wale} />
      <mesh geometry={g.stem} material={m.hull} castShadow />
      <mesh geometry={g.rudder} material={m.hull} castShadow />
      {[-0.25, 0.05, 0.35].map((y) => (
        <mesh key={y} geometry={bx(0.08, 0.03, 0.09)} material={m.iron} position={[X_STERN - 0.03, y, 0]} />
      ))}
      <mesh geometry={g.decks.main} material={m.deck} receiveShadow />
      <mesh geometry={g.decks.quarter} material={m.deck} receiveShadow />
      <mesh geometry={g.decks.fore} material={m.deck} receiveShadow />
      <mesh geometry={g.decks.poop} material={m.deck} receiveShadow />
      <mesh geometry={g.bulkheads.quarter} material={m.deckDark} castShadow receiveShadow />
      <mesh geometry={g.bulkheads.fore} material={m.deckDark} castShadow receiveShadow />
      <mesh geometry={g.bulkheads.poop} material={m.deckDark} castShadow receiveShadow />
      {lod < 2 && (
        <>
          {g.waterline.map((geo, i) => (
            <mesh key={`wl${i}`} geometry={geo} material={m.waterline} />
          ))}
          {g.mainWale.map((geo, i) => (
            <mesh key={`mw${i}`} geometry={geo} material={m.wale} castShadow />
          ))}
          {g.channelWale.map((geo, i) => (
            <mesh key={`cw${i}`} geometry={geo} material={m.wale} />
          ))}
          {g.sheer.map((geo, i) => (
            <mesh key={`sh${i}`} geometry={geo} material={m.wale} />
          ))}
          {g.moulding.map((geo, i) => (
            <mesh key={`md${i}`} geometry={geo} material={navy ? m.gold : m.trim} />
          ))}
          {g.lowerStripe.map((geo, i) => (
            <mesh key={`ls${i}`} geometry={geo} material={m.stripe} />
          ))}
          {navy && g.upperStripe.map((geo, i) => <mesh key={`us${i}`} geometry={geo} material={m.stripe} />)}
          {g.capRail.map((geo, i) => (
            <mesh key={`cr${i}`} geometry={geo} material={m.wale} castShadow />
          ))}
          {g.innerBulwark.map((geo, i) => (
            <mesh key={`ib${i}`} geometry={geo} material={m.deckDark} receiveShadow />
          ))}
          {lod === 0 && <InstancedPart geometry={bx(1, 1, 1)} material={m.spar} items={timberHeadItems()} />}
        </>
      )}
    </group>
  )
}

// ---------------------------------------------------------------------------------------------------------
// gun ports, lids and the guns behind them

interface GunSlot {
  g: GunSpec
  side: Side
  y: number
  skin: number
}

const gunSlots = once((): GunSlot[] =>
  SIDES.flatMap((side) =>
    GUNS.map((g) => {
      const y = g.deck === 'lower' ? LOWER_GUN_Y : UPPER_GUN_Y
      return { g, side, y, skin: hullHalfWidth(g.x, y) }
    }),
  ),
)

const portGeo = once(() => new THREE.PlaneGeometry(PORT_SIZE, PORT_SIZE))
const lidGeo = once(() => {
  const g = new THREE.BoxGeometry(PORT_SIZE + 0.02, PORT_SIZE - 0.01, 0.018)
  g.translate(0, -(PORT_SIZE - 0.01) / 2, 0.012)
  return g
})
const frameGeo = once(() => {
  const outer = PORT_SIZE + 0.03
  const shape = new THREE.Shape()
  shape.moveTo(-outer / 2, -outer / 2)
  shape.lineTo(outer / 2, -outer / 2)
  shape.lineTo(outer / 2, outer / 2)
  shape.lineTo(-outer / 2, outer / 2)
  shape.closePath()
  const hole = new THREE.Path()
  hole.moveTo(-PORT_SIZE / 2, -PORT_SIZE / 2)
  hole.lineTo(PORT_SIZE / 2, -PORT_SIZE / 2)
  hole.lineTo(PORT_SIZE / 2, PORT_SIZE / 2)
  hole.lineTo(-PORT_SIZE / 2, PORT_SIZE / 2)
  hole.closePath()
  shape.holes.push(hole)
  return new THREE.ShapeGeometry(shape, 1)
})
const barrelGeo = once(() => {
  const g = new THREE.CylinderGeometry(0.03, 0.04, 0.44, 10)
  g.rotateX(Math.PI / 2)
  const ring = new THREE.TorusGeometry(0.034, 0.008, 6, 12)
  ring.translate(0, 0, 0.2)
  const g2 = new THREE.CylinderGeometry(0.04, 0.046, 0.06, 10)
  g2.rotateX(Math.PI / 2)
  g2.translate(0, 0, -0.1)
  return mergeSimple([g, ring, g2])
})

/** Merge geometries that only have position/normal/uv, without pulling in the examples bundle. */
function mergeSimple(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (const g of list) {
    const base = positions.length / 3
    const p = g.getAttribute('position')
    const n = g.getAttribute('normal')
    const uv = g.getAttribute('uv')
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i))
      normals.push(n.getX(i), n.getY(i), n.getZ(i))
      uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0)
    }
    const idx = g.getIndex()
    if (idx) for (let i = 0; i < idx.count; i++) indices.push(base + idx.getX(i))
    else for (let i = 0; i < p.count; i++) indices.push(base + i)
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  out.setIndex(indices)
  return out
}

export function GunDecks({ m, livery, lod, firing }: PartProps & { firing?: readonly CannonRef[] }) {
  const slots = gunSlots()
  const firingKey = (firing ?? []).map((f) => `${f.cell}${f.side[0]}`).join('|')
  const { ports, lids, barrels, carriages } = useMemo(() => {
    const ports: TRS[] = []
    const lids: THREE.Matrix4[] = []
    const barrels: TRS[] = []
    const carriages: { slot: GunSlot; recoil: number }[] = []
    const hinge = new THREE.Matrix4()
    const rot = new THREE.Matrix4()
    const off = new THREE.Matrix4()
    for (const slot of slots) {
      const s = sideSign(slot.side)
      const fire = isFiring(firing, slot.g, slot.side)
      const rotY = s > 0 ? 0 : Math.PI
      ports.push({ pos: [slot.g.x, slot.y, s * (slot.skin + 0.004)], rot: [0, rotY, 0] })
      hinge.makeTranslation(slot.g.x, slot.y + PORT_SIZE / 2 + 0.012, s * (slot.skin + 0.012))
      rot.makeRotationX(s * (fire ? 2.2 : 1.75))
      off.makeRotationY(rotY)
      lids.push(hinge.clone().multiply(off).multiply(rot))
      if (slot.g.carriage) carriages.push({ slot, recoil: fire ? 1 : 0 })
      else barrels.push({ pos: [slot.g.x, slot.y, s * (slot.skin + (fire ? -0.2 : -0.08))], rot: [0, rotY, 0] })
    }
    return { ports, lids, barrels, carriages }
    // firingKey captures the content of `firing`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, firingKey])
  const lidMaterials = useMemo(() => [m.wale, m.wale, m.wale, m.wale, m.wale, m.lidInner], [m])
  return (
    <group>
      <InstancedPart geometry={portGeo()} material={m.portDark} items={ports} />
      {lod < 2 && (
        <>
          <InstancedPart geometry={frameGeo()} material={livery === 'navy' ? m.wale : m.trim} items={ports} />
          <InstancedPart geometry={lidGeo()} material={lidMaterials} items={lids} castShadow />
          <InstancedPart geometry={barrelGeo()} material={m.iron} items={barrels} castShadow />
          {carriages.map(({ slot, recoil }) => {
            const s = sideSign(slot.side)
            return (
              <Cannon
                key={`${slot.g.x}${slot.side}`}
                position={[slot.g.x, DECK.main, s * (slot.skin + 0.14 - 0.2475)]}
                rotationY={s > 0 ? 0 : Math.PI}
                livery={livery}
                recoil={recoil}
                scale={0.55}
              />
            )
          })}
        </>
      )}
    </group>
  )
}

// ---------------------------------------------------------------------------------------------------------
// stern gallery, quarter galleries, lanterns

const galleryHalf = (y: number) => hullHalfWidth(X_STERN, y) + 0.06
const galleryBack = (y: number) => X_STERN - 0.1 - 0.2 * Math.min(1, Math.max(0, (y - 0.5) / 0.95))

function galleryCurve(y: number, off = 0, n = 13, flatX?: number): Vec3[] {
  const gw = galleryHalf(y) + off
  const xb = galleryBack(y) - off
  return Array.from({ length: n }, (_, i) => {
    const z = gw - (2 * gw * i) / (n - 1)
    const k = Math.pow(Math.abs(z) / gw, 3)
    const x = flatX ?? xb + (X_STERN - xb) * k
    return [x, y, z] as Vec3
  })
}

/** Position + yaw of a point on the gallery back face at (y, z), facing outward. */
function galleryFacePoint(y: number, z: number, off = 0): { pos: Vec3; rotY: number } {
  const gw = galleryHalf(y)
  const xb = galleryBack(y)
  const f = (zz: number) => xb + (X_STERN - xb) * Math.pow(Math.abs(zz) / gw, 3)
  const x = f(z)
  const dx = (f(z + 0.01) - f(z - 0.01)) / 0.02
  // surface tangent (dx, 1) in (x,z); outward normal (-1, dx) normalised → yaw about y
  const rotY = Math.atan2(-1, dx) + Math.PI / 2
  const nx = -1 / Math.hypot(1, dx)
  const nz = dx / Math.hypot(1, dx)
  return { pos: [x + nx * off, y, z + nz * off], rotY }
}

const galleryGeo = once(() => {
  const body = loftCurves(
    [
      galleryCurve(0.44, -0.02, 13, X_STERN - 0.01),
      galleryCurve(0.5),
      galleryCurve(0.62),
      galleryCurve(0.84),
      galleryCurve(0.96),
      galleryCurve(1.2),
      galleryCurve(1.44),
      galleryCurve(1.46, -0.02, 13, X_STERN - 0.01),
    ],
    { outward: (p) => [-1, 0, p[2] * 2] },
  )
  const moulding = (y: number, h: number, off: number) =>
    loftCurves([galleryCurve(y - h, 0.001), galleryCurve(y - h, off), galleryCurve(y + h, off), galleryCurve(y + h, 0.001)], { outward: (p) => [-1, 0, p[2] * 2] })
  const windowRows = [0.71, 1.07]
  const windowZ = [-0.26, -0.13, 0, 0.13, 0.26]
  const windows: { pos: Vec3; rotY: number }[] = []
  for (const y of windowRows) for (const z of windowZ) windows.push(galleryFacePoint(y, z, 0.006))
  const balusters: TRS[] = galleryCurve(0.9, 0.03, 17).map((p) => ({ pos: p, scale: [0.016, 0.1, 0.016] }))
  return {
    body,
    mouldings: [moulding(0.62, 0.012, 0.02), moulding(0.84, 0.015, 0.035), moulding(0.96, 0.01, 0.035), moulding(1.2, 0.012, 0.02), moulding(1.44, 0.012, 0.02)],
    windows,
    balusters,
    nameBoard: loftCurves([galleryCurve(1.26, 0.008), galleryCurve(1.38, 0.008)], { outward: (p) => [-1, 0, p[2] * 2] }),
  }
})

const windowFrameGeo = once(() => {
  const g = new THREE.BoxGeometry(0.11, 0.15, 0.012)
  return g
})
const windowGlassGeo = once(() => new THREE.PlaneGeometry(0.085, 0.125))
const muntinGeo = once(() => mergeSimple([new THREE.BoxGeometry(0.004, 0.125, 0.004), new THREE.BoxGeometry(0.085, 0.004, 0.004)]))
const balusterGeo = once(() => {
  const pts = [0.5, 0.35, 0.28, 0.42, 0.3, 0.26, 0.4, 0.5].map((r, i, a) => new THREE.Vector2(r, i / (a.length - 1) - 0.5))
  return new THREE.LatheGeometry(pts, 8)
})

function SternLantern({ m, pos, lod }: { m: ManOWarMaterials; pos: Vec3; lod: Lod }) {
  return (
    <group position={pos}>
      <mesh geometry={cyl(0.012, 0.02, 0.14, 8)} material={m.iron} position={[0, -0.12, 0]} />
      <mesh geometry={cyl(0.05, 0.055, 0.02, 8)} material={m.gold} position={[0, -0.05, 0]} />
      <mesh geometry={cyl(0.052, 0.052, 0.13, 6)} material={m.lanternGlass} position={[0, 0.03, 0]} />
      {lod === 0 &&
        [0, 1, 2, 3, 4, 5].map((i) => (
          <mesh key={i} geometry={cyl(0.005, 0.005, 0.13, 4)} material={m.gold} position={[Math.cos((i / 6) * Math.PI * 2 + Math.PI / 6) * 0.05, 0.03, Math.sin((i / 6) * Math.PI * 2 + Math.PI / 6) * 0.05]} />
        ))}
      <mesh geometry={cyl(0.015, 0.065, 0.06, 8)} material={m.gold} position={[0, 0.125, 0]} />
      <mesh geometry={cyl(0.008, 0.008, 0.04, 6)} material={m.gold} position={[0, 0.17, 0]} />
      <mesh material={m.flame} position={[0, 0.01, 0]}>
        <sphereGeometry args={[0.018, 8, 6]} />
      </mesh>
    </group>
  )
}

export function SternGallery({ m, livery, lod }: PartProps) {
  const g = galleryGeo()
  const gold = livery === 'navy' ? m.gold : m.trim
  return (
    <group>
      <mesh geometry={g.body} material={m.hull} castShadow receiveShadow />
      {lod < 2 && (
        <>
          {g.mouldings.map((geo, i) => (
            <mesh key={i} geometry={geo} material={i === 1 ? m.wale : gold} />
          ))}
          <mesh geometry={g.nameBoard} material={m.trim} />
          {g.windows.map((w, i) => (
            <group key={i} position={w.pos} rotation-y={w.rotY}>
              <mesh geometry={windowFrameGeo()} material={gold} />
              <mesh geometry={windowGlassGeo()} material={m.glass} position={[0, 0, 0.008]} />
              {lod === 0 && <mesh geometry={muntinGeo()} material={gold} position={[0, 0, 0.009]} />}
            </group>
          ))}
          <InstancedPart geometry={balusterGeo()} material={gold} items={g.balusters} />
          <SternLantern m={m} pos={[galleryBack(1.44) - 0.04, 1.6, 0]} lod={lod} />
          <SternLantern m={m} pos={[galleryBack(1.44) + 0.02, 1.56, galleryHalf(1.44) * 0.72]} lod={lod} />
          <SternLantern m={m} pos={[galleryBack(1.44) + 0.02, 1.56, -galleryHalf(1.44) * 0.72]} lod={lod} />
          {([1, -1] as const).map((s) => (
            <QuarterGallery key={s} m={m} side={s} gold={gold} lod={lod} />
          ))}
        </>
      )}
    </group>
  )
}

function QuarterGallery({ m, side, gold, lod }: { m: ManOWarMaterials; side: 1 | -1; gold: THREE.Material; lod: Lod }) {
  const x0 = X_STERN + 0.04
  const x1 = X_STERN + 0.36
  const y0 = 0.6
  const y1 = 1.18
  const skin = hullHalfWidth((x0 + x1) / 2, (y0 + y1) / 2)
  const depth = 0.08
  const zc = side * (skin + depth / 2 - 0.01)
  return (
    <group>
      <mesh geometry={bx(x1 - x0, y1 - y0, depth)} material={m.hull} position={[(x0 + x1) / 2, (y0 + y1) / 2, zc]} castShadow />
      <mesh geometry={cyl(depth / 2 + 0.01, depth / 2 + 0.01, x1 - x0, 8, )} material={m.wale} position={[(x0 + x1) / 2, y1, zc]} rotation-z={Math.PI / 2} />
      <mesh geometry={bx(x1 - x0 + 0.02, 0.025, depth + 0.02)} material={gold} position={[(x0 + x1) / 2, y0 + 0.01, zc]} />
      <mesh geometry={bx(x1 - x0 + 0.02, 0.02, depth + 0.02)} material={gold} position={[(x0 + x1) / 2, (y0 + y1) / 2 + 0.02, zc]} />
      {[0.6, 0.95].map((fy) =>
        [0.28, 0.72].map((fx) => (
          <group key={`${fx}${fy}`} position={[x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy - 0.1, side * (skin + depth - 0.004)]} rotation-y={side > 0 ? 0 : Math.PI}>
            <mesh geometry={windowFrameGeo()} material={gold} scale={0.8} />
            <mesh geometry={windowGlassGeo()} material={m.glass} position={[0, 0, 0.008]} scale={0.8} />
            {lod === 0 && <mesh geometry={muntinGeo()} material={gold} position={[0, 0, 0.009]} scale={0.8} />}
          </group>
        )),
      )}
    </group>
  )
}

// ---------------------------------------------------------------------------------------------------------
// figurehead, beakhead, bowsprit

export function Figurehead({ m, lod }: PartProps) {
  const torso = useMemo(
    () => new THREE.LatheGeometry([0.02, 0.045, 0.07, 0.075, 0.06, 0.045].map((r, i, a) => new THREE.Vector2(r, (i / (a.length - 1)) * 0.3)), 10),
    [],
  )
  return (
    <group position={[X_BOW + 0.05, 0.9, 0]} rotation-z={-0.75}>
      <mesh geometry={torso} material={m.figure} castShadow />
      {/* mane collar */}
      <mesh material={m.figure} position={[-0.01, 0.31, 0]} rotation-z={0.3}>
        <coneGeometry args={[0.095, 0.11, 10]} />
      </mesh>
      {/* head + muzzle + ears */}
      <mesh material={m.figure} position={[0.05, 0.37, 0]} castShadow>
        <sphereGeometry args={[0.048, 12, 10]} />
      </mesh>
      <mesh geometry={bx(0.07, 0.045, 0.05)} material={m.figure} position={[0.1, 0.355, 0]} rotation-z={0.2} />
      {lod === 0 &&
        [1, -1].map((s) => (
          <mesh key={s} material={m.figure} position={[0.03, 0.41, s * 0.03]} rotation-x={s * 0.5}>
            <coneGeometry args={[0.012, 0.03, 6]} />
          </mesh>
        ))}
      {/* forelegs reaching forward, hind legs against the stem */}
      {[1, -1].map((s) => (
        <mesh key={`f${s}`} geometry={cyl(0.012, 0.017, 0.2, 8)} material={m.figure} position={[0.1, 0.2, s * 0.035]} rotation-z={-1.25} />
      ))}
      {[1, -1].map((s) => (
        <mesh key={`h${s}`} geometry={cyl(0.014, 0.02, 0.12, 8)} material={m.figure} position={[0.03, 0.04, s * 0.04]} rotation-z={-0.9} />
      ))}
      {/* tail scroll + carved base */}
      <mesh material={m.figure} position={[-0.05, 0.03, 0]} rotation-y={Math.PI / 2}>
        <torusGeometry args={[0.035, 0.009, 6, 10, Math.PI * 1.3]} />
      </mesh>
      <mesh geometry={cyl(0.035, 0.035, 0.1, 10)} material={m.gold} position={[-0.03, -0.05, 0]} rotation-x={Math.PI / 2} />
    </group>
  )
}

const bowspritLen = Math.hypot(BOWSPRIT_TIP[0] - (X_BOW - 0.25), BOWSPRIT_TIP[1] - 0.92)
const bowspritAngle = Math.atan2(BOWSPRIT_TIP[1] - 0.92, BOWSPRIT_TIP[0] - (X_BOW - 0.25))
const bowspritRoot: Vec3 = [X_BOW - 0.25, 0.92, 0]

/** Point along the bowsprit, 0 at the knightheads … 1 at the tip. */
export function bowspritPoint(t: number, dy = 0): Vec3 {
  return [bowspritRoot[0] + (BOWSPRIT_TIP[0] - bowspritRoot[0]) * t, bowspritRoot[1] + (BOWSPRIT_TIP[1] - bowspritRoot[1]) * t + dy, 0]
}

export function Bowsprit({ m, lod, snap }: PartProps & { snap: number }) {
  return (
    <group position={bowspritRoot} rotation-z={bowspritAngle - snap * 0.9} rotation-x={snap * 0.5}>
      <mesh geometry={cyl(0.022, 0.042, bowspritLen, 10)} material={m.spar} position={[bowspritLen / 2, 0, 0]} rotation-z={-Math.PI / 2} castShadow />
      {[0.08, 0.13, 0.18].map((x) => (
        <mesh key={x} material={m.rope} position={[x, 0, 0]} rotation-y={Math.PI / 2}>
          <torusGeometry args={[0.046, 0.009, 6, 12]} />
        </mesh>
      ))}
      <mesh geometry={bx(0.05, 0.05, 0.05)} material={m.iron} position={[bowspritLen * 0.62, 0, 0]} />
      {lod < 2 && (
        <>
          {/* spritsail yard + dolphin striker */}
          <mesh geometry={cyl(0.012, 0.012, 0.7, 8)} material={m.spar} position={[bowspritLen * 0.5, -0.045, 0]} rotation-x={Math.PI / 2} />
          <mesh geometry={cyl(0.01, 0.014, 0.2, 6)} material={m.spar} position={[bowspritLen * 0.62, -0.1, 0]} />
        </>
      )}
    </group>
  )
}

// ---------------------------------------------------------------------------------------------------------
// masts, yards, sails and the standing rigging

const topGeo = cached((r: number) => new THREE.CylinderGeometry(r, r * 0.85, 0.025, 14))
const nestGeo = once(() => new THREE.CylinderGeometry(0.075, 0.06, 0.13, 10, 1, true))

export interface SailState {
  set: number
  torn: number
  scorched: boolean
}

interface SailProps {
  m: ManOWarMaterials
  corners: [Vec3, Vec3, Vec3, Vec3]
  dir: Vec3
  belly: number
  state: SailState
  seed: number
  furlToHead?: boolean
  segs?: [number, number]
}

const q = (v: number, step: number) => Math.round(v / step) * step

export function SailCloth({ m, corners, dir, belly, state, seed, furlToHead = true, segs }: SailProps) {
  const set = q(Math.min(1, Math.max(0, state.set)), 0.05)
  const torn = q(Math.min(1, Math.max(0, state.torn)), 0.1)
  const key = corners.flat().join(',')
  const useSegs: [number, number] = torn > 0 ? [14, 11] : (segs ?? [10, 8])
  const geom = useMemo(() => clothGeometry({ corners, dir, belly, set, torn, seed, furlToHead, segs: useSegs }), [key, dir, belly, set, torn, seed, furlToHead, useSegs[0], useSegs[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  if (torn >= 1) return null
  return <mesh geometry={geom} material={state.scorched ? m.sailScorched : m.sail} castShadow receiveShadow />
}

export interface MastProps extends PartProps {
  index: number
  spec: MastSpec
  sail: SailState
  snap: number
  phase: number
  flag: ReactNode
}

export function Mast({ m, lod, spec, index, sail, snap, flag }: MastProps) {
  const H = spec.height
  const T = spec.top
  const C = spec.crosstrees
  const breakY = H * 0.32
  const fallSide = index === 1 ? -1 : 1
  const big = index < 2
  const yards = spec.yards
  const yardX = (yy: number) => (yy < T ? 0 : yy < C ? 0.05 : 0.1)
  const spanker = index === 2
  return (
    <group position={[spec.x, spec.baseY, 0]} rotation-z={MAST_RAKE}>
      {/* stump */}
      <mesh geometry={cyl(0.047, 0.052, breakY, 10)} material={m.spar} position={[0, breakY / 2, 0]} castShadow />
      <mesh geometry={cyl(0.085, 0.1, 0.05, 8)} material={m.wale} position={[0, 0.025, 0]} />
      {lod < 2 && (
        <group position={[0, 0.12, 0]}>
          {[1, -1].map((s) => (
            <mesh key={s} geometry={bx(0.045, 0.26, 0.045)} material={m.wale} position={[-0.16, 0, s * 0.1]} />
          ))}
          <mesh geometry={bx(0.05, 0.04, 0.3)} material={m.wale} position={[-0.16, 0.08, 0]} />
        </group>
      )}
      <group position={[0, breakY, 0]} rotation-x={snap * 1.3 * fallSide} rotation-z={snap * 0.45}>
        <group position={[0, -breakY, 0]}>
          {/* lower mast above the break */}
          <mesh geometry={cyl(0.036, 0.047, T + 0.25 - breakY, 10)} material={m.spar} position={[0, (T + 0.25 + breakY) / 2, 0]} castShadow />
          {/* top */}
          <mesh geometry={topGeo(big ? 0.17 : 0.13)} material={m.deckDark} position={[0.02, T, 0]} castShadow />
          {lod === 0 && (
            <mesh material={m.spar} position={[0.02, T + 0.09, 0]} rotation-x={Math.PI / 2}>
              <torusGeometry args={[big ? 0.165 : 0.125, 0.006, 5, 16]} />
            </mesh>
          )}
          {/* topmast */}
          <mesh geometry={cyl(0.022, 0.03, C + 0.18 - (T - 0.22), 8)} material={m.spar} position={[0.05, (C + 0.18 + T - 0.22) / 2, 0]} castShadow />
          <mesh geometry={bx(0.08, 0.025, 0.34)} material={m.wale} position={[0.05, C, 0]} />
          <mesh geometry={bx(0.2, 0.025, 0.03)} material={m.wale} position={[0.05, C, 0]} />
          {big && <mesh geometry={nestGeo()} material={m.deckDark} position={[0.05, C + 0.1, 0]} />}
          {/* topgallant */}
          <mesh geometry={cyl(0.011, 0.02, H - (C - 0.14), 8)} material={m.spar} position={[0.1, (H + C - 0.14) / 2, 0]} castShadow />
          <mesh material={m.wale} position={[0.1, H + 0.01, 0]}>
            <sphereGeometry args={[0.024, 8, 6]} />
          </mesh>
          {flag}
          {/* yards + sails */}
          {yards.map(([w, yy, sh], i) => {
            const x = yardX(yy)
            const xs = x + 0.035
            const corners: [Vec3, Vec3, Vec3, Vec3] = [
              [xs, yy - 0.01, -w * 0.48],
              [xs, yy - 0.01, w * 0.48],
              [xs, yy - sh, w * 0.51],
              [xs, yy - sh, -w * 0.51],
            ]
            return (
              <group key={i}>
                <mesh geometry={cyl(0.018, 0.018, w, 8)} material={m.spar} position={[x, yy, 0]} rotation-x={Math.PI / 2} castShadow />
                <mesh geometry={cyl(0.024, 0.024, w * 0.3, 8)} material={m.wale} position={[x, yy, 0]} rotation-x={Math.PI / 2} />
                {lod === 0 && (
                  <>
                    <mesh geometry={bx(0.03, 0.03, 0.05)} material={m.iron} position={[x, yy, w / 2 - 0.03]} />
                    <mesh geometry={bx(0.03, 0.03, 0.05)} material={m.iron} position={[x, yy, -w / 2 + 0.03]} />
                  </>
                )}
                <SailCloth m={m} corners={corners} dir={[1, 0, 0]} belly={w * 0.14} state={sail} seed={index * 10 + i} />
              </group>
            )
          })}
          {spanker && (
            <>
              <mesh geometry={cyl(0.013, 0.013, 0.95, 8)} material={m.spar} position={[-0.44, 1.2, 0]} rotation-z={Math.PI / 2 - 0.42} castShadow />
              <mesh geometry={cyl(0.016, 0.016, 1.05, 8)} material={m.spar} position={[-0.5, 0.45, 0]} rotation-z={Math.PI / 2} castShadow />
              <SailCloth
                m={m}
                corners={[
                  [-0.04, 1.0, 0],
                  [-0.84, 1.38, 0],
                  [-0.98, 0.47, 0],
                  [-0.04, 0.47, 0],
                ]}
                dir={[0, 0, 1]}
                belly={0.12}
                state={sail}
                seed={77}
              />
            </>
          )}
        </group>
      </group>
    </group>
  )
}

/** Channel (chain-wale) abreast each mast and the deadeyes/chain plates under it. */
export interface ChannelSpec {
  x0: number
  x1: number
  y: number
}
export const CHANNELS: ChannelSpec[] = [
  { x0: 1.25, x1: 1.72, y: RAIL.castle - 0.12 },
  { x0: -0.22, x1: 0.34, y: RAIL.waist - 0.08 },
  { x0: -1.52, x1: -1.1, y: RAIL.castle - 0.12 },
]

export function shroudFeet(ch: ChannelSpec, side: 1 | -1, count: number): Vec3[] {
  return Array.from({ length: count }, (_, i) => {
    const x = ch.x0 + ((ch.x1 - ch.x0) * (i + 0.5)) / count
    return [x, ch.y + 0.015, side * (hullHalfWidth(x, ch.y) + 0.1)] as Vec3
  })
}

/** All standing rigging of one mast (both sides), in the ship frame. */
export function mastRigging(i: number, rungs: boolean): RopeSeg[] {
  const mst = MASTS[i]
  const ch = CHANNELS[i]
  const segs: RopeSeg[] = []
  for (const s of [1, -1] as const) {
    const feet = shroudFeet(ch, s, i === 2 ? 3 : 4)
    const head = mastLocalToShip(mst, [0, mst.top - 0.06, s * 0.04])
    segs.push(...shroudSegs(feet, head, rungs))
    const topFeet: Vec3[] = [-0.08, 0, 0.08].map((dx) => mastLocalToShip(mst, [dx + 0.02, mst.top + 0.02, s * (i < 2 ? 0.15 : 0.11)]))
    const topHead = mastLocalToShip(mst, [0.05, mst.crosstrees - 0.04, s * 0.03])
    segs.push(...shroudSegs(topFeet, topHead, rungs, 0.07, 0.007))
    // backstays
    segs.push({ a: mastLocalToShip(mst, [0.05, mst.crosstrees + 0.1, s * 0.02]), b: [ch.x0 - 0.12, ch.y + 0.015, s * (hullHalfWidth(ch.x0 - 0.12, ch.y) + 0.1)], r: 0.008 })
    segs.push({ a: mastLocalToShip(mst, [0.1, mst.height - 0.08, s * 0.015]), b: [ch.x0 - 0.22, ch.y + 0.015, s * (hullHalfWidth(ch.x0 - 0.22, ch.y) + 0.1)], r: 0.007 })
    // lifts: yard arms to the mast above
    for (const [w, yy] of mst.yards) {
      const x = yy < mst.top ? 0 : yy < mst.crosstrees ? 0.05 : 0.1
      const up = yy < mst.top ? mst.top - 0.02 : yy < mst.crosstrees ? mst.crosstrees : mst.height - 0.02
      segs.push({ a: mastLocalToShip(mst, [x, yy, s * (w / 2 - 0.02)]), b: mastLocalToShip(mst, [x + 0.03, up, s * 0.02]), r: 0.006 })
      // braces run aft to the next mast or the deck
      const aftX = i < 2 ? MASTS[i + 1].x - 0.05 : X_STERN - 0.2
      const aftY = i < 2 ? mastLocalToShip(MASTS[i + 1], [0, Math.min(MASTS[i + 1].height - 0.1, yy * 0.75), 0])[1] : RAIL.poop + 0.02
      segs.push({ a: mastLocalToShip(mst, [x, yy, s * (w / 2)]), b: [aftX, aftY, s * (i < 2 ? 0.05 : galleryHalf(1.4) * 0.6)], r: 0.005 })
    }
  }
  // stays (centreline)
  const stayTargets: [Vec3, Vec3, Vec3] =
    i === 0
      ? [bowspritPoint(0.42, 0.02), bowspritPoint(0.78, 0.02), bowspritPoint(0.98, 0.02)]
      : i === 1
        ? [mastLocalToShip(MASTS[0], [0, 0.35, 0]), mastLocalToShip(MASTS[0], [0.03, MASTS[0].top + 0.1, 0]), mastLocalToShip(MASTS[0], [0.06, MASTS[0].crosstrees + 0.05, 0])]
        : [mastLocalToShip(MASTS[1], [0, 0.45, 0]), mastLocalToShip(MASTS[1], [0.03, MASTS[1].top + 0.1, 0]), mastLocalToShip(MASTS[1], [0.06, MASTS[1].crosstrees + 0.05, 0])]
  segs.push({ a: mastLocalToShip(mst, [0.03, mst.top + 0.12, 0]), b: stayTargets[0], r: 0.011 })
  segs.push({ a: mastLocalToShip(mst, [0.06, mst.crosstrees + 0.08, 0]), b: stayTargets[1], r: 0.009 })
  segs.push({ a: mastLocalToShip(mst, [0.1, mst.height - 0.05, 0]), b: stayTargets[2], r: 0.007 })
  if (i === 2) {
    // ensign staff stays + spanker vangs
    segs.push({ a: mastLocalToShip(mst, [-0.84, 1.38, 0]), b: [X_STERN - 0.2, RAIL.poop + 0.02, 0.25], r: 0.006 })
    segs.push({ a: mastLocalToShip(mst, [-0.84, 1.38, 0]), b: [X_STERN - 0.2, RAIL.poop + 0.02, -0.25], r: 0.006 })
  }
  return segs
}

const riggingGeo = cached((key: string) => {
  const [i, rungs] = key.split(',')
  return ropeTubes(mastRigging(Number(i), rungs === '1'), rungs === '1' ? 5 : 4)
})

/** Bowsprit gear: bobstay, gammoning-to-stem, beakhead rails and the anchor cables. */
const bowRiggingGeo = once(() =>
  ropeTubes(
    [
      { a: bowspritPoint(0.6, -0.03), b: [X_BOW + 0.02, 0.1, 0], r: 0.011 },
      { a: bowspritPoint(0.62, -0.2), b: bowspritPoint(0.98, -0.01), r: 0.007 },
      { a: bowspritPoint(0.62, -0.2), b: bowspritPoint(0.25, -0.02), r: 0.007 },
      ...([1, -1] as const).flatMap((s): RopeSeg[] => [
        { a: [X_BOW + 0.1, 0.98, s * 0.03], b: [X_BOW - 0.3, 1.12, s * (hullHalfWidth(X_BOW - 0.3, 1.1) + 0.02)], r: 0.013 },
        { a: [X_BOW + 0.05, 0.8, s * 0.03], b: [X_BOW - 0.3, 0.98, s * (hullHalfWidth(X_BOW - 0.3, 0.98) + 0.02)], r: 0.013 },
        { a: [1.95, 1.17, s * (hullHalfWidth(1.95, 1.0) + 0.3)], b: [1.98, 0.86, s * (hullHalfWidth(1.95, 0.7) + 0.16)], r: 0.012 },
      ]),
    ],
    5,
  ),
)

export function Rigging({ m, lod, snaps }: PartProps & { snaps: number[] }) {
  const rungs = lod === 0 ? '1' : '0'
  return (
    <group>
      {MASTS.map((_, i) => (snaps[i] > 0.05 ? null : <mesh key={i} geometry={riggingGeo(`${i},${rungs}`)} material={m.rope} />))}
      <mesh geometry={bowRiggingGeo()} material={lod === 0 ? m.rope : m.rope} />
      <Channels m={m} lod={lod} />
    </group>
  )
}

const deadeyeGeo = once(() => {
  const g = new THREE.CylinderGeometry(0.02, 0.02, 0.02, 8)
  g.rotateX(Math.PI / 2)
  return g
})
const chainPlateGeo = once(() => new THREE.BoxGeometry(0.012, 0.22, 0.008))

function Channels({ m, lod }: { m: ManOWarMaterials; lod: Lod }) {
  const { boards, deadeyes, plates } = useMemo(() => {
    const boards: TRS[] = []
    const deadeyes: TRS[] = []
    const plates: TRS[] = []
    CHANNELS.forEach((ch, i) => {
      for (const s of [1, -1] as const) {
        const xm = (ch.x0 + ch.x1) / 2
        const skin = hullHalfWidth(xm, ch.y)
        boards.push({ pos: [xm, ch.y, s * (skin + 0.06)], scale: [ch.x1 - ch.x0, 0.028, 0.12] })
        for (const f of shroudFeet(ch, s, i === 2 ? 3 : 4)) {
          deadeyes.push({ pos: [f[0], f[1] + 0.02, f[2]] })
          deadeyes.push({ pos: [f[0], f[1] - 0.09, s * (hullHalfWidth(f[0], f[1] - 0.09) + 0.012)] })
          plates.push({ pos: [f[0], f[1] - 0.2, s * (hullHalfWidth(f[0], f[1] - 0.2) + 0.012)], rot: [s * 0.08, 0, 0] })
        }
      }
    })
    return { boards, deadeyes, plates }
  }, [])
  return (
    <group>
      <InstancedPart geometry={bx(1, 1, 1)} material={m.wale} items={boards} castShadow />
      {lod === 0 && <InstancedPart geometry={deadeyeGeo()} material={m.spar} items={deadeyes} />}
      {lod < 2 && <InstancedPart geometry={chainPlateGeo()} material={m.iron} items={plates} />}
    </group>
  )
}

/** The three headsails hanging from the fore stays. */
export function Jibs({ m, sail, snap }: { m: ManOWarMaterials; sail: SailState; snap: number }) {
  if (snap > 0.3) return null
  const fore = MASTS[0]
  const jibs: { head: Vec3; tack: Vec3; clew: Vec3; belly: number; seed: number }[] = [
    { head: mastLocalToShip(fore, [0.02, fore.top - 0.12, 0]), tack: bowspritPoint(0.42, 0.02), clew: [1.7, 1.02, 0.03], belly: 0.09, seed: 101 },
    { head: mastLocalToShip(fore, [0.04, fore.top + 0.3, 0]), tack: bowspritPoint(0.78, 0.02), clew: [2.15, 1.06, 0.06], belly: 0.1, seed: 102 },
    { head: mastLocalToShip(fore, [0.06, fore.crosstrees - 0.02, 0]), tack: bowspritPoint(0.98, 0.02), clew: [2.55, 1.1, 0.09], belly: 0.11, seed: 103 },
  ]
  return (
    <group>
      {jibs.map((j) => (
        <SailCloth key={j.seed} m={m} corners={[j.head, j.tack, j.clew, j.clew]} dir={[0.2, 0, 0.98]} belly={j.belly} state={sail} seed={j.seed} segs={[8, 8]} />
      ))}
    </group>
  )
}

// ---------------------------------------------------------------------------------------------------------
// deck furniture

const stepGeo = once(() => new THREE.BoxGeometry(0.07, 0.018, 0.14))
const gratingBarGeo = once(() => new THREE.BoxGeometry(0.6, 0.015, 0.012))
const gratingBarGeo2 = once(() => new THREE.BoxGeometry(0.012, 0.015, 0.38))
const pinGeo = once(() => new THREE.CylinderGeometry(0.004, 0.004, 0.05, 5))
const cleatGeo = once(() => new THREE.BoxGeometry(0.05, 0.014, 0.014))
const railPostGeo = once(() => new THREE.BoxGeometry(0.025, 0.22, 0.025))

function stairs(xTop: number, yTop: number, yBottom: number, z: number, dir: 1 | -1, steps = 5): TRS[] {
  const run = 0.3
  return Array.from({ length: steps }, (_, i) => {
    const t = (i + 1) / steps
    return { pos: [xTop - dir * run * (1 - t), yBottom + (yTop - yBottom) * t - 0.01, z] as Vec3 }
  })
}

const deckItems = once(() => {
  const steps: TRS[] = [
    ...stairs(BREAK.quarter, DECK.castle, DECK.main, 0.34, 1),
    ...stairs(BREAK.quarter, DECK.castle, DECK.main, -0.34, 1),
    ...stairs(BREAK.fore, DECK.castle, DECK.main, 0.3, -1),
    ...stairs(BREAK.fore, DECK.castle, DECK.main, -0.3, -1),
    ...stairs(BREAK.poop, DECK.poop, DECK.castle, 0, 1, 4),
  ]
  const gratingA: TRS[] = Array.from({ length: 11 }, (_, i) => ({ pos: [0.62, DECK.main + 0.065, -0.19 + i * 0.038] }))
  const gratingB: TRS[] = Array.from({ length: 15 }, (_, i) => ({ pos: [0.35 + i * 0.04, DECK.main + 0.062, 0] }))
  const pins: TRS[] = []
  const cleats: TRS[] = []
  for (const s of [1, -1] as const) {
    for (let x = -0.4; x <= 1.2; x += 0.07) pins.push({ pos: [x, RAIL.waist - 0.1, s * (innerSkin(x, RAIL.waist) - 0.04)] })
    for (const x of [-1.6, -1.0, 0.1, 0.9, 1.7]) cleats.push({ pos: [x, deckY(x) + 0.2, s * (innerSkin(x, deckY(x) + 0.2) - 0.01)] })
  }
  const railPosts: TRS[] = []
  const rails: TRS[] = []
  const breakRail = (x: number, y: number, gapZ: number) => {
    const w = innerSkin(x, y) - 0.02
    const zs: number[] = []
    for (let z = -w; z <= w + 1e-6; z += 0.16) if (Math.abs(z) < gapZ - 0.05 || Math.abs(z) > gapZ + 0.1 || gapZ === 0) zs.push(z)
    for (const z of zs) railPosts.push({ pos: [x, y + 0.11, z] })
    rails.push({ pos: [x, y + 0.23, 0], scale: [0.03, 0.025, w * 2 + 0.02] })
  }
  breakRail(BREAK.quarter + 0.02, DECK.castle, 0.34)
  breakRail(BREAK.fore - 0.02, DECK.castle, 0.3)
  breakRail(BREAK.poop + 0.02, DECK.poop, 0)
  return { steps, gratingA, gratingB, pins, cleats, railPosts, rails }
})

const boatGeo = once(() => {
  const sections: HullSection[] = [-0.36, -0.3, -0.15, 0, 0.15, 0.3, 0.38].map((x) => {
    const t = 1 - Math.pow(Math.abs(x) / 0.4, 2.2)
    const w = Math.max(0.012, 0.11 * t)
    return { x, keelY: -0.1 * (0.5 + 0.5 * t), railY: 0.02, halfWidths: [0.01, w * 0.6, w * 0.92, w] }
  })
  return loftHull(sections, 4)
})

function ShipsBoat({ m, lod }: { m: ManOWarMaterials; lod: Lod }) {
  return (
    <group position={[0.66, DECK.main + 0.19, 0]}>
      <mesh geometry={boatGeo()} material={m.spar} castShadow />
      {lod === 0 && [-0.2, 0, 0.2].map((x) => <mesh key={x} geometry={bx(0.03, 0.012, 0.2)} material={m.deckDark} position={[x, 0.01, 0]} />)}
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} geometry={bx(0.05, 0.08, 0.3)} material={m.deckDark} position={[x, -0.1, 0]} />
      ))}
    </group>
  )
}

function Capstan({ m, lod }: { m: ManOWarMaterials; lod: Lod }) {
  const whelps: TRS[] = Array.from({ length: 6 }, (_, i) => ({ pos: [Math.cos((i / 6) * Math.PI * 2) * 0.08, 0.1, Math.sin((i / 6) * Math.PI * 2) * 0.08], rot: [0, -(i / 6) * Math.PI * 2, 0], scale: [0.03, 0.17, 0.02] }))
  return (
    <group position={[-0.95, DECK.castle, 0]}>
      <mesh geometry={cyl(0.07, 0.085, 0.2, 10)} material={m.spar} position={[0, 0.1, 0]} castShadow />
      <mesh geometry={cyl(0.11, 0.1, 0.05, 10)} material={m.wale} position={[0, 0.22, 0]} />
      <InstancedPart geometry={bx(1, 1, 1)} material={m.wale} items={whelps} />
      {lod === 0 && [0, Math.PI / 3].map((a) => <mesh key={a} geometry={cyl(0.01, 0.01, 0.5, 6)} material={m.spar} position={[0, 0.22, 0]} rotation={[Math.PI / 2, 0, a]} />)}
    </group>
  )
}

function Belfry({ m }: { m: ManOWarMaterials }) {
  return (
    <group position={[BREAK.fore + 0.06, DECK.castle, 0]}>
      {[1, -1].map((s) => (
        <mesh key={s} geometry={bx(0.03, 0.2, 0.03)} material={m.spar} position={[0, 0.1, s * 0.08]} />
      ))}
      <mesh geometry={bx(0.06, 0.03, 0.22)} material={m.wale} position={[0, 0.21, 0]} />
      <mesh geometry={cyl(0.028, 0.045, 0.06, 10)} material={m.gold} position={[0, 0.14, 0]} />
      <mesh geometry={cyl(0.006, 0.006, 0.05, 5)} material={m.iron} position={[0, 0.09, 0]} />
    </group>
  )
}

function Binnacle({ m }: { m: ManOWarMaterials }) {
  return (
    <group position={[-1.5, DECK.castle, 0]}>
      <mesh geometry={bx(0.1, 0.16, 0.12)} material={m.spar} position={[0, 0.08, 0]} castShadow />
      <mesh geometry={bx(0.08, 0.02, 0.1)} material={m.glass} position={[0, 0.17, 0]} />
      <mesh geometry={bx(0.11, 0.012, 0.13)} material={m.gold} position={[0, 0.165, 0]} />
    </group>
  )
}

export function DeckFurniture({ m, livery, lod }: PartProps) {
  const d = deckItems()
  const km = shipMaterials(livery)
  return (
    <group>
      {/* hatch coaming + grating */}
      <mesh geometry={bx(0.64, 0.05, 0.42)} material={m.wale} position={[0.62, DECK.main + 0.025, 0]} castShadow />
      <mesh geometry={bx(0.6, 0.01, 0.38)} material={m.portDark} position={[0.62, DECK.main + 0.05, 0]} />
      {lod < 2 && (
        <>
          <InstancedPart geometry={stepGeo()} material={m.deckDark} items={d.steps} castShadow />
          <InstancedPart geometry={railPostGeo()} material={m.spar} items={d.railPosts} castShadow />
          <InstancedPart geometry={bx(1, 1, 1)} material={m.wale} items={d.rails} />
          <ShipsBoat m={m} lod={lod} />
          <Capstan m={m} lod={lod} />
          <Belfry m={m} />
          <Binnacle m={m} />
          <Wheel position={[-1.68, DECK.castle, 0]} livery={livery} />
          {/* main-mast bitts and pumps */}
          {[1, -1].map((s) => (
            <mesh key={`p${s}`} geometry={cyl(0.03, 0.035, 0.3, 8)} material={m.iron} position={[-0.32, DECK.main + 0.15, s * 0.14]} castShadow />
          ))}
          {/* skylight on the poop */}
          <mesh geometry={bx(0.24, 0.08, 0.2)} material={m.spar} position={[-2.1, DECK.poop + 0.04, 0]} castShadow />
          <mesh geometry={bx(0.2, 0.012, 0.16)} material={m.glass} position={[-2.1, DECK.poop + 0.085, 0]} />
          {/* lanterns at the breaks */}
          <Lantern position={[BREAK.quarter + 0.03, DECK.castle - 0.08, 0.2]} livery={livery} />
          <Lantern position={[BREAK.quarter + 0.03, DECK.castle - 0.08, -0.2]} livery={livery} />
          {/* catheads + anchors */}
          {([1, -1] as const).map((s) => {
            const skin = hullHalfWidth(1.95, 1.0)
            return (
              <group key={`a${s}`}>
                <mesh geometry={bx(0.07, 0.06, 0.4)} material={m.wale} position={[1.95, RAIL.castle + 0.02, s * (skin + 0.1)]} rotation-y={s * 0.3} castShadow />
                <Anchor position={[1.98, 0.72, s * (hullHalfWidth(1.95, 0.7) + 0.16)]} livery={livery} scale={1.35} />
                <mesh geometry={cyl(0.03, 0.03, 0.02, 10)} material={m.portDark} position={[2.12, 0.62, s * (hullHalfWidth(2.12, 0.62) + 0.002)]} rotation-x={Math.PI / 2} />
              </group>
            )
          })}
        </>
      )}
      {lod === 0 && (
        <>
          <InstancedPart geometry={gratingBarGeo()} material={m.deckDark} items={d.gratingA} />
          <InstancedPart geometry={gratingBarGeo2()} material={m.deckDark} items={d.gratingB} />
          <InstancedPart geometry={pinGeo()} material={m.wale} items={d.pins} />
          <InstancedPart geometry={cleatGeo()} material={m.wale} items={d.cleats} />
          <Barrel position={[1.18, DECK.main, 0.36]} livery={livery} scale={0.8} />
          <Barrel position={[1.18, DECK.main, -0.36]} livery={livery} scale={0.8} />
          <Barrel position={[-0.4, DECK.main, -0.4]} livery={livery} scale={0.7} />
          <Crate position={[-0.42, DECK.main, 0.36]} livery={livery} size={0.15} />
          <Crate position={[-0.26, DECK.main, 0.4]} livery={livery} size={0.11} />
          <RopeCoil position={[0.1, DECK.main, 0.44]} livery={livery} />
          <RopeCoil position={[0.1, DECK.main, -0.44]} livery={livery} />
          <RopeCoil position={[1.6, DECK.castle, 0.3]} livery={livery} />
          <RopeCoil position={[-1.1, DECK.castle, -0.32]} livery={livery} />
          <mesh geometry={bx(0.12, 0.012, 0.6)} material={km.deck} position={[-0.75, DECK.castle + 0.006, 0]} />
        </>
      )}
    </group>
  )
}

// ---------------------------------------------------------------------------------------------------------
// damage

const splinterGeo = once(() => new THREE.BoxGeometry(1, 1, 1))
const sootGeo = once(() => new THREE.PlaneGeometry(0.22, 0.34))
const sootMat = once(() => new THREE.MeshBasicMaterial({ color: '#050302', transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }))
const scorch = cached((cell: number) => scorchGeometry(900 + cell, 0.26))

export function Damage({ m, lod, damage, seed }: PartProps & { damage: readonly CellDamage[]; seed: number }) {
  const cells = damage.map((d, i) => ({ d, i })).filter((c) => c.d !== 'intact')
  return (
    <group>
      {cells.map(({ d, i }) => {
        const x = cellX(i) + (((seed + i * 7) % 5) - 2) * 0.05
        const y = IMPACT_Y + (((seed + i * 3) % 3) - 1) * 0.04
        const dy = deckY(x)
        return (
          <group key={i}>
            {([1, -1] as const).map((s) => {
              const skin = hullHalfWidth(x, y)
              const splinters = lod < 2 ? splinterTransforms(hashString(`${seed}-${i}-${s}`), lod === 0 ? 12 : 6, s) : []
              return (
                <group key={s} position={[x, y, s * (skin + 0.012)]} rotation-y={s > 0 ? 0 : Math.PI}>
                  <HullHole position={[0, 0, 0]} radius={0.15} />
                  <mesh geometry={sootGeo()} material={sootMat()} position={[0, 0.17, 0.002]} />
                  <InstancedPart geometry={splinterGeo()} material={m.splinter} items={splinters} castShadow />
                </group>
              )
            })}
            <mesh geometry={scorch(i)} material={d === 'burning' ? m.char : m.splinter} position={[x, dy + 0.006, 0]} />
          </group>
        )
      })}
    </group>
  )
}

// ---------------------------------------------------------------------------------------------------------
// flags

export function Flags({ livery, sinkProgress, phase }: { livery: Livery; sinkProgress: number; phase: number }) {
  const drop = Math.min(1, Math.max(0, (sinkProgress - 0.4) / 0.15))
  if (drop >= 1) return null
  const staffTop: Vec3 = [X_GALLERY - 0.02, RAIL.poop + 0.62, 0]
  return (
    <group>
      <mesh position={[X_GALLERY - 0.02, RAIL.poop + 0.32, 0]}>
        <cylinderGeometry args={[0.01, 0.013, 0.64, 6]} />
        <meshStandardMaterial color="#6b5234" roughness={0.8} />
      </mesh>
      <Flag position={[staffTop[0], staffTop[1] - 0.12 - drop * 0.4, 0]} livery={livery} width={0.46} height={0.26} phase={phase + 2} />
    </group>
  )
}
