/**
 * Where the guns are: a brass ring on the deck at every usable station and a pulsing glow over its breech. Two
 * `InstancedMesh`es (2 draw calls for the whole ship), updated in place each frame — no allocation. The ring and glow
 * of the picked gun (`near`, the controller's hysteresis pick) burn brighter. Rendered in ship space inside the
 * controller's ship group. Close to the eye the markers shrink and the glow fades out (`markerFade`), the glow's
 * on-screen size is capped (`glowScaleCap`) and the manned gun's marker is hidden — a marker a hand's width from the eye
 * used to be a solid blob (BUG-7xx).
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../scene/layout'
import { GLOW_RADIUS, glowScaleCap, markerFade, type Station } from './math'

export const RING_RADIUS = 0.085
const MAX_STATIONS = 16
/** The glow floats this far over the breech. */
export const GLOW_LIFT = 0.05

const BRASS = new THREE.Color('#e3b655')
const BRASS_HOT = new THREE.Color('#fff0b0')

const tmpM = new THREE.Matrix4()
const tmpP = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpS = new THREE.Vector3()
const tmpC = new THREE.Color()
const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))

export interface GunMarkersProps {
  stations: readonly (Station & { usable: boolean })[]
  /** `Station.index` of the picked (hot) station, −1 for none. */
  near: { current: number }
  /** `Station.index` of the manned station, −1 for none: its marker is hidden. */
  manned: { current: number }
  /** The eye in ship space (the controller's `eye.position`), for the near-eye fade. */
  eye: { position: Vec3 }
}

export function GunMarkers({ stations, near, manned, eye }: GunMarkersProps) {
  const rings = useRef<THREE.InstancedMesh>(null)
  const glows = useRef<THREE.InstancedMesh>(null)
  const usable = useMemo(() => stations.filter((s) => s.onDeck && s.usable).slice(0, MAX_STATIONS), [stations])
  const ringGeometry = useMemo(() => new THREE.RingGeometry(RING_RADIUS * 0.72, RING_RADIUS, 20, 1), [])
  const glowGeometry = useMemo(() => new THREE.IcosahedronGeometry(GLOW_RADIUS, 0), [])
  const ringMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), [])
  const glowMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }), [])
  useEffect(
    () => () => {
      ringGeometry.dispose()
      glowGeometry.dispose()
      ringMaterial.dispose()
      glowMaterial.dispose()
    },
    [ringGeometry, glowGeometry, ringMaterial, glowMaterial],
  )

  useFrame(({ clock }) => {
    const r = rings.current
    const g = glows.current
    if (!r || !g) return
    const t = clock.elapsedTime
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2)
    const nearIndex = near.current
    const mannedIndex = manned.current
    const [ex, ey, ez] = eye.position
    for (let i = 0; i < usable.length; i++) {
      const s = usable[i]
      const hot = s.index === nearIndex
      const hidden = s.index === mannedIndex
      const ringFade = hidden ? 0 : markerFade(Math.hypot(s.stand[0] - ex, s.stand[1] - ey, s.stand[2] - ez))
      const scale = (hot ? 1.1 + pulse * 0.15 : 0.95 + pulse * 0.1) * ringFade
      tmpM.compose(tmpP.set(s.stand[0], s.stand[1] + 0.006, s.stand[2]), flat, tmpS.set(scale, scale, 1))
      r.setMatrixAt(i, tmpM)
      const gy = s.breech[1] + GLOW_LIFT
      const dGlow = Math.hypot(s.breech[0] - ex, gy - ey, s.breech[2] - ez)
      const glowFade = hidden ? 0 : markerFade(dGlow)
      const gs = Math.min((hot ? 1.3 : 0.9) + pulse * 0.35, glowScaleCap(dGlow)) * glowFade
      tmpM.compose(tmpP.set(s.breech[0], gy, s.breech[2]), tmpQ.identity(), tmpS.set(gs, gs, gs))
      g.setMatrixAt(i, tmpM)
      const c = hot ? BRASS_HOT : BRASS
      r.setColorAt(i, c)
      // additive glow: scaling the colour toward black is its opacity
      g.setColorAt(i, tmpC.copy(c).multiplyScalar(glowFade))
    }
    r.count = usable.length
    g.count = usable.length
    r.instanceMatrix.needsUpdate = true
    g.instanceMatrix.needsUpdate = true
    if (r.instanceColor) r.instanceColor.needsUpdate = true
    if (g.instanceColor) g.instanceColor.needsUpdate = true
  })

  if (usable.length === 0) return null
  return (
    <>
      <instancedMesh ref={rings} args={[ringGeometry, ringMaterial, MAX_STATIONS]} frustumCulled={false} renderOrder={2} />
      <instancedMesh ref={glows} args={[glowGeometry, glowMaterial, MAX_STATIONS]} frustumCulled={false} renderOrder={3} />
    </>
  )
}
