/**
 * Where the guns are: a brass ring on the deck at every usable station and a pulsing glow over its breech. Two
 * `InstancedMesh`es (2 draw calls for the whole ship), updated in place each frame — no allocation. The ring and glow
 * of the gun within reach burn brighter. Rendered in ship space inside the controller's ship group.
 */
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Station } from './math'

export const RING_RADIUS = 0.085
const MAX_STATIONS = 16

const BRASS = new THREE.Color('#e3b655')
const BRASS_HOT = new THREE.Color('#fff0b0')

const tmpM = new THREE.Matrix4()
const tmpP = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()
const tmpS = new THREE.Vector3()
const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))

export function GunMarkers({ stations, near }: { stations: readonly (Station & { usable: boolean })[]; near: { current: number } }) {
  const rings = useRef<THREE.InstancedMesh>(null)
  const glows = useRef<THREE.InstancedMesh>(null)
  const usable = useMemo(() => stations.filter((s) => s.onDeck && s.usable).slice(0, MAX_STATIONS), [stations])
  const ringGeometry = useMemo(() => new THREE.RingGeometry(RING_RADIUS * 0.72, RING_RADIUS, 20, 1), [])
  const glowGeometry = useMemo(() => new THREE.IcosahedronGeometry(0.018, 0), [])
  const ringMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }), [])
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
  const lastNear = useRef(-2)

  useFrame(({ clock }) => {
    const r = rings.current
    const g = glows.current
    if (!r || !g) return
    const t = clock.elapsedTime
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2)
    const nearIndex = near.current
    for (let i = 0; i < usable.length; i++) {
      const s = usable[i]
      const hot = s.index === nearIndex
      const scale = hot ? 1.1 + pulse * 0.15 : 0.95 + pulse * 0.1
      tmpM.compose(tmpP.set(s.stand[0], s.stand[1] + 0.006, s.stand[2]), flat, tmpS.set(scale, scale, 1))
      r.setMatrixAt(i, tmpM)
      const gs = (hot ? 1.3 : 0.9) + pulse * 0.35
      tmpM.compose(tmpP.set(s.breech[0], s.breech[1] + 0.05, s.breech[2]), tmpQ.identity(), tmpS.set(gs, gs, gs))
      g.setMatrixAt(i, tmpM)
    }
    r.count = usable.length
    g.count = usable.length
    r.instanceMatrix.needsUpdate = true
    g.instanceMatrix.needsUpdate = true
    if (lastNear.current !== nearIndex) {
      lastNear.current = nearIndex
      for (let i = 0; i < usable.length; i++) {
        const c = usable[i].index === nearIndex ? BRASS_HOT : BRASS
        r.setColorAt(i, c)
        g.setColorAt(i, c)
      }
      if (r.instanceColor) r.instanceColor.needsUpdate = true
      if (g.instanceColor) g.instanceColor.needsUpdate = true
    }
  })

  useEffect(() => {
    lastNear.current = -2
  }, [usable])

  if (usable.length === 0) return null
  return (
    <>
      <instancedMesh ref={rings} args={[ringGeometry, ringMaterial, MAX_STATIONS]} frustumCulled={false} renderOrder={2} />
      <instancedMesh ref={glows} args={[glowGeometry, glowMaterial, MAX_STATIONS]} frustumCulled={false} renderOrder={3} />
    </>
  )
}
