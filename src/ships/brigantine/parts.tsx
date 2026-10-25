/**
 * Brigantine-specific deck furniture and hull details: gun-port lids, swivel guns, skylight, companionway,
 * tiller + rudder, ship's boat, grating hatches, bitts, pin rails, cleats, netting, figurehead, stern windows,
 * lanterns, windlass, channels/deadeyes, damage (breach splinters, scorch decals).
 * Candidates for promotion into `src/ships/kit` once the kit session lands its upgraded parts.
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { seededRandom } from '../../vfx/random'
import { HullHole } from '../kit'
import type { Lod, Side } from '../types'
import { BULWARK_THICKNESS, DECK_CAMBER, DECK_Y, PORT_TOP, PORT_WIDTH, TRANSOM_X, deckSurfaceY, hullHalfWidth, keelY, sheerY } from './hull'
import type { BrigMaterials } from './materials'

/** Height of cannonball breaches on the hull side: between the lower and main wales. */
export const BREACH_Y = 0.21

const sgn = (side: Side) => (side === 'starboard' ? 1 : -1)

/**
 * Hinged lid above a gun port, aligned to the local hull tangent and tumblehome. `open` 0 = shut,
 * ~0.55 = propped open on its tackle (gun run out), 1 = thrown fully open (firing).
 */
export function GunPortLid({ x, side, open, mats }: { x: number; side: Side; open: number; mats: BrigMaterials }) {
  const s = sgn(side)
  const hw = hullHalfWidth(x, PORT_TOP)
  const dwdx = (hullHalfWidth(x + 0.01, PORT_TOP) - hullHalfWidth(x - 0.01, PORT_TOP)) / 0.02
  const yaw = Math.atan2(-dwdx, s)
  const h = PORT_TOP - DECK_Y - 0.04 + 0.012
  return (
    <group position={[x, PORT_TOP + 0.004, s * hw]} rotation-y={yaw}>
      <group rotation-x={-(Math.atan(0.22) + open * 1.75)}>
        <mesh material={mats.lidOuter} position={[0, -h / 2, -0.004]} castShadow>
          <boxGeometry args={[PORT_WIDTH - 0.004, h, 0.012]} />
        </mesh>
        <mesh material={mats.trim} position={[0, -h / 2, -0.0115]}>
          <boxGeometry args={[PORT_WIDTH - 0.01, h - 0.006, 0.004]} />
        </mesh>
        {[-0.035, 0.035].map((dx) => (
          <mesh key={dx} material={mats.iron} position={[dx, -0.025, 0.0025]}>
            <boxGeometry args={[0.01, 0.05, 0.003]} />
          </mesh>
        ))}
        <mesh material={mats.iron} position={[0, -h + 0.012, 0.003]}>
          <torusGeometry args={[0.007, 0.0025, 4, 8]} />
        </mesh>
      </group>
      {/* hinge knuckles on the hull above the port */}
      <mesh material={mats.iron} position={[0, 0.004, 0.004]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.006, 0.006, PORT_WIDTH - 0.02, 6]} />
      </mesh>
    </group>
  )
}

/** Small swivel gun in a yoke on a rail post. */
export function SwivelGun({ x, side, mats }: { x: number; side: Side; mats: BrigMaterials }) {
  const s = sgn(side)
  const y = sheerY(x)
  const z = s * (hullHalfWidth(x, y) - BULWARK_THICKNESS / 2)
  return (
    <group position={[x, y, z]}>
      <mesh material={mats.timber} position={[0, 0.06, 0]} castShadow>
        <cylinderGeometry args={[0.014, 0.018, 0.12, 8]} />
      </mesh>
      <mesh material={mats.iron} position={[0, 0.125, 0]} rotation-y={Math.PI / 2}>
        <torusGeometry args={[0.022, 0.006, 6, 10, Math.PI]} />
      </mesh>
      <group position={[0, 0.14, 0]} rotation-x={s * (Math.PI / 2 - 0.25)}>
        <mesh material={mats.iron} position={[0, 0.07, 0]} castShadow>
          <cylinderGeometry args={[0.012, 0.017, 0.2, 10]} />
        </mesh>
        <mesh material={mats.iron} position={[0, 0.165, 0]}>
          <cylinderGeometry args={[0.016, 0.013, 0.02, 10]} />
        </mesh>
        <mesh material={mats.iron} position={[0, -0.045, 0]}>
          <sphereGeometry args={[0.014, 8, 6]} />
        </mesh>
        <mesh material={mats.timber} position={[0, -0.1, 0]}>
          <cylinderGeometry args={[0.006, 0.008, 0.1, 6]} />
        </mesh>
      </group>
    </group>
  )
}

/** Cabin-top skylight: timber frame, two sloped glazed lights with brass protection bars. */
export function Skylight({ position, mats, lod }: { position: Vec3; mats: BrigMaterials; lod: Lod }) {
  const w = 0.22
  const d = 0.16
  const h = 0.06
  return (
    <group position={position}>
      <mesh material={mats.timber} position={[0, 0.02, 0]} castShadow>
        <boxGeometry args={[w, 0.04, d]} />
      </mesh>
      <mesh material={mats.timber} position={[0, h, 0]}>
        <boxGeometry args={[w * 0.9, 0.02, 0.02]} />
      </mesh>
      {[1, -1].map((s) => (
        <group key={s} position={[0, 0.04, (s * d) / 4]} rotation-x={s * 0.55}>
          <mesh material={mats.glass} position={[0, 0.012, 0]}>
            <boxGeometry args={[w * 0.86, 0.006, d * 0.5]} />
          </mesh>
          <mesh material={mats.timber} position={[0, 0.012, 0]}>
            <boxGeometry args={[w * 0.9, 0.008, 0.012]} />
          </mesh>
          {lod === 0 &&
            [-0.06, -0.02, 0.02, 0.06].map((dx) => (
              <mesh key={dx} material={mats.brass} position={[dx, 0.018, 0]} rotation-x={Math.PI / 2}>
                <cylinderGeometry args={[0.0025, 0.0025, d * 0.5, 5]} />
              </mesh>
            ))}
        </group>
      ))}
    </group>
  )
}

/** Hooded companionway hatch with sliding top and a dark doorway facing forward (+x). */
export function Companionway({ position, mats }: { position: Vec3; mats: BrigMaterials }) {
  return (
    <group position={position}>
      <mesh material={mats.timber} position={[0, 0.07, 0]} castShadow>
        <boxGeometry args={[0.16, 0.14, 0.18]} />
      </mesh>
      <mesh material={mats.timber} position={[-0.01, 0.15, 0]}>
        <boxGeometry args={[0.2, 0.02, 0.2]} />
      </mesh>
      <mesh material={mats.splinter} position={[0.081, 0.06, 0]}>
        <boxGeometry args={[0.004, 0.1, 0.1]} />
      </mesh>
      <mesh material={mats.brass} position={[0.085, 0.07, 0.03]}>
        <sphereGeometry args={[0.008, 6, 6]} />
      </mesh>
    </group>
  )
}

/** Rudder hung on the stern post below the transom, with pintle straps, plus the rudder head and tiller on deck. */
export function RudderAndTiller({ mats, tillerY, lod }: { mats: BrigMaterials; tillerY: number; lod: Lod }) {
  const bottom = keelY(TRANSOM_X) - 0.04
  const top = 0.32
  const h = top - bottom
  const x = TRANSOM_X - 0.045
  return (
    <group>
      <mesh material={mats.timber} position={[x, bottom + h / 2, 0]} castShadow>
        <boxGeometry args={[0.06, h, 0.04]} />
      </mesh>
      <mesh material={mats.timber} position={[x - 0.045, bottom + h * 0.45, 0]}>
        <boxGeometry args={[0.05, h * 0.75, 0.03]} />
      </mesh>
      {lod < 2 &&
        [0.2, 0.55, 0.85].map((t) => (
          <mesh key={t} material={mats.iron} position={[x - 0.02, bottom + h * t, 0]}>
            <boxGeometry args={[0.11, 0.018, 0.046]} />
          </mesh>
        ))}
      {/* rudder head through the deck and the tiller sweeping forward */}
      <mesh material={mats.timber} position={[TRANSOM_X + 0.06, (tillerY + 0.3) / 2, 0]}>
        <boxGeometry args={[0.05, tillerY - 0.3 + 0.02, 0.05]} />
      </mesh>
      <group position={[TRANSOM_X + 0.06, tillerY + 0.02, 0]} rotation-y={0.12}>
        <mesh material={mats.spar} position={[0.21, 0, 0]} rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.013, 0.02, 0.42, 7]} />
        </mesh>
        <mesh material={mats.brass} position={[0.4, 0, 0]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.016, 0.016, 0.03, 8]} />
        </mesh>
      </group>
    </group>
  )
}

/** Ship's boat hull: a tiny clinker boat lofted around half-ellipse sections. */
export function buildBoatGeometry(length = 0.5, beam = 0.17, depth = 0.075): THREE.BufferGeometry {
  const nx = 12
  const nr = 6
  const pos: number[] = []
  const idx: number[] = []
  const uv: number[] = []
  for (let i = 0; i <= nx; i++) {
    const t = i / nx
    const x = -length / 2 + length * t
    const s = Math.sin(Math.PI * t)
    const w = (beam / 2) * Math.pow(s, 0.55) + 0.004
    const d = depth * (0.35 + 0.65 * Math.pow(s, 0.5))
    const sheer = depth * 0.12 * (1 - s)
    for (let r = 0; r <= nr; r++) {
      const a = -Math.PI / 2 + (Math.PI * r) / nr
      pos.push(x, sheer - d * Math.cos(a) + d, w * Math.sin(a))
      uv.push(t * 3, r / nr)
    }
  }
  for (let i = 0; i < nx; i++) {
    for (let r = 0; r < nr; r++) {
      const a = i * (nr + 1) + r
      const b = a + nr + 1
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

let BOAT_GEOM: THREE.BufferGeometry | null = null

/** Boat stowed upright on chocks amidships, thwarts, gunwale, oars and lashings. */
export function ShipBoat({ position, mats, lod }: { position: Vec3; mats: BrigMaterials; lod: Lod }) {
  const geom = useMemo(() => (BOAT_GEOM ??= buildBoatGeometry()), [])
  const L = 0.5
  return (
    <group position={position}>
      {[-0.15, 0.15].map((x) => (
        <mesh key={x} material={mats.timber} position={[x, 0.015, 0]}>
          <boxGeometry args={[0.04, 0.03, 0.2]} />
        </mesh>
      ))}
      <group position={[0, 0.03, 0]}>
        <mesh geometry={geom} material={mats.spar} castShadow receiveShadow />
        <mesh geometry={geom} material={mats.timber} scale={[0.97, 0.97, 0.94]} position={[0, 0.004, 0]} />
        {lod < 2 && (
          <>
            {[-0.14, 0, 0.14].map((x) => (
              <mesh key={x} material={mats.spar} position={[x, 0.06, 0]}>
                <boxGeometry args={[0.03, 0.012, 0.15 * (1 - Math.abs(x) * 0.9)]} />
              </mesh>
            ))}
            <mesh material={mats.timber} position={[0, 0.082, 0]} rotation-x={Math.PI / 2}>
              <torusGeometry args={[0.1, 0.006, 4, 16]} scale={[2.4, 0.85, 1]} />
            </mesh>
            {[-0.03, 0.03].map((z) => (
              <mesh key={z} material={mats.spar} position={[0.02, 0.07, z]} rotation-z={Math.PI / 2}>
                <cylinderGeometry args={[0.006, 0.006, L * 0.9, 5]} />
              </mesh>
            ))}
          </>
        )}
      </group>
      {lod < 2 &&
        [-0.13, 0.13].map((x) => (
          <mesh key={x} material={mats.rope} position={[x, 0.065, 0]} rotation-y={Math.PI / 2}>
            <torusGeometry args={[0.1, 0.005, 4, 14]} />
          </mesh>
        ))}
    </group>
  )
}

/** Cargo hatch with coaming and a grating of crossed bars (instanced). */
export function Hatch({ position, size, mats, lod }: { position: Vec3; size: [number, number]; mats: BrigMaterials; lod: Lod }) {
  const [w, d] = size
  const bars = useMemo(() => {
    const nx = Math.round(w / 0.03)
    const nz = Math.round(d / 0.03)
    const items: { pos: Vec3; scale: Vec3 }[] = []
    for (let i = 1; i < nx; i++) items.push({ pos: [-w / 2 + (w * i) / nx, 0.045, 0], scale: [0.008, 0.012, d - 0.04] })
    for (let j = 1; j < nz; j++) items.push({ pos: [0, 0.045, -d / 2 + (d * j) / nz], scale: [w - 0.04, 0.012, 0.008] })
    return items
  }, [w, d])
  const ref = useMemo(() => {
    const geom = new THREE.BoxGeometry(1, 1, 1)
    const im = new THREE.InstancedMesh(geom, mats.timber, Math.max(1, bars.length))
    const m = new THREE.Matrix4()
    bars.forEach((b, i) => {
      m.compose(new THREE.Vector3(...b.pos), new THREE.Quaternion(), new THREE.Vector3(...b.scale))
      im.setMatrixAt(i, m)
    })
    im.instanceMatrix.needsUpdate = true
    im.castShadow = true
    return im
  }, [bars, mats])
  return (
    <group position={position}>
      {[
        [0, 0.025, d / 2],
        [0, 0.025, -d / 2],
      ].map(([x, y, z], i) => (
        <mesh key={`c${i}`} material={mats.timber} position={[x, y, z]} castShadow>
          <boxGeometry args={[w + 0.03, 0.05, 0.03]} />
        </mesh>
      ))}
      {[w / 2, -w / 2].map((x) => (
        <mesh key={`s${x}`} material={mats.timber} position={[x, 0.025, 0]} castShadow>
          <boxGeometry args={[0.03, 0.05, d]} />
        </mesh>
      ))}
      <mesh material={mats.splinter} position={[0, 0.03, 0]}>
        <boxGeometry args={[w - 0.02, 0.01, d - 0.02]} />
      </mesh>
      {lod < 2 && <primitive object={ref} />}
    </group>
  )
}

/** Pair of posts with a cross piece, for belaying heavy lines. */
export function Bitts({ position, mats }: { position: Vec3; mats: BrigMaterials }) {
  return (
    <group position={position}>
      {[-0.07, 0.07].map((z) => (
        <mesh key={z} material={mats.timber} position={[0, 0.09, z]} castShadow>
          <boxGeometry args={[0.04, 0.18, 0.04]} />
        </mesh>
      ))}
      <mesh material={mats.timber} position={[0, 0.13, 0]}>
        <boxGeometry args={[0.05, 0.035, 0.2]} />
      </mesh>
    </group>
  )
}

/** Fife/pin rail along the inside of the bulwark with belaying pins and a rope hank. */
export function PinRail({ x0, x1, side, mats, pins = 5 }: { x0: number; x1: number; side: Side; mats: BrigMaterials; pins?: number }) {
  const s = sgn(side)
  const y = DECK_Y + 0.11
  const items = Array.from({ length: pins }, (_, i) => x0 + ((x1 - x0) * (i + 0.5)) / pins)
  return (
    <group>
      <mesh material={mats.timber} position={[(x0 + x1) / 2, y, s * (hullHalfWidth((x0 + x1) / 2, y) - BULWARK_THICKNESS - 0.03)]}>
        <boxGeometry args={[Math.abs(x1 - x0), 0.016, 0.05]} />
      </mesh>
      {items.map((x) => (
        <group key={x} position={[x, y, s * (hullHalfWidth(x, y) - BULWARK_THICKNESS - 0.03)]}>
          <mesh material={mats.spar} position={[0, 0.005, 0]}>
            <cylinderGeometry args={[0.005, 0.004, 0.08, 5]} />
          </mesh>
          <mesh material={mats.rope} position={[0, -0.025, s * -0.004]}>
            <capsuleGeometry args={[0.009, 0.04, 2, 6]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** Cleats along the cap rail (one instanced mesh). */
export function Cleats({ xs, mats }: { xs: number[]; mats: BrigMaterials }) {
  const im = useMemo(() => {
    const geom = new THREE.BoxGeometry(0.05, 0.012, 0.012)
    const base = new THREE.BoxGeometry(0.018, 0.016, 0.014)
    base.translate(0, -0.012, 0)
    const merged = mergeBox(geom, base)
    const inst = new THREE.InstancedMesh(merged, mats.timber, xs.length * 2)
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const sc = new THREE.Vector3(1, 1, 1)
    xs.forEach((x, i) => {
      ;([1, -1] as const).forEach((s, k) => {
        const y = sheerY(x)
        m.compose(new THREE.Vector3(x, y + 0.03, s * (hullHalfWidth(x, y) - BULWARK_THICKNESS / 2)), q, sc)
        inst.setMatrixAt(i * 2 + k, m)
      })
    })
    inst.instanceMatrix.needsUpdate = true
    return inst
  }, [xs, mats])
  return <primitive object={im} />
}

function mergeBox(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const pa = a.getAttribute('position')
  const pb = b.getAttribute('position')
  const na = a.getAttribute('normal')
  const nb = b.getAttribute('normal')
  const pos = new Float32Array(pa.count * 3 + pb.count * 3)
  pos.set(pa.array as Float32Array, 0)
  pos.set(pb.array as Float32Array, pa.count * 3)
  const nor = new Float32Array(pos.length)
  nor.set(na.array as Float32Array, 0)
  nor.set(nb.array as Float32Array, pa.count * 3)
  const idx: number[] = []
  const ia = a.getIndex()!
  const ib = b.getIndex()!
  for (let i = 0; i < ia.count; i++) idx.push(ia.getX(i))
  for (let i = 0; i < ib.count; i++) idx.push(ib.getX(i) + pa.count)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setIndex(idx)
  return g
}

/** Rope netting stretched along the rail (hammock / boarding netting), leaning slightly inboard. */
export function Netting({ x0, x1, side, height, mats }: { x0: number; x1: number; side: Side; height: number; mats: BrigMaterials }) {
  const s = sgn(side)
  const xm = (x0 + x1) / 2
  const y = sheerY(xm)
  return (
    <mesh material={mats.netting} position={[xm, y + height / 2, s * (hullHalfWidth(xm, y) - BULWARK_THICKNESS / 2 - 0.01)]} rotation-x={s * 0.12}>
      <planeGeometry args={[Math.abs(x1 - x0), height, 1, 1]} />
    </mesh>
  )
}

/** Figurehead: a rearing sea-serpent under the bowsprit, gilt for navy, bone for pirates. */
export function Figurehead({ mats, x, y, livery }: { mats: BrigMaterials; x: number; y: number; livery: 'pirate' | 'navy' }) {
  const geom = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.16, 0),
      new THREE.Vector3(0.05, -0.06, 0),
      new THREE.Vector3(0.1, 0.03, 0),
      new THREE.Vector3(0.13, 0.11, 0),
      new THREE.Vector3(0.11, 0.17, 0),
    ])
    const tube = new THREE.TubeGeometry(curve, 14, 0.028, 8, false)
    // taper toward the head
    const p = tube.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const t = Math.floor(i / 9) / 14
      const c = curve.getPoint(Math.min(1, t))
      const k = 1.15 - t * 0.5
      p.setXYZ(i, c.x + (p.getX(i) - c.x) * k, c.y + (p.getY(i) - c.y) * k, (p.getZ(i) - c.z) * k)
    }
    p.needsUpdate = true
    tube.computeVertexNormals()
    return tube
  }, [])
  const mat = livery === 'navy' ? mats.brass : mats.accent
  return (
    <group position={[x, y, 0]}>
      <mesh geometry={geom} material={mat} castShadow />
      <group position={[0.12, 0.19, 0]} rotation-z={-0.3}>
        <mesh material={mat} rotation-z={-Math.PI / 2} position={[0.03, 0, 0]} castShadow>
          <coneGeometry args={[0.03, 0.11, 8]} />
        </mesh>
        <mesh material={mat} position={[-0.015, 0.03, 0]} rotation-z={0.5}>
          <coneGeometry args={[0.01, 0.06, 5]} />
        </mesh>
        {[-0.018, 0.018].map((z) => (
          <mesh key={z} material={mats.iron} position={[0.02, 0.012, z]}>
            <sphereGeometry args={[0.006, 6, 6]} />
          </mesh>
        ))}
      </group>
      {/* dorsal fin plates */}
      {[0.2, 0.45, 0.7].map((t) => (
        <mesh key={t} material={mat} position={[0.03 + t * 0.1, -0.14 + t * 0.3, 0]} rotation-z={-0.6}>
          <coneGeometry args={[0.012, 0.05, 4]} />
        </mesh>
      ))}
    </group>
  )
}

/** Head rails: two curved timbers sweeping from the hull sides up to the figurehead. */
export function HeadRails({ mats, from, to }: { mats: BrigMaterials; from: Vec3; to: Vec3 }) {
  const geom = useMemo(() => {
    const mk = (s: 1 | -1) =>
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(from[0], from[1], s * from[2]),
          new THREE.Vector3((from[0] + to[0]) / 2, from[1] - 0.01, s * (hullHalfWidth((from[0] + to[0]) / 2, from[1] - 0.01) + 0.03)),
          new THREE.Vector3(to[0], to[1], s * to[2]),
        ]),
        10,
        0.011,
        5,
        false,
      )
    return [mk(1), mk(-1)]
  }, [from, to])
  return (
    <group>
      {geom.map((g, i) => (
        <mesh key={i} geometry={g} material={mats.trim} castShadow />
      ))}
    </group>
  )
}

/** Transom decoration: three mullioned windows, mouldings, a name board and the quarter badges. */
export function SternWindows({ mats }: { mats: BrigMaterials }) {
  const x = TRANSOM_X - 0.004
  const y = 0.42
  return (
    <group>
      {[-0.17, 0, 0.17].map((z) => (
        <group key={z} position={[x, y, z]}>
          <mesh material={mats.window} rotation-y={-Math.PI / 2}>
            <planeGeometry args={[0.11, 0.09]} />
          </mesh>
          <mesh material={mats.accent} position={[-0.004, 0, 0]}>
            <boxGeometry args={[0.008, 0.1, 0.12]} />
          </mesh>
          <mesh material={mats.window} position={[-0.0085, 0, 0]} rotation-y={-Math.PI / 2}>
            <planeGeometry args={[0.1, 0.085]} />
          </mesh>
        </group>
      ))}
      {/* mouldings above and below the windows */}
      {[y + 0.07, y - 0.07].map((yy) => (
        <mesh key={yy} material={mats.trim} position={[x - 0.006, yy, 0]}>
          <boxGeometry args={[0.014, 0.018, 0.56]} />
        </mesh>
      ))}
      <mesh material={mats.accent} position={[x - 0.008, y + 0.11, 0]}>
        <boxGeometry args={[0.012, 0.035, 0.3]} />
      </mesh>
      {[0.3, -0.3].map((z) => (
        <mesh key={z} material={mats.accent} position={[x - 0.006, y, z]}>
          <boxGeometry args={[0.012, 0.16, 0.025]} />
        </mesh>
      ))}
    </group>
  )
}

/** Stern / deck lantern: brass cage with glass and a warm glow. */
export function BrigLantern({ position, mats, lit = true, scale = 1 }: { position: Vec3; mats: BrigMaterials; lit?: boolean; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh material={mats.brass} position={[0, 0.0, 0]}>
        <cylinderGeometry args={[0.03, 0.034, 0.012, 8]} />
      </mesh>
      <mesh material={mats.brass} position={[0, 0.1, 0]}>
        <coneGeometry args={[0.038, 0.035, 8]} />
      </mesh>
      <mesh material={mats.brass} position={[0, 0.125, 0]}>
        <torusGeometry args={[0.012, 0.004, 5, 10]} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} material={mats.brass} position={[Math.cos((i * Math.PI) / 2 + Math.PI / 4) * 0.026, 0.047, Math.sin((i * Math.PI) / 2 + Math.PI / 4) * 0.026]}>
          <boxGeometry args={[0.006, 0.08, 0.006]} />
        </mesh>
      ))}
      <mesh material={mats.glass} position={[0, 0.047, 0]}>
        <cylinderGeometry args={[0.027, 0.027, 0.075, 8, 1, true]} />
      </mesh>
      {lit && (
        <mesh material={mats.lanternGlow} position={[0, 0.045, 0]}>
          <sphereGeometry args={[0.016, 8, 8]} />
        </mesh>
      )}
    </group>
  )
}

/** Horizontal windlass forward: octagonal barrel between two bitts, with turns of the anchor cable. */
export function Windlass({ position, mats, lod }: { position: Vec3; mats: BrigMaterials; lod: Lod }) {
  return (
    <group position={position}>
      {[-0.19, 0.19].map((z) => (
        <mesh key={z} material={mats.timber} position={[0, 0.09, z]} castShadow>
          <boxGeometry args={[0.05, 0.18, 0.05]} />
        </mesh>
      ))}
      <mesh material={mats.spar} position={[0, 0.12, 0]} rotation-x={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 0.36, 8]} />
      </mesh>
      {lod < 2 &&
        [-0.1, -0.06, 0.06, 0.1].map((z) => (
          <mesh key={z} material={mats.rope} position={[0, 0.12, z]}>
            <torusGeometry args={[0.038, 0.007, 5, 12]} />
          </mesh>
        ))}
      <mesh material={mats.iron} position={[0, 0.12, 0.15]}>
        <cylinderGeometry args={[0.045, 0.045, 0.02, 10]} />
      </mesh>
      {lod === 0 && (
        <mesh material={mats.spar} position={[0.18, 0.2, 0.15]} rotation-z={-0.9}>
          <cylinderGeometry args={[0.008, 0.008, 0.36, 5]} />
        </mesh>
      )}
    </group>
  )
}

/** Chainwale ledge on the hull side with deadeyes where the shrouds come down. */
export function Channel({ x, width, side, mats, deadeyes, lod }: { x: number; width: number; side: Side; mats: BrigMaterials; deadeyes: number; lod: Lod }) {
  const s = sgn(side)
  const y = sheerY(x) - 0.07
  const hw = hullHalfWidth(x, y)
  return (
    <group>
      <mesh material={mats.timber} position={[x, y, s * (hw + 0.03)]} castShadow>
        <boxGeometry args={[width, 0.018, 0.07]} />
      </mesh>
      {lod < 2 &&
        Array.from({ length: deadeyes }, (_, i) => {
          const dx = -width / 2 + (width * (i + 0.5)) / deadeyes
          return (
            <group key={i} position={[x + dx, y + 0.03, s * (hw + 0.055)]}>
              <mesh material={mats.timber} rotation-x={Math.PI / 2}>
                <cylinderGeometry args={[0.018, 0.018, 0.012, 8]} />
              </mesh>
              <mesh material={mats.iron} position={[0, -0.035, 0]}>
                <boxGeometry args={[0.008, 0.06, 0.006]} />
              </mesh>
            </group>
          )
        })}
    </group>
  )
}

/** Burn mark on the deck: a small grid draped over the cambered deck surface so the camber can't hide it. */
export function ScorchDecal({ position, radius, mats, seed, camber = DECK_CAMBER }: { position: Vec3; radius: number; mats: BrigMaterials; seed: number; camber?: number }) {
  const geom = useMemo(() => {
    const n = 8
    const rot = seededRandom(seed)() * Math.PI * 2
    const g = new THREE.PlaneGeometry(radius * 2, radius * 2, n, n)
    g.rotateX(-Math.PI / 2)
    g.rotateY(rot)
    const p = g.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const x = position[0] + p.getX(i)
      const z = position[2] + p.getZ(i)
      p.setY(i, deckSurfaceY(x, z, position[1], camber) - position[1] + 0.003)
    }
    p.needsUpdate = true
    g.computeVertexNormals()
    return g
  }, [position, radius, seed, camber])
  return <mesh geometry={geom} material={mats.scorch} position={[position[0], position[1], position[2]]} />
}

/**
 * Hull breach at an impact point: kit `HullHole` on the planking plus a ring of blackened splinters bursting
 * outward and a few deck splinters above.
 */
export function Breach({ x, side, mats, burning, seed, lod }: { x: number; side: Side; mats: BrigMaterials; burning: boolean; seed: number; lod: Lod }) {
  const s = sgn(side)
  const y = BREACH_Y
  const hw = hullHalfWidth(x, y)
  const splinters = useMemo(() => {
    const rnd = seededRandom(seed)
    return Array.from({ length: lod === 0 ? 9 : 5 }, (_, i) => {
      const a = (i / (lod === 0 ? 9 : 5)) * Math.PI * 2 + rnd() * 0.5
      const r = 0.1 + rnd() * 0.06
      return { dx: Math.cos(a) * r, dy: Math.sin(a) * r * 0.8, len: 0.05 + rnd() * 0.08, tilt: (rnd() - 0.5) * 1.2, roll: rnd() * Math.PI }
    })
  }, [seed, lod])
  return (
    <group position={[x, y, s * hw]}>
      <HullHole position={[0, 0, s * 0.003]} rotationY={s > 0 ? 0 : Math.PI} radius={0.13} />
      <mesh material={mats.spar} position={[0, 0, s * 0.002]} rotation-y={s > 0 ? 0 : Math.PI}>
        <ringGeometry args={[0.125, 0.15, 9]} />
      </mesh>
      <mesh material={mats.splinter} position={[0, 0, s * 0.0015]} rotation-y={s > 0 ? 0 : Math.PI}>
        <ringGeometry args={[0.145, 0.19, 9]} />
      </mesh>
      {splinters.map((sp, i) => (
        <mesh key={i} material={i % 3 === 0 ? mats.splinter : mats.spar} position={[sp.dx, sp.dy, s * 0.01]} rotation={[sp.tilt + (s > 0 ? Math.PI / 2 : -Math.PI / 2), 0, sp.roll]} castShadow>
          <coneGeometry args={[0.011, sp.len, 4]} />
        </mesh>
      ))}
      {burning && lod < 2 && (
        <group position={[0, DECK_Y - y + 0.01, -s * 0.12]}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} material={i === 1 ? mats.spar : mats.splinter} position={[i * 0.05 - 0.05, 0.03, (i % 2) * 0.03]} rotation={[0.4 * i, 0, 0.6 - 0.3 * i]}>
              <coneGeometry args={[0.012, 0.09, 4]} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  )
}
