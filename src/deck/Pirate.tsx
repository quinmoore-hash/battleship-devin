/**
 * The player's pirate — a low-poly figure (~130 triangles, 2 draw calls) for the Third-person seat, reusable by the
 * crew module for deck hands:
 *
 *   const gait = useRef(createGait())            // mutate per frame: speed (u/s), airborne height, tumble 0..1
 *   <Pirate ref={groupRef} livery="pirate" gait={gait} />
 *
 * The owner places the group (feet at the origin, facing −z like the camera's yaw 0) and drives `gait`; the figure
 * animates its limbs from it in `useFrame` without allocating. Body + hat are one merged vertex-coloured mesh, the four
 * limbs one `InstancedMesh`.
 */
import { useFrame } from '@react-three/fiber'
import { forwardRef, useEffect, useMemo, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Livery } from '../ships/types'

/** Height of the figure, feet to crown (the deck contract's sailor is 0.17 u). */
export const PIRATE_HEIGHT = 0.17

export interface PirateGait {
  /** Horizontal speed, u/s (0 = idle). */
  speed: number
  /** Feet height above the deck while jumping (0 = grounded). */
  height: number
  /** 0..1 tumble (thrown overboard / abandon ship): the figure folds up and spins. */
  tumble: number
  /** Internal stride clock. */
  phase: number
}

export const createGait = (): PirateGait => ({ speed: 0, height: 0, tumble: 0, phase: 0 })

const LEG_H = 0.065
const TORSO_H = 0.06
const HEAD_R = 0.02
const SHOULDER_Y = LEG_H + TORSO_H - 0.005
const ARM_L = 0.055

const PALETTE: Record<Livery, { coat: number; sash: number; trousers: number; hat: number }> = {
  pirate: { coat: 0x3a1f1a, sash: 0xb3262e, trousers: 0x2b2b30, hat: 0x17120f },
  navy: { coat: 0x1f3561, sash: 0xd9a441, trousers: 0xe9e2cf, hat: 0x1a2238 },
}

function colored(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex)
  const n = g.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return g
}

/** Torso, sash, head, hat and nose as one geometry (vertex colours). */
function bodyGeometry(livery: Livery): THREE.BufferGeometry {
  const p = PALETTE[livery]
  const parts: THREE.BufferGeometry[] = []
  const torso = colored(new THREE.BoxGeometry(0.05, TORSO_H, 0.03), p.coat)
  torso.translate(0, LEG_H + TORSO_H / 2, 0)
  parts.push(torso)
  const sash = colored(new THREE.BoxGeometry(0.054, 0.012, 0.034), p.sash)
  sash.translate(0, LEG_H + 0.012, 0)
  parts.push(sash)
  const head = colored(new THREE.SphereGeometry(HEAD_R, 6, 4), 0xd9a97a)
  head.translate(0, LEG_H + TORSO_H + HEAD_R, 0)
  parts.push(head)
  const hat = colored(new THREE.CylinderGeometry(0.012, 0.03, 0.022, 7), p.hat)
  hat.translate(0, LEG_H + TORSO_H + HEAD_R * 1.7, 0)
  parts.push(hat)
  const nose = colored(new THREE.BoxGeometry(0.006, 0.006, 0.008), 0xc48d62)
  nose.translate(0, LEG_H + TORSO_H + HEAD_R, -HEAD_R)
  parts.push(nose)
  const merged = mergeGeometries(parts, false)
  for (const g of parts) g.dispose()
  return merged ?? torso
}

const tmpM = new THREE.Matrix4()
const tmpQ = new THREE.Quaternion()
const tmpE = new THREE.Euler()
const tmpP = new THREE.Vector3()
const tmpS = new THREE.Vector3(1, 1, 1)

export const Pirate = forwardRef<THREE.Group, { livery: Livery; gait: RefObject<PirateGait> }>(function Pirate({ livery, gait }, ref) {
  const limbs = useRef<THREE.InstancedMesh>(null)
  const body = useRef<THREE.Mesh>(null)
  const geometry = useMemo(() => bodyGeometry(livery), [livery])
  const limbGeometry = useMemo(() => new THREE.BoxGeometry(0.016, 1, 0.016).translate(0, -0.5, 0), [])
  const bodyMaterial = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }), [])
  const limbMaterial = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(
    () => () => {
      limbGeometry.dispose()
      bodyMaterial.dispose()
      limbMaterial.dispose()
    },
    [limbGeometry, bodyMaterial, limbMaterial],
  )
  useEffect(() => {
    const m = limbs.current
    if (!m) return
    const p = PALETTE[livery]
    const c = new THREE.Color()
    m.setColorAt(0, c.setHex(p.trousers))
    m.setColorAt(1, c.setHex(p.trousers))
    m.setColorAt(2, c.setHex(p.coat))
    m.setColorAt(3, c.setHex(p.coat))
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }, [livery])

  useFrame((_, delta) => {
    const m = limbs.current
    const g = gait.current
    if (!m || !g) return
    const dt = Math.min(delta, 0.05)
    const run = Math.min(1, g.speed / 1.0)
    // stride frequency follows speed; idle breathes slowly
    g.phase += dt * (g.speed > 0.02 ? 6 + run * 6 : 1.2)
    const swing = g.speed > 0.02 ? Math.sin(g.phase) * (0.45 + run * 0.4) : 0
    const idle = g.speed > 0.02 ? 0 : Math.sin(g.phase) * 0.04
    const air = g.height > 0.005 ? 1 : 0
    const tumble = g.tumble
    // legs: hips at LEG_H; arms: shoulders. In the air the legs tuck and the arms rise.
    const legA = air ? 0.5 : swing
    const legB = air ? -0.2 : -swing
    const armA = air ? -1.6 : -swing * 0.9 + idle
    const armB = air ? -1.4 : swing * 0.9 - idle
    const fold = tumble * 1.2
    const limb = (i: number, x: number, y: number, len: number, angle: number) => {
      tmpQ.setFromEuler(tmpE.set(angle + fold, 0, 0))
      tmpM.compose(tmpP.set(x, y, 0), tmpQ, tmpS.set(1, len, 1))
      m.setMatrixAt(i, tmpM)
    }
    limb(0, -0.012, LEG_H, LEG_H, legA)
    limb(1, 0.012, LEG_H, LEG_H, legB)
    limb(2, -0.033, SHOULDER_Y, ARM_L, armA)
    limb(3, 0.033, SHOULDER_Y, ARM_L, armB)
    m.instanceMatrix.needsUpdate = true
    const b = body.current
    if (b) {
      // a little bob while walking, a fold when tumbling
      b.position.y = g.speed > 0.02 ? Math.abs(Math.sin(g.phase)) * 0.004 : 0
      b.rotation.x = fold * 0.6
    }
  })

  return (
    <group ref={ref}>
      <mesh ref={body} geometry={geometry} material={bodyMaterial} castShadow />
      <instancedMesh ref={limbs} args={[limbGeometry, limbMaterial, 4]} frustumCulled={false} castShadow />
    </group>
  )
})
