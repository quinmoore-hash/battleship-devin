import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ShipId } from '../../engine'
import type { DeckAnchors } from '../../deck/contract'
import { SHIPS } from '../index'
import type { CellDamage, Livery } from '../types'
import { shipMaterials } from './materials'
import { Barrel, Bell, Crate, Lantern, RopeCoil } from './props'
import { insideConvex, type Pt } from './deck'

/**
 * Eye-height detail for the ship the player stands on ("On deck" mode). Built from the class's `anchors.deck`
 * data so every class gets it for free: plank seams (a texture overlay per walkable level, not geometry),
 * 12-segment rail posts with belaying pins along the bulwarks, ladders at every ramp, lanterns, a bell, and a few
 * barrels / crates / coils / buckets on the open deck (the helm itself — wheel or tiller — is part of each model).
 * Lod 0 only, never baked (mounted by `<Ship dressed>` next to the live model, so it sinks with the hull).
 * Draw budget: ≤ 40 draws per ship — one merged mesh per material plus two instanced meshes and ~6 kit props.
 */
export interface DeckDressingProps {
  shipId: ShipId
  livery: Livery
  damage: readonly CellDamage[]
}

const POST_SPACING = 0.24
const POST_RADIUS = 0.011
const POST_HEIGHT = 0.11
const POST_SEGMENTS = 12
const PIN_SEGMENTS = 8
const PLANK_WIDTH = 0.085

let seamTexture: THREE.CanvasTexture | null = null
/** Shared plank-seam overlay: dark caulking lines + staggered butt joints on a transparent canvas, repeated in world units. */
function plankSeams(): THREE.CanvasTexture {
  if (seamTexture) return seamTexture
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, size, size)
  const planks = 6
  const h = size / planks
  for (let i = 0; i < planks; i++) {
    const y = i * h
    ctx.fillStyle = 'rgba(20, 12, 6, 0.55)'
    ctx.fillRect(0, y, size, 2)
    ctx.fillStyle = 'rgba(255, 230, 190, 0.08)'
    ctx.fillRect(0, y + 2, size, 1)
    // butt joints, staggered per row, with two nail heads
    const joint = ((i * 97) % size) | 0
    ctx.fillStyle = 'rgba(20, 12, 6, 0.5)'
    ctx.fillRect(joint, y, 2, h)
    ctx.fillStyle = 'rgba(30, 30, 34, 0.7)'
    ctx.fillRect(joint + 6, y + h * 0.3, 3, 3)
    ctx.fillRect(joint + 6, y + h * 0.65, 3, 3)
    ctx.fillRect(joint - 9, y + h * 0.3, 3, 3)
    ctx.fillRect(joint - 9, y + h * 0.65, 3, 3)
    // faint grain
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)'
    for (let g = 0; g < 3; g++) ctx.fillRect(0, y + 4 + ((g * 11 + i * 5) % (h - 6)), size, 1)
  }
  seamTexture = new THREE.CanvasTexture(canvas)
  seamTexture.wrapS = seamTexture.wrapT = THREE.RepeatWrapping
  seamTexture.anisotropy = 4
  seamTexture.colorSpace = THREE.SRGBColorSpace
  return seamTexture
}

let seamMaterial: THREE.MeshStandardMaterial | null = null
function seamMat(): THREE.MeshStandardMaterial {
  if (seamMaterial) return seamMaterial
  seamMaterial = new THREE.MeshStandardMaterial({ map: plankSeams(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.9, side: THREE.DoubleSide })
  return seamMaterial
}

/** Flat polygon lying in the x/z plane at `y`, UVs in world units so the seams run fore-and-aft. */
function levelOverlay(points: readonly Pt[], y: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)))
  const g = new THREE.ShapeGeometry(shape)
  // shape is in (x, y) → rotate so its y becomes -z (keep winding facing up)
  g.rotateX(Math.PI / 2)
  g.translate(0, y + 0.004, 0)
  const pos = g.getAttribute('position')
  const uv = g.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / (PLANK_WIDTH * 6) + 0.5, pos.getZ(i) / (PLANK_WIDTH * 6))
  uv.needsUpdate = true
  return g
}

interface Layout {
  overlays: THREE.BufferGeometry
  posts: THREE.Matrix4[]
  pins: THREE.Matrix4[]
  ladders: THREE.BufferGeometry | null
  buckets: THREE.BufferGeometry | null
  props: { kind: 'barrel' | 'crate' | 'coil' | 'lantern' | 'bell'; at: [number, number, number]; cell: number }[]
}

const tmpQ = new THREE.Quaternion()
const tmpS = new THREE.Vector3(1, 1, 1)
const tmpP = new THREE.Vector3()

function buildLayout(id: ShipId, deck: DeckAnchors): Layout {
  const a = SHIPS[id].anchors
  const half = SHIPS[id].length / 2
  const cellOf = (x: number) => Math.min(SHIPS[id].length - 1, Math.max(0, Math.floor(half - x)))
  const overlays = mergeGeometries(deck.walk.map((w) => levelOverlay(w.points, w.y)), false)!

  const posts: THREE.Matrix4[] = []
  const pins: THREE.Matrix4[] = []
  for (const w of deck.walk) {
    const n = w.points.length
    const maxZ = Math.max(...w.points.map((p) => Math.abs(p[1])))
    for (let i = 0; i < n; i++) {
      const [ax, az] = w.points[i]
      const [bx, bz] = w.points[(i + 1) % n]
      // side edges only (not the deck breaks fore/aft)
      if (Math.abs(az + bz) / 2 < maxZ * 0.55) continue
      const len = Math.hypot(bx - ax, bz - az)
      const count = Math.max(1, Math.floor(len / POST_SPACING))
      const out = Math.sign((az + bz) / 2) * 0.035
      for (let k = 0; k <= count; k++) {
        const t = count === 0 ? 0.5 : k / count
        const x = ax + (bx - ax) * t
        const z = az + (bz - az) * t + out
        tmpP.set(x, w.y + POST_HEIGHT / 2, z)
        posts.push(new THREE.Matrix4().compose(tmpP, tmpQ.identity(), tmpS.set(1, 1, 1)))
        if (k < count) {
          const px = x + ((bx - ax) * 0.5) / count
          const pz = z + ((bz - az) * 0.5) / count
          tmpP.set(px, w.y + POST_HEIGHT * 0.78, pz)
          pins.push(new THREE.Matrix4().compose(tmpP, tmpQ.setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), tmpS.set(1, 1, 1)))
        }
      }
    }
  }

  const ladderParts: THREE.BufferGeometry[] = []
  for (const r of deck.ramps) {
    const lo = deck.walk[r.from].y < deck.walk[r.to].y ? deck.walk[r.from] : deck.walk[r.to]
    const hi = lo === deck.walk[r.from] ? deck.walk[r.to] : deck.walk[r.from]
    const rise = hi.y - lo.y
    const x = (r.a[0] + r.b[0]) / 2
    const zc = (r.a[1] + r.b[1]) / 2
    const width = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1])
    // ladder leans from the low deck toward the high one along x
    const dir = insideConvex(hi.points, [x + 0.1, zc]) ? 1 : -1
    const run = rise * 0.6
    const rungs = Math.max(3, Math.round(rise / 0.09))
    for (const s of [-1, 1]) {
      const rail = new THREE.BoxGeometry(0.025, Math.hypot(rise, run) + 0.04, 0.025)
      rail.rotateZ(dir * Math.atan2(run, rise))
      rail.translate(x - (dir * run) / 2, lo.y + rise / 2, zc + (s * width) / 2)
      ladderParts.push(rail)
    }
    for (let k = 1; k <= rungs; k++) {
      const t = k / (rungs + 1)
      const rung = new THREE.BoxGeometry(0.03, 0.02, width)
      rung.translate(x - dir * run * (1 - t) + (dir * run) / 2 - (dir * run) / 2, lo.y + rise * t, zc)
      ladderParts.push(rung)
    }
  }
  const ladders = ladderParts.length ? mergeGeometries(ladderParts, false) : null

  // props on open deck: walk each level's centre line and drop items where no obstacle / station / spawn is near
  const props: Layout['props'] = []
  const bucketParts: THREE.BufferGeometry[] = []
  const taken: Pt[] = [[deck.spawn[0], deck.spawn[2]], ...deck.obstacles.map((o) => o.center), ...deck.stations.map((s) => [s.stand[0], s.stand[2]] as Pt)]
  const free = (p: Pt, r: number) => taken.every((t) => Math.hypot(t[0] - p[0], t[1] - p[1]) > r) && deck.obstacles.every((o) => Math.hypot(o.center[0] - p[0], o.center[1] - p[1]) > o.radius + r)
  const kinds: Layout['props'][number]['kind'][] = ['barrel', 'coil', 'crate', 'barrel', 'coil', 'crate']
  let ki = 0
  for (const w of deck.walk) {
    const xs = w.points.map((p) => p[0])
    const x0 = Math.min(...xs) + 0.15
    const x1 = Math.max(...xs) - 0.15
    const maxZ = Math.max(...w.points.map((p) => Math.abs(p[1])))
    for (let x = x0; x <= x1 && props.length < 6; x += 0.33) {
      for (const s of [1, -1]) {
        const p: Pt = [x, s * (maxZ - 0.16)]
        if (!insideConvex(w.points, p, 0.1) || !free(p, 0.22)) continue
        const kind = kinds[ki++ % kinds.length]
        props.push({ kind, at: [p[0], w.y, p[1]], cell: cellOf(p[0]) })
        taken.push(p)
        if (ki % 3 === 0) {
          const b = new THREE.CylinderGeometry(0.035, 0.03, 0.06, 12, 1, true)
          b.translate(p[0] + 0.12 * s, w.y + 0.03, p[1] - s * 0.1)
          bucketParts.push(b)
        }
        break
      }
    }
  }
  const buckets = bucketParts.length ? mergeGeometries(bucketParts, false) : null

  // lanterns on the two aft corners of the spawn level, bell at the forward end of the lowest (main) deck
  const spawnLevel = deck.walk.find((w) => Math.abs(w.y - deck.spawn[1]) < 1e-6) ?? deck.walk[0]
  const sxs = spawnLevel.points.map((p) => p[0])
  const sMinX = Math.min(...sxs)
  const sMaxZ = Math.max(...spawnLevel.points.map((p) => Math.abs(p[1])))
  for (const s of [1, -1]) props.push({ kind: 'lantern', at: [sMinX + 0.1, spawnLevel.y + 0.1, s * (sMaxZ - 0.06)], cell: cellOf(sMinX + 0.1) })
  const main = deck.walk.reduce((m, w) => (w.y < m.y ? w : m), deck.walk[0])
  const mMaxX = Math.max(...main.points.map((p) => p[0]))
  props.push({ kind: 'bell', at: [mMaxX - 0.12, main.y, 0], cell: cellOf(mMaxX - 0.12) })

  void a
  return { overlays, posts, pins, ladders, buckets, props }
}

const layoutCache = new Map<ShipId, Layout>()
function layoutFor(id: ShipId): Layout | null {
  const deck = SHIPS[id].anchors.deck
  if (!deck) return null
  let l = layoutCache.get(id)
  if (!l) {
    l = buildLayout(id, deck)
    layoutCache.set(id, l)
  }
  return l
}

let postGeo: THREE.CylinderGeometry | null = null
let pinGeo: THREE.CylinderGeometry | null = null

function Instanced({ geometry, material, matrices }: { geometry: THREE.BufferGeometry; material: THREE.Material; matrices: THREE.Matrix4[] }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const m = ref.current
    if (!m) return
    matrices.forEach((mat, i) => m.setMatrixAt(i, mat))
    m.instanceMatrix.needsUpdate = true
    m.computeBoundingSphere()
  }, [matrices])
  if (matrices.length === 0) return null
  return <instancedMesh ref={ref} args={[geometry, material, matrices.length]} frustumCulled />
}

export function DeckDressing({ shipId, livery, damage }: DeckDressingProps) {
  const m = shipMaterials(livery)
  const layout = useMemo(() => layoutFor(shipId), [shipId])
  postGeo ??= new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS * 1.15, POST_HEIGHT, POST_SEGMENTS)
  pinGeo ??= new THREE.CylinderGeometry(0.005, 0.006, 0.07, PIN_SEGMENTS)
  if (!layout) return null
  const ok = (cell: number) => damage[cell] === undefined || damage[cell] === 'intact'
  return (
    <group name="deck-dressing">
      <mesh geometry={layout.overlays} material={seamMat()} renderOrder={1} />
      <Instanced geometry={postGeo} material={m.oak} matrices={layout.posts} />
      <Instanced geometry={pinGeo} material={m.iron} matrices={layout.pins} />
      {layout.ladders && <mesh geometry={layout.ladders} material={m.oak} castShadow />}
      {layout.buckets && <mesh geometry={layout.buckets} material={m.iron} />}
      {layout.props.map((p, i) => {
        if (!ok(p.cell)) return null
        switch (p.kind) {
          case 'barrel':
            return <Barrel key={i} position={p.at} livery={livery} scale={0.5} />
          case 'crate':
            return <Crate key={i} position={p.at} livery={livery} size={0.13} rotationY={0.3 * i} />
          case 'coil':
            return <RopeCoil key={i} position={p.at} livery={livery} radius={0.07} />
          case 'lantern':
            return <Lantern key={i} position={p.at} livery={livery} scale={0.6} light={false} />
          case 'bell':
            return <Bell key={i} position={p.at} livery={livery} scale={0.7} />
        }
      })}
    </group>
  )
}
