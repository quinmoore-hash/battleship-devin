import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import type * as THREE from 'three'
import { DEFAULT_PHOTO_ORBIT, dollyOrbit, flyOrbit, orbitPosition, panOrbit, rotateOrbit, type OrbitState } from './camera'

export interface FreeCameraProps {
  initial?: OrbitState
  fov?: number
  onChange?: (state: OrbitState) => void
}

const KEYS: Record<string, keyof typeof AXES> = { KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyQ: 'down', KeyE: 'up' }
const AXES = { fwd: 1, back: 1, left: 1, right: 1, up: 1, down: 1 }

/**
 * Free orbit / fly camera: drag = orbit, right-drag or shift-drag = pan, wheel = dolly, WASD/QE = fly (shift = boost).
 * Writes the camera every frame *after* the scene's CameraRig so it wins; mount with `interactive={false}` on the scene.
 */
export function FreeCamera({ initial = DEFAULT_PHOTO_ORBIT, fov = 45, onChange }: FreeCameraProps) {
  const gl = useThree((s) => s.gl)
  const state = useRef<OrbitState>(initial)
  const held = useRef(new Set<string>())
  const boost = useRef(false)
  const drag = useRef<{ id: number; x: number; y: number; pan: boolean } | null>(null)

  useEffect(() => {
    state.current = initial
  }, [initial])

  useEffect(() => {
    const el = gl.domElement
    const apply = (next: OrbitState) => {
      state.current = next
      onChange?.(next)
    }
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.button !== 2) return
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      d.x = e.clientX
      d.y = e.clientY
      const s = state.current
      if (d.pan) {
        const k = (s.distance * 1.6) / el.clientHeight
        apply(panOrbit(s, -dx * k, dy * k))
      } else {
        apply(rotateOrbit(s, (-dx * 2 * Math.PI) / el.clientWidth, (-dy * Math.PI) / el.clientHeight))
      }
    }
    const up = (e: PointerEvent) => {
      if (drag.current?.id === e.pointerId) drag.current = null
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      apply(dollyOrbit(state.current, Math.exp(e.deltaY * 0.0012)))
    }
    const ctx = (e: Event) => e.preventDefault()
    const key = (e: KeyboardEvent, isDown: boolean) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'Shift') boost.current = isDown
      const axis = KEYS[e.code]
      if (!axis) return
      e.preventDefault()
      if (isDown) held.current.add(axis)
      else held.current.delete(axis)
    }
    const kd = (e: KeyboardEvent) => key(e, true)
    const ku = (e: KeyboardEvent) => key(e, false)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('contextmenu', ctx)
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('contextmenu', ctx)
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
    }
  }, [gl, onChange])

  useFrame((root, delta) => {
    const h = held.current
    if (h.size > 0) {
      const next = flyOrbit(
        state.current,
        {
          forward: (h.has('fwd') ? 1 : 0) - (h.has('back') ? 1 : 0),
          right: (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0),
          up: (h.has('up') ? 1 : 0) - (h.has('down') ? 1 : 0),
          boost: boost.current,
        },
        Math.min(delta, 0.1),
      )
      if (next !== state.current) {
        state.current = next
        onChange?.(next)
      }
    }
    const s = state.current
    const camera = root.camera as THREE.PerspectiveCamera
    const p = orbitPosition(s)
    camera.position.set(p[0], p[1], p[2])
    camera.lookAt(s.target[0], s.target[1], s.target[2])
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  })

  return null
}
