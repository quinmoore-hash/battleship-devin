/**
 * Brigantine rig: cloth sails (square, gaff and jibs from four corners), merged rope sets (one draw call
 * for stays/shrouds/ratlines), the square-rigged foremast, the gaff-rigged mainmast, bowsprit with jibs and
 * the textured ensign. Masts snap (upper section pivots and falls) as `snapped` → 1 and sails shred with it.
 */
import { useFrame } from '@react-three/fiber'
import { ropeRadiusAtLod } from '../kit/Rope'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Vec3 } from '../../scene/layout'
import type { Lod } from '../types'
import type { BrigMaterials } from './materials'

const hash = (u: number) => {
  const s = Math.sin(u * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

export interface ClothProps {
  /** head-left, head-right, foot-right, foot-left. `set` compresses the cloth toward the head edge (v = 0). */
  corners: [Vec3, Vec3, Vec3, Vec3]
  /** Unit direction the belly bulges toward. */
  billow: Vec3
  set?: number
  torn?: number
  scorched?: boolean
  phase?: number
  mats: BrigMaterials
  segments?: number
  /** 1 normal, 0 reduced motion. */
  motion?: number
  /** Belly depth in metres at full set. */
  amp?: number
  shadows?: boolean
}

/** Bilinear quad of sailcloth, animated in useFrame without allocations. */
export function Cloth({ corners, billow, set = 1, torn = 0, scorched = false, phase = 0, mats, segments = 8, motion = 1, amp = 0.12, shadows = true }: ClothProps) {
  const ref = useRef<THREE.Mesh>(null)
  const key = corners.flat().join(',')
  const data = useMemo(() => {
    const geom = new THREE.PlaneGeometry(1, 1, segments, segments)
    const uv = geom.attributes.uv as THREE.BufferAttribute
    const count = uv.count
    const uvs = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      uvs[i * 2] = uv.getX(i)
      uvs[i * 2 + 1] = 1 - uv.getY(i) // v = 0 at the head
    }
    const [a, b, c, d] = corners
    return { geom, uvs, a, b, c, d, bil: new THREE.Vector3(...billow).normalize() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, segments])
  const setEff = 0.04 + 0.96 * Math.max(0, Math.min(1, set))
  const tornEff = Math.max(0, Math.min(1, torn))
  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const t = clock.getElapsedTime() * motion + phase
    const { geom, uvs, a, b, c, d, bil } = data
    const pos = geom.attributes.position as THREE.BufferAttribute
    const cut = 1 - tornEff * 0.85
    for (let i = 0; i < pos.count; i++) {
      const u = uvs[i * 2]
      let v = uvs[i * 2 + 1] * setEff
      if (tornEff > 0 && v > cut) {
        const strip = hash(Math.floor(u * 7) + 0.5)
        v = cut + (v - cut) * (0.1 + 0.6 * strip)
      }
      // bilinear
      const hx = a[0] + (b[0] - a[0]) * u
      const hy = a[1] + (b[1] - a[1]) * u
      const hz = a[2] + (b[2] - a[2]) * u
      const fx = d[0] + (c[0] - d[0]) * u
      const fy = d[1] + (c[1] - d[1]) * u
      const fz = d[2] + (c[2] - d[2]) * u
      const su = Math.sin(Math.PI * u)
      const sv = Math.sin(Math.PI * Math.min(1, v / Math.max(setEff, 0.04)))
      const belly = amp * setEff * su * Math.pow(sv, 0.75) * (1 - tornEff * 0.6)
      const ripple = motion * setEff * (0.012 * Math.sin(t * 2.3 + u * 5 + v * 3) + tornEff * 0.05 * Math.sin(t * 7 + u * 11 + v * 5))
      const w = belly + ripple
      pos.setXYZ(i, hx + (fx - hx) * v + bil.x * w, hy + (fy - hy) * v + bil.y * w, hz + (fz - hz) * v + bil.z * w)
    }
    pos.needsUpdate = true
    geom.computeVertexNormals()
  })
  return <mesh ref={ref} geometry={data.geom} material={scorched ? mats.sailScorched : mats.sail} castShadow={shadows} receiveShadow frustumCulled={false} />
}

export type RopeLine = [Vec3, Vec3, number?]

/** Cylinder between two points, 5 radial segments. */
function ropeGeometry(from: Vec3, to: Vec3, radius: number): THREE.BufferGeometry {
  const a = new THREE.Vector3(...from)
  const b = new THREE.Vector3(...to)
  const dir = b.clone().sub(a)
  const len = dir.length()
  const g = new THREE.CylinderGeometry(radius, radius, len, 5, 1, true)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize())
  g.applyQuaternion(q)
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
  return g
}

/** All lines merged into one geometry. */
export function buildRopeGeometry(lines: RopeLine[], radius = 0.009, lod: Lod = 0): THREE.BufferGeometry | null {
  const parts = lines.filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) > 1e-4).map(([a, b, r]) => ropeGeometry(a, b, ropeRadiusAtLod(r ?? radius, lod)))
  if (parts.length === 0) return null
  const merged = mergeGeometries(parts, false)
  parts.forEach((p) => p.dispose())
  return merged
}

export function RopeSet({ lines, mats, radius, lod = 0, visible = true }: { lines: RopeLine[]; mats: BrigMaterials; radius?: number; lod?: Lod; visible?: boolean }) {
  const key = lines.flat(2).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geom = useMemo(() => buildRopeGeometry(lines, radius, lod), [key, radius, lod])
  if (!geom) return null
  return <mesh geometry={geom} material={mats.rope} visible={visible} castShadow frustumCulled={false} />
}

/** Shroud pairs from rail chainplates up to a masthead, plus ratline rungs. */
export function shroudLines(bases: Vec3[], top: Vec3, rungs: number, rungTo = 0.78): RopeLine[] {
  const lines: RopeLine[] = []
  bases.forEach((b, i) => lines.push([b, [top[0] + (i - (bases.length - 1) / 2) * 0.012, top[1], top[2] + Math.sign(b[2]) * 0.03], 0.011]))
  for (let r = 1; r <= rungs; r++) {
    const t = (r / (rungs + 1)) * rungTo
    const pts = bases.map((b, i): Vec3 => {
      const tx = top[0] + (i - (bases.length - 1) / 2) * 0.012
      const tz = top[2] + Math.sign(b[2]) * 0.03
      return [b[0] + (tx - b[0]) * t, b[1] + (top[1] - b[1]) * t, b[2] + (tz - b[2]) * t]
    })
    for (let i = 0; i < pts.length - 1; i++) lines.push([pts[i], pts[i + 1], 0.005])
  }
  return lines
}

/** Tapered spar (yard / boom / gaff) centred on the origin along +y. */
function Spar({ length, radius, mats, position, rotation, tip = 0.5 }: { length: number; radius: number; mats: BrigMaterials; position: Vec3; rotation: [number, number, number]; tip?: number }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh material={mats.spar} position={[0, length / 4, 0]} castShadow>
        <cylinderGeometry args={[radius * tip, radius, length / 2, 8]} />
      </mesh>
      <mesh material={mats.spar} position={[0, -length / 4, 0]} castShadow>
        <cylinderGeometry args={[radius, radius * tip, length / 2, 8]} />
      </mesh>
      <mesh material={mats.iron} position={[0, 0, 0]}>
        <cylinderGeometry args={[radius * 1.25, radius * 1.25, 0.03, 8]} />
      </mesh>
    </group>
  )
}

function Bands({ ys, radius, mats }: { ys: number[]; radius: number; mats: BrigMaterials }) {
  return (
    <>
      {ys.map((y) => (
        <mesh key={y} material={mats.iron} position={[0, y, 0]}>
          <cylinderGeometry args={[radius * 1.12, radius * 1.12, 0.022, 10]} />
        </mesh>
      ))}
    </>
  )
}

/** Jagged splinter stub where a mast broke. */
function BreakStub({ y, radius, mats, up }: { y: number; radius: number; mats: BrigMaterials; up: boolean }) {
  return (
    <mesh material={mats.timber} position={[0, y + (up ? 0.04 : -0.04), 0]} rotation-x={up ? 0 : Math.PI}>
      <coneGeometry args={[radius * 1.05, 0.1, 5]} />
    </mesh>
  )
}

/** Furled bundle of canvas along a yard, shown when the sail is mostly furled. */
function Furl({ width, mats, set }: { width: number; mats: BrigMaterials; set: number }) {
  if (set > 0.45) return null
  const s = 1 - set / 0.45
  return (
    <mesh material={mats.sail} rotation-z={Math.PI / 2} position={[0.01, -0.03, 0]} scale={[s, 1, s]}>
      <cylinderGeometry args={[0.03, 0.03, width * 0.96, 8]} />
    </mesh>
  )
}

export interface MastProps {
  base: Vec3
  height: number
  sails: number
  snapped: number
  damaged: boolean
  phase: number
  lod: Lod
  mats: BrigMaterials
  motion: number
  shadows: boolean
}

export const FORE_BREAK = 0.32
export const MAIN_BREAK = 0.3

/** Square-rigged foremast: lower mast + top + topmast, course / topsail / topgallant yards and sails. */
export function ForeMast({ base, height, sails, snapped, damaged, phase, lod, mats, motion, shadows }: MastProps) {
  const lowerH = height * 0.6
  const breakY = height * FORE_BREAK
  const yards: { y: number; w: number; sail: [number, number] }[] = [
    { y: height * 0.4, w: 1.15, sail: [1.1, 0.42] },
    { y: height * 0.74, w: 0.9, sail: [0.86, height * 0.74 - height * 0.4 - 0.08] },
    { y: height * 0.93, w: 0.6, sail: [0.56, height * 0.93 - height * 0.74 - 0.06] },
  ]
  const torn = Math.max(damaged ? 0.55 : 0, snapped)
  const tilt = snapped
  const lower = (
    <>
      <mesh material={mats.timber} position={[0, breakY / 2, 0]} castShadow={shadows}>
        <cylinderGeometry args={[0.03, 0.036, breakY, 10]} />
      </mesh>
      {/* mast coat / partners */}
      <mesh material={mats.timber} position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.045, 0.07, 0.06, 10]} />
      </mesh>
      <Bands ys={[0.12, 0.26]} radius={0.034} mats={mats} />
      {snapped > 0.02 && <BreakStub y={breakY} radius={0.03} mats={mats} up />}
    </>
  )
  const upper = (
    <group position={[0, breakY, 0]} rotation={[tilt * 0.95, 0, tilt * 1.3]}>
      {snapped > 0.02 && <BreakStub y={0} radius={0.03} mats={mats} up={false} />}
      <mesh material={mats.timber} position={[0, (lowerH - breakY) / 2, 0]} castShadow={shadows}>
        <cylinderGeometry args={[0.024, 0.03, lowerH - breakY, 10]} />
      </mesh>
      <Bands ys={[height * 0.4 - breakY - 0.05, lowerH - breakY - 0.1]} radius={0.027} mats={mats} />
      {/* top platform with rim */}
      <group position={[0, lowerH - breakY, 0]}>
        <mesh material={mats.timber} castShadow={shadows}>
          <cylinderGeometry args={[0.1, 0.085, 0.022, 8]} />
        </mesh>
        {lod < 2 && (
          <mesh material={mats.timber} position={[0, 0.03, 0]}>
            <torusGeometry args={[0.095, 0.006, 5, 12]} />
          </mesh>
        )}
        {lod < 2 && (
          <mesh material={mats.timber} position={[0, -0.05, 0]} rotation-z={Math.PI / 2}>
            <boxGeometry args={[0.04, 0.22, 0.03]} />
          </mesh>
        )}
      </group>
      {/* topmast, doubled ahead of the lower masthead */}
      <mesh material={mats.timber} position={[0.035, lowerH - breakY - 0.18 + (height - lowerH + 0.18) / 2, 0]} castShadow={shadows}>
        <cylinderGeometry args={[0.011, 0.02, height - lowerH + 0.18, 8]} />
      </mesh>
      <mesh material={mats.timber} position={[0.035, height - breakY + 0.012, 0]}>
        <cylinderGeometry args={[0.025, 0.02, 0.022, 8]} />
      </mesh>
      {yards.map((yd, i) => {
        const yy = yd.y - breakY
        const mx = i === 0 ? 0 : 0.035
        const foot = yy - yd.sail[1]
        const headW = yd.sail[0]
        const footW = yd.sail[0] * (i === 0 ? 1.08 : 1.12)
        return (
          <group key={i} position={[mx + 0.03, yy, 0]}>
            <Spar length={yd.w} radius={i === 0 ? 0.02 : 0.015} mats={mats} position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]} />
            {lod < 1 && (
              <RopeSet
                mats={mats}
                radius={0.005}
                lod={lod}
                lines={[
                  [[0, -0.05, -yd.w / 2 + 0.05], [0, -0.09, -yd.w / 4]],
                  [[0, -0.09, -yd.w / 4], [0, -0.05, -0.02]],
                  [[0, -0.05, yd.w / 2 - 0.05], [0, -0.09, yd.w / 4]],
                  [[0, -0.09, yd.w / 4], [0, -0.05, 0.02]],
                  [[0, 0, -yd.w / 2], [-mx, i === 2 ? height - breakY - yy : yards[i + 1].y - yd.y - 0.05, 0]],
                  [[0, 0, yd.w / 2], [-mx, i === 2 ? height - breakY - yy : yards[i + 1].y - yd.y - 0.05, 0]],
                ]}
              />
            )}
            <Furl width={yd.w} mats={mats} set={sails} />
            <Cloth
              corners={[
                [0.02, -0.02, -headW / 2],
                [0.02, -0.02, headW / 2],
                [0.02, foot - yy + 0.02, footW / 2],
                [0.02, foot - yy + 0.02, -footW / 2],
              ]}
              billow={[1, 0, 0]}
              set={sails}
              torn={torn}
              scorched={damaged}
              phase={phase + i * 1.3}
              mats={mats}
              segments={lod === 0 ? 10 : 6}
              motion={motion}
              amp={0.16 - i * 0.03}
              shadows={shadows}
            />
          </group>
        )
      })}
    </group>
  )
  return (
    <group position={base}>
      {lower}
      {upper}
    </group>
  )
}

/** Where the main gaff sits for a given sail setting (jaws y, angle). */
export function gaffPose(height: number, set: number) {
  const lowerH = height * 0.64
  const jawsY = 0.42 + (lowerH - 0.06 - 0.42) * set
  const angle = 0.08 + 0.62 * set
  const length = 0.78
  const peak: Vec3 = [-Math.cos(angle) * length, jawsY + Math.sin(angle) * length, 0]
  return { jawsY, angle, length, peak, lowerH }
}

export const MAIN_BOOM_LENGTH = 1.06
export const MAIN_BOOM_Y = 0.3

/** Gaff-rigged mainmast: boom, gaff, big fore-and-aft mainsail, gaff topsail. */
export function MainMast({ base, height, sails, snapped, damaged, phase, lod, mats, motion, shadows }: MastProps) {
  const breakY = height * MAIN_BREAK
  const { jawsY, angle, length, peak, lowerH } = gaffPose(height, sails)
  const torn = Math.max(damaged ? 0.55 : 0, snapped)
  const tilt = snapped
  const boomEnd: Vec3 = [-MAIN_BOOM_LENGTH, MAIN_BOOM_Y, 0]
  const hoops = lod === 0 ? 7 : 0
  return (
    <group position={base}>
      <mesh material={mats.timber} position={[0, breakY / 2, 0]} castShadow={shadows}>
        <cylinderGeometry args={[0.032, 0.04, breakY, 10]} />
      </mesh>
      <mesh material={mats.timber} position={[0, 0.03, 0]}>
        <cylinderGeometry args={[0.05, 0.075, 0.06, 10]} />
      </mesh>
      <Bands ys={[0.12]} radius={0.038} mats={mats} />
      {/* boom with gooseneck, stays on the stump */}
      <mesh material={mats.iron} position={[0, MAIN_BOOM_Y, 0]}>
        <cylinderGeometry args={[0.045, 0.045, 0.03, 10]} />
      </mesh>
      <Spar length={MAIN_BOOM_LENGTH} radius={0.022} mats={mats} position={[-MAIN_BOOM_LENGTH / 2, MAIN_BOOM_Y, 0]} rotation={[0, 0, Math.PI / 2]} tip={0.6} />
      {snapped > 0.02 && <BreakStub y={breakY} radius={0.032} mats={mats} up />}
      {/* mainsail foot stays on the boom; only the upper part goes with the mast */}
      <group position={[0, breakY, 0]} rotation={[-tilt * 0.9, 0, tilt * 1.25]}>
        {snapped > 0.02 && <BreakStub y={0} radius={0.032} mats={mats} up={false} />}
        <mesh material={mats.timber} position={[0, (lowerH - breakY) / 2, 0]} castShadow={shadows}>
          <cylinderGeometry args={[0.026, 0.032, lowerH - breakY, 10]} />
        </mesh>
        <Bands ys={[lowerH - breakY - 0.12]} radius={0.029} mats={mats} />
        {/* crosstrees */}
        <group position={[0, lowerH - breakY, 0]}>
          <mesh material={mats.timber} castShadow={shadows}>
            <boxGeometry args={[0.08, 0.025, 0.26]} />
          </mesh>
          <mesh material={mats.timber} position={[0.03, -0.03, 0]} rotation-z={Math.PI / 2}>
            <boxGeometry args={[0.03, 0.16, 0.03]} />
          </mesh>
        </group>
        <mesh material={mats.timber} position={[0.035, lowerH - breakY - 0.2 + (height - lowerH + 0.2) / 2, 0]} castShadow={shadows}>
          <cylinderGeometry args={[0.011, 0.02, height - lowerH + 0.2, 8]} />
        </mesh>
        <mesh material={mats.timber} position={[0.035, height - breakY + 0.012, 0]}>
          <cylinderGeometry args={[0.028, 0.022, 0.022, 8]} />
        </mesh>
        {/* gaff with jaws */}
        <group position={[0, jawsY - breakY, 0]} rotation={[0, 0, Math.PI / 2 - angle]}>
          <Spar length={length} radius={0.016} mats={mats} position={[0, length / 2, 0]} rotation={[0, 0, 0]} tip={0.55} />
        </group>
        <mesh material={mats.timber} position={[-0.02, jawsY - breakY, 0]} rotation-y={Math.PI / 2}>
          <torusGeometry args={[0.04, 0.012, 6, 10, Math.PI]} />
        </mesh>
        {hoops > 0 &&
          Array.from({ length: hoops }, (_, i) => (
            <mesh key={i} material={mats.spar} position={[0, MAIN_BOOM_Y - breakY + ((jawsY - MAIN_BOOM_Y) * (i + 1)) / (hoops + 1), 0]} rotation-x={Math.PI / 2}>
              <torusGeometry args={[0.04, 0.006, 5, 12]} />
            </mesh>
          ))}
        {/* gaff topsail: foot along the gaff, apex at the topmast head */}
        <Cloth
          corners={[
            [0, jawsY - breakY + 0.03, 0],
            [peak[0] * 0.92, peak[1] - breakY + 0.03, 0],
            [0.035, height - breakY - 0.03, 0],
            [0.035, height - breakY - 0.03, 0],
          ]}
          billow={[0, 0, 1]}
          set={sails}
          torn={torn}
          scorched={damaged}
          phase={phase + 2.1}
          mats={mats}
          segments={lod === 0 ? 8 : 5}
          motion={motion}
          amp={0.07}
          shadows={shadows}
        />
        {/* mainsail: foot (boom) → head (gaff). Rendered in the upper group so it falls with the mast. */}
        <Cloth
          corners={[
            [-0.05, MAIN_BOOM_Y - breakY + 0.03, 0],
            [boomEnd[0] + 0.04, MAIN_BOOM_Y - breakY + 0.03, 0],
            [peak[0], peak[1] - breakY - 0.02, 0],
            [-0.045, jawsY - breakY, 0],
          ]}
          billow={[0, 0, 1]}
          set={1}
          torn={torn}
          scorched={damaged}
          phase={phase + 0.7}
          mats={mats}
          segments={lod === 0 ? 12 : 7}
          motion={motion}
          amp={0.14}
          shadows={shadows}
        />
      </group>
    </group>
  )
}

export interface EnsignProps {
  position: Vec3
  width?: number
  height?: number
  /** 0 flying … 1 dropped (sinking). */
  drop?: number
  dropTo?: Vec3
  phase?: number
  mats: BrigMaterials
  motion: number
}

/** Textured flag streaming aft (−x) from `position` (hoist top). */
export function Ensign({ position, width = 0.42, height = 0.27, drop = 0, dropTo, phase = 0, mats, motion }: EnsignProps) {
  const ref = useRef<THREE.Mesh>(null)
  const geom = useMemo(() => new THREE.PlaneGeometry(1, 1, 12, 5), [])
  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const t = clock.getElapsedTime() * 2.6 * motion + phase
    const pos = geom.attributes.position as THREE.BufferAttribute
    const uv = geom.attributes.uv as THREE.BufferAttribute
    const crumple = drop
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i)
      const v = uv.getY(i)
      const wave = Math.sin(t + u * 6.5) * 0.07 * u + Math.sin(t * 1.7 + u * 3 + v * 2) * 0.02 * u
      const sag = -u * u * 0.05 * (1 - motion * 0.5)
      pos.setXYZ(i, -u * width * (1 - crumple * 0.5), (v - 1) * height * (1 - crumple * 0.6) + sag + wave * crumple * 2, wave * (0.3 + motion * 0.7) + Math.sin(u * 9 + v * 7) * crumple * 0.05)
    }
    pos.needsUpdate = true
    geom.computeVertexNormals()
  })
  const p: Vec3 = dropTo ? [position[0] + (dropTo[0] - position[0]) * drop, position[1] + (dropTo[1] - position[1]) * drop, position[2] + (dropTo[2] - position[2]) * drop] : position
  return <mesh ref={ref} geometry={geom} material={mats.flag} position={p} castShadow frustumCulled={false} />
}

/** Long narrow pennant at a masthead, streaming aft. */
export function Pennant({ position, mats, motion, phase = 0 }: { position: Vec3; mats: BrigMaterials; motion: number; phase?: number }) {
  const ref = useRef<THREE.Mesh>(null)
  const geom = useMemo(() => new THREE.PlaneGeometry(1, 1, 10, 1), [])
  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const t = clock.getElapsedTime() * 3 * motion + phase
    const pos = geom.attributes.position as THREE.BufferAttribute
    const uv = geom.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const u = uv.getX(i)
      const v = uv.getY(i)
      pos.setXYZ(i, -u * 0.7, (v - 0.5) * 0.11 * (1 - u * 0.92) - u * u * 0.04, Math.sin(t + u * 7) * 0.08 * u)
    }
    pos.needsUpdate = true
  })
  return <mesh ref={ref} geometry={geom} material={mats.trim} position={position} frustumCulled={false} />
}
