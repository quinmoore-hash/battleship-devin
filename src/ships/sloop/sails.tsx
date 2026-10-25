/**
 * Fore-and-aft sails and the textured ensign for the Sloop. A `QuadSail` is defined by its four corners
 * (tack, clew, peak, throat — triangles repeat a corner); it billows to leeward, flutters in the wind,
 * folds along its luff as `set` → 0 and shreds (alphaTest over a tatter mask) and scorches as `torn` → 1.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { useGameStore } from '../../store/gameStore'
import type { SloopMaterials } from './materials'

export interface QuadSailProps {
  /** Corners in the ship frame: luff bottom (tack), foot aft (clew), head aft (peak), luff top (throat). */
  corners: [Vec3, Vec3, Vec3, Vec3]
  m: SloopMaterials
  /** 0 furled … 1 set. */
  set?: number
  /** 0 pristine … 1 shredded. */
  torn?: number
  /** 0 clean … 1 blackened. */
  scorch?: number
  /** Which way the belly bulges (+1 starboard, -1 port). */
  lee?: 1 | -1
  /** Belly depth as a fraction of the sail chord. */
  belly?: number
  phase?: number
  segments?: [number, number]
  castShadow?: boolean
}

export function QuadSail({ corners, m, set = 1, torn = 0, scorch = 0, lee = 1, belly = 0.14, phase = 0, segments = [10, 8], castShadow = true }: QuadSailProps) {
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const ref = useRef<THREE.Mesh>(null)
  const [nu, nv] = segments
  const geom = useMemo(() => new THREE.PlaneGeometry(1, 1, nu, nv), [nu, nv])
  const material = useMemo(() => m.sail.clone(), [m])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => () => geom.dispose(), [geom])
  const base = useMemo(() => new THREE.Color().copy(m.sail.color), [m])

  const tmp = useMemo(
    () => ({
      tack: new THREE.Vector3(),
      clew: new THREE.Vector3(),
      peak: new THREE.Vector3(),
      throat: new THREE.Vector3(),
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      p: new THREE.Vector3(),
      n: new THREE.Vector3(),
      chord: new THREE.Vector3(),
    }),
    [],
  )

  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const t = clock.getElapsedTime() + phase
    const { tack, clew, peak, throat, a, b, p, n, chord } = tmp
    tack.set(...corners[0])
    clew.set(...corners[1])
    peak.set(...corners[2])
    throat.set(...corners[3])
    // furling: the aft corners fold onto the luff (gaff lowered / hanks slid down)
    const fold = 1 - set
    clew.lerp(tack, fold * 0.92)
    peak.lerp(throat, fold * 0.92)
    throat.lerp(tack, fold * 0.85)
    peak.lerp(tack, fold * 0.85)
    chord.copy(clew).sub(tack)
    const chordLen = Math.max(0.05, chord.length())
    // leeward normal: perpendicular to the sail plane, pointing to `lee` side
    n.copy(peak).sub(tack).cross(chord).normalize()
    if (n.z * lee < 0) n.negate()
    const flutter = reducedMotion ? 0.25 : 1
    const pos = geom.attributes.position as THREE.BufferAttribute
    const uvs = geom.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const u = uvs.getX(i) // 0 luff → 1 leech
      const v = uvs.getY(i) // 0 foot → 1 head
      a.copy(tack).lerp(clew, u)
      b.copy(throat).lerp(peak, u)
      p.copy(a).lerp(b, v)
      const edge = Math.sin(u * Math.PI) * (0.55 + 0.45 * Math.sin(v * Math.PI))
      const bulge = belly * chordLen * set * edge
      const wave = flutter * set * chordLen * (0.012 * Math.sin(t * 2.3 + u * 6 + v * 2) + 0.006 * Math.sin(t * 5.1 - u * 11 + v * 7) * u)
      const sag = torn * 0.08 * chordLen * u * (1 - v) * Math.sin(t * 3 + u * 9)
      p.addScaledVector(n, bulge + wave + sag)
      pos.setXYZ(i, p.x, p.y, p.z)
    }
    pos.needsUpdate = true
    geom.computeVertexNormals()
    geom.computeBoundingSphere()
    material.alphaTest = torn <= 0 ? 0.001 : Math.min(0.9, 0.05 + torn * 0.78)
    material.color.copy(base).lerp(SCORCH, Math.min(0.9, scorch * 0.7 + torn * 0.25))
    mesh.visible = set > 0.03 && torn < 0.995
  })

  return <mesh ref={ref} geometry={geom} material={material} castShadow={castShadow} receiveShadow frustumCulled={false} />
}

const SCORCH = new THREE.Color('#141008')

export interface EnsignProps {
  /** Hoist point (top of the halyard). The flag streams toward -x. */
  position: Vec3
  m: SloopMaterials
  width?: number
  height?: number
  phase?: number
  /** 0 flying … 1 struck/dropped. */
  drop?: number
}

/** Textured ensign (Jolly Roger / Red Ensign) streaming astern from the masthead. */
export function Ensign({ position, m, width = 0.42, height = 0.26, phase = 0, drop = 0 }: EnsignProps) {
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const ref = useRef<THREE.Mesh>(null)
  const geom = useMemo(() => {
    const g = new THREE.PlaneGeometry(width, height, 12, 4)
    g.translate(-width / 2, -height / 2, 0)
    return g
  }, [width, height])
  useEffect(() => () => geom.dispose(), [geom])
  useFrame(({ clock }) => {
    const mesh = ref.current
    if (!mesh) return
    const t = clock.getElapsedTime() * (reducedMotion ? 1.2 : 3) + phase
    const pos = geom.attributes.position as THREE.BufferAttribute
    const uv = geom.attributes.uv as THREE.BufferAttribute
    for (let i = 0; i < pos.count; i++) {
      const k = 1 - uv.getX(i) // 0 at the hoist
      const v = uv.getY(i)
      const z = Math.sin(t + k * 5.5) * 0.09 * k + Math.sin(t * 1.7 + k * 9 + v * 3) * 0.02 * k
      const y = -height / 2 + (v - 0.5) * height * (1 - drop * 0.6) - k * drop * 0.6 - k * 0.03
      pos.setXYZ(i, -k * width * (1 - drop * 0.3), y, z)
    }
    pos.needsUpdate = true
    geom.computeVertexNormals()
    mesh.visible = drop < 0.95
  })
  return <mesh ref={ref} geometry={geom} material={m.flag} position={position} castShadow frustumCulled={false} />
}
