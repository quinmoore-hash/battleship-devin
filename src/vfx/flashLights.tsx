import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

/**
 * A fixed pool of point lights for short flashes (muzzle blasts, impacts). three recompiles every
 * shader program whenever the number of visible lights changes, so transient `<pointLight>`s
 * mounted per shot cause a compile hitch on each volley. Effects borrow a slot instead; the
 * `<FlashLights>` lights are always mounted (intensity 0 when idle) so the light count is constant.
 */
export const FLASH_LIGHTS = 2

export interface FlashSlot {
  position: THREE.Vector3
  color: THREE.Color
  intensity: number
  distance: number
  busy: boolean
}

const slots: FlashSlot[] = Array.from({ length: FLASH_LIGHTS }, () => ({ position: new THREE.Vector3(), color: new THREE.Color('#ffb050'), intensity: 0, distance: 8, busy: false }))

/** Hands out the first idle slot (or the dimmest busy one when all are taken). */
export function acquireFlashSlot(color: string, distance: number): FlashSlot {
  let slot = slots.find((s) => !s.busy)
  if (!slot) slot = slots.reduce((a, b) => (a.intensity <= b.intensity ? a : b))
  slot.busy = true
  slot.intensity = 0
  slot.distance = distance
  slot.color.set(color)
  return slot
}

export function releaseFlashSlot(slot: FlashSlot) {
  slot.intensity = 0
  slot.busy = false
}

/** Acquire a slot for the component's lifetime. Set `slot.intensity` / `slot.position` (world) in `useFrame`. */
export function useFlashSlot(color: string, distance: number): FlashSlot {
  const slot = useMemo(() => acquireFlashSlot(color, distance), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => releaseFlashSlot(slot), [slot])
  return slot
}

/** Mount once per world (battle). Lights are never toggled, only dimmed. */
export function FlashLights() {
  const lights = useRef<(THREE.PointLight | null)[]>([])
  useFrame(() => {
    for (let i = 0; i < FLASH_LIGHTS; i++) {
      const l = lights.current[i]
      const s = slots[i]
      if (!l) continue
      l.intensity = s.intensity
      l.distance = s.distance
      l.color.copy(s.color)
      l.position.copy(s.position)
    }
  })
  return (
    <group>
      {slots.map((_, i) => (
        <pointLight
          key={i}
          ref={(el) => {
            lights.current[i] = el
          }}
          intensity={0}
          distance={8}
          decay={2}
        />
      ))}
    </group>
  )
}
