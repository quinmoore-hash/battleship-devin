import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { ShotResult } from '../../engine'
import { BOARD_LAYOUT, type Vec3 } from '../../scene/layout'
import { sampleWaveHeight, sampleWaveNormal } from '../../scene/waves'
import { Fire } from '../damage/Fire'
import { Smoke } from '../damage/Smoke'
import { useReducedMotion } from '../damage/useReducedMotion'
import { layoutMarkers, popScale, rippleAt, wreckScatter, type MarkerPlacement } from './layout'

export interface ShotMarkersProps {
  shots: readonly ShotResult[]
  boardOrigin?: Vec3
  cellSize?: number
  /** Fires on fresh hit markers (default true). */
  fires?: boolean
}

const tmpObj = new THREE.Object3D()
const tmpColor = new THREE.Color()
const tmpQ = new THREE.Quaternion()
const tmpUp = new THREE.Vector3(0, 1, 0)
const tmpN = new THREE.Vector3()
const CAP = 128
const PLANKS_PER = 6
const WOOD = new THREE.Color('#9a6a3a')

/** Buoy parts share one instance matrix, so each geometry is pre-offset to its place on the buoy. */
let buoyGeoms: { hull: THREE.BufferGeometry; cone: THREE.BufferGeometry; band: THREE.BufferGeometry; pole: THREE.BufferGeometry; top: THREE.BufferGeometry } | null = null
function buoyGeometry() {
  if (buoyGeoms) return buoyGeoms
  const hull = new THREE.SphereGeometry(0.32, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62)
  const cone = new THREE.ConeGeometry(0.2, 0.42, 14).translate(0, 0.38, 0)
  const band = new THREE.TorusGeometry(0.33, 0.035, 8, 24).rotateX(Math.PI / 2).translate(0, 0.02, 0)
  const pole = new THREE.CylinderGeometry(0.02, 0.025, 0.7, 6).translate(0, 0.85, 0)
  const top = new THREE.SphereGeometry(0.06, 8, 6).translate(0, 1.2, 0)
  buoyGeoms = { hull, cone, band, pole, top }
  return buoyGeoms
}
const CHARRED = new THREE.Color('#15100b')

let foamTex: THREE.CanvasTexture | null = null
function foamTexture(): THREE.CanvasTexture {
  if (foamTex) return foamTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,0.0)')
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.75, 'rgba(230,245,255,0.25)')
  g.addColorStop(1, 'rgba(230,245,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  ctx.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 40; i++) {
    const a = (i * 2.399) % (Math.PI * 2)
    const r = 20 + ((i * 37) % 40)
    ctx.beginPath()
    ctx.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, 3 + (i % 5), 0, Math.PI * 2)
    ctx.fill()
  }
  foamTex = new THREE.CanvasTexture(c)
  foamTex.colorSpace = THREE.SRGBColorSpace
  return foamTex
}

const bob = (m: MarkerPlacement, t: number) => sampleWaveHeight(m.position[0], m.position[2], t) + Math.sin(t * 1.3 + m.seed) * 0.012

function setTilt(x: number, z: number, t: number) {
  const n = sampleWaveNormal(x, z, t)
  tmpN.set(n[0], n[1], n[2])
  tmpQ.setFromUnitVectors(tmpUp, tmpN)
}

/**
 * Every shot on the water: misses are bobbing white-and-red buoys in a foam ring, hits are a raft of
 * burning wreckage, sunk cells are charred debris. The newest marker pops in and sends out a ripple.
 * Buoys, planks and foam are instanced (a handful of draw calls for a whole board).
 */
export function ShotMarkers({ shots, boardOrigin = BOARD_LAYOUT.enemy.origin, cellSize = 1, fires = true }: ShotMarkersProps) {
  const reduced = useReducedMotion()
  const markers = useMemo(() => layoutMarkers(shots, boardOrigin, cellSize), [shots, boardOrigin, cellSize])
  const misses = useMemo(() => markers.filter((m) => m.kind === 'miss'), [markers])
  const wrecks = useMemo(() => markers.filter((m) => m.kind !== 'miss'), [markers])
  const scatter = useMemo(
    () => new Map(wrecks.map((m) => [m.key, wreckScatter(m.seed, PLANKS_PER, cellSize, m.kind === 'sunk' ? 0.85 : 0.35)])),
    [wrecks, cellSize],
  )
  const newest = markers.find((m) => m.newest) ?? null
  const newestKey = newest?.key ?? null
  const intro = useRef<{ key: string | null; start: number }>({ key: null, start: -10 })

  const hull = useRef<THREE.InstancedMesh>(null)
  const cone = useRef<THREE.InstancedMesh>(null)
  const band = useRef<THREE.InstancedMesh>(null)
  const pole = useRef<THREE.InstancedMesh>(null)
  const top = useRef<THREE.InstancedMesh>(null)
  const geo = buoyGeometry()
  const foam = useRef<THREE.InstancedMesh>(null)
  const planks = useRef<THREE.InstancedMesh>(null)
  const barrels = useRef<THREE.InstancedMesh>(null)
  const ripple = useRef<THREE.Mesh>(null)
  const rippleMat = useRef<THREE.MeshBasicMaterial>(null)
  const colorsSet = useRef('')

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (intro.current.key !== newestKey) intro.current = { key: newestKey, start: t }
    const age = t - intro.current.start
    const popOf = (m: MarkerPlacement) => (m.key === newestKey ? (reduced ? 1 : popScale(age)) : 1)

    const y0 = boardOrigin[1]
    // ---- buoys (misses)
    const h = hull.current
    const c = cone.current
    const b = band.current
    const p = pole.current
    const f = foam.current
    const tp = top.current
    if (h && c && b && p && f && tp) {
      const n = Math.min(misses.length, CAP)
      for (let i = 0; i < n; i++) {
        const m = misses[i]
        const s = cellSize * 0.5 * popOf(m)
        const y = y0 + bob(m, t)
        setTilt(m.position[0], m.position[2], t)
        tmpObj.position.set(m.position[0], y, m.position[2])
        tmpObj.quaternion.copy(tmpQ)
        tmpObj.rotateY(m.seed % 6)
        tmpObj.scale.setScalar(s)
        tmpObj.updateMatrix()
        h.setMatrixAt(i, tmpObj.matrix)
        c.setMatrixAt(i, tmpObj.matrix)
        b.setMatrixAt(i, tmpObj.matrix)
        p.setMatrixAt(i, tmpObj.matrix)
        tp.setMatrixAt(i, tmpObj.matrix)
        tmpObj.quaternion.identity()
        tmpObj.rotation.set(-Math.PI / 2, 0, t * 0.08 + m.seed)
        tmpObj.position.y = y0 + 0.015 + sampleWaveHeight(m.position[0], m.position[2], t)
        tmpObj.scale.setScalar(cellSize * 0.95 * popOf(m))
        tmpObj.updateMatrix()
        f.setMatrixAt(i, tmpObj.matrix)
      }
      h.count = c.count = b.count = p.count = f.count = tp.count = n
      h.instanceMatrix.needsUpdate = c.instanceMatrix.needsUpdate = b.instanceMatrix.needsUpdate = p.instanceMatrix.needsUpdate = f.instanceMatrix.needsUpdate = tp.instanceMatrix.needsUpdate = true
    }
    // ---- wreck planks (hits + sunk) and barrels (sunk)
    const pl = planks.current
    const br = barrels.current
    if (pl && br) {
      const sig = wrecks.map((w) => w.key + w.kind).join('|')
      const recolor = colorsSet.current !== sig
      let k = 0
      let bk = 0
      for (const m of wrecks) {
        const pieces = scatter.get(m.key)!
        const pop = popOf(m)
        const base = y0 + bob(m, t)
        for (let j = 0; j < pieces.length && k < CAP * PLANKS_PER; j++, k++) {
          const q = pieces[j]
          const wy = base + Math.sin(t * 1.7 + q.phase) * 0.01
          tmpObj.position.set(m.position[0] + q.x * pop, wy, m.position[2] + q.z * pop)
          tmpObj.rotation.set(Math.sin(t * 1.1 + q.phase) * 0.08, q.rotY, Math.cos(t * 0.9 + q.phase) * 0.1)
          tmpObj.scale.set(q.size[0] * pop, q.size[2], q.size[1] * pop)
          tmpObj.updateMatrix()
          pl.setMatrixAt(k, tmpObj.matrix)
          if (recolor) {
            tmpColor.copy(WOOD).lerp(CHARRED, q.char)
            pl.setColorAt(k, tmpColor)
          }
        }
        if (m.kind === 'sunk' && bk < CAP) {
          tmpObj.position.set(m.position[0] - 0.18 * cellSize, base + 0.04, m.position[2] + 0.12 * cellSize)
          tmpObj.rotation.set(Math.PI / 2 + Math.sin(t + m.seed) * 0.05, 0, m.seed % 3)
          tmpObj.scale.setScalar(cellSize * 0.16 * pop)
          tmpObj.updateMatrix()
          br.setMatrixAt(bk++, tmpObj.matrix)
        }
      }
      pl.count = k
      br.count = bk
      pl.instanceMatrix.needsUpdate = true
      br.instanceMatrix.needsUpdate = true
      if (recolor && pl.instanceColor) {
        pl.instanceColor.needsUpdate = true
        colorsSet.current = sig
      }
    }
    // ---- ripple under the newest marker
    const r = ripple.current
    const rm = rippleMat.current
    if (r && rm) {
      if (newest && !reduced) {
        const [rad, op] = rippleAt(age, cellSize * 0.9)
        r.visible = op > 0
        r.position.set(newest.position[0], y0 + 0.02 + bob(newest, t), newest.position[2])
        r.scale.setScalar(Math.max(0.001, rad))
        rm.opacity = op * 0.8
      } else r.visible = false
    }
  })

  return (
    <group>
      {/* buoy: white float dome, white cone, red waterline band, pole with a red top */}
      <instancedMesh ref={hull} args={[geo.hull, undefined, CAP]} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#f2eee4" roughness={0.45} />
      </instancedMesh>
      <instancedMesh ref={cone} args={[geo.cone, undefined, CAP]} castShadow frustumCulled={false}>
        <meshStandardMaterial color="#f6f2ea" roughness={0.45} />
      </instancedMesh>
      <instancedMesh ref={band} args={[geo.band, undefined, CAP]} frustumCulled={false}>
        <meshStandardMaterial color="#c42b1c" roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={pole} args={[geo.pole, undefined, CAP]} frustumCulled={false}>
        <meshStandardMaterial color="#3b2a18" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={top} args={[geo.top, undefined, CAP]} frustumCulled={false}>
        <meshStandardMaterial color="#d8321c" roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={foam} args={[undefined, undefined, CAP]} frustumCulled={false} renderOrder={4}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={foamTexture()} transparent depthWrite={false} opacity={0.75} />
      </instancedMesh>
      {/* wreckage */}
      <instancedMesh ref={planks} args={[undefined, undefined, CAP * PLANKS_PER]} castShadow frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffffff" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={barrels} args={[undefined, undefined, CAP]} castShadow frustumCulled={false}>
        <cylinderGeometry args={[0.8, 0.8, 1.6, 10]} />
        <meshStandardMaterial color="#5a3d22" roughness={0.85} />
      </instancedMesh>
      <mesh ref={ripple} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5} visible={false}>
        <ringGeometry args={[0.82, 1, 48]} />
        <meshBasicMaterial ref={rippleMat} color="#eaf8ff" transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      {wrecks.map((m) =>
        m.kind === 'hit' ? (
          <group key={m.key}>
            {fires && <Fire position={[m.position[0], m.position[1] + 0.05, m.position[2]]} seed={m.seed} scale={cellSize * 0.45} />}
            <Smoke position={[m.position[0], m.position[1] + 0.1, m.position[2]]} seed={m.seed + 3} scale={cellSize * 0.5} count={reduced ? 5 : 8} />
          </group>
        ) : (
          <Smoke key={m.key} position={[m.position[0], m.position[1] + 0.05, m.position[2]]} seed={m.seed + 3} scale={cellSize * 0.35} count={reduced ? 3 : 5} intensity={0.45} color="#5a5651" />
        ),
      )}
    </group>
  )
}
