import { OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { BOARD_LAYOUT, boardCenter } from './layout'

export type CameraView = 'menu' | 'placement' | 'battle' | 'gameover'

const playerCenter = boardCenter(BOARD_LAYOUT.player)
const enemyCenter = boardCenter(BOARD_LAYOUT.enemy)
const midZ = (playerCenter[2] + enemyCenter[2]) / 2

/** Fixed shots. `menu` orbits slowly around its target instead of using `position`. */
export const CAMERA_SHOTS: Record<CameraView, { position: THREE.Vector3; target: THREE.Vector3; fov: number }> = {
  menu: { position: new THREE.Vector3(0, 11, 36), target: new THREE.Vector3(0, 0.5, midZ), fov: 42 },
  placement: {
    position: new THREE.Vector3(playerCenter[0], 17, playerCenter[2] + 11),
    target: new THREE.Vector3(playerCenter[0], 0, playerCenter[2] - 1),
    fov: 42,
  },
  battle: {
    position: new THREE.Vector3(0, 19, playerCenter[2] + 27),
    target: new THREE.Vector3(0, 0, midZ - 5),
    fov: 40,
  },
  gameover: {
    position: new THREE.Vector3(-21, 6, enemyCenter[2] + 17),
    target: new THREE.Vector3(2, 1.2, enemyCenter[2] + 1),
    fov: 40,
  },
}

const MENU_ORBIT = { radius: 36, height: 11, speed: 0.045 }

export interface CameraRigProps {
  view: CameraView
  /** Let the player orbit/zoom (battle only by default). */
  interactive?: boolean
  /**
   * Hand the camera to someone else (the cinematics director's `<CinematicCamera />`): the rig stops
   * writing position / target / fov and disables orbit. When it flips back to false the rig damps from
   * wherever the camera was left toward the current shot.
   */
  override?: boolean
}

/**
 * Drives the camera between cinematic shots. Transitions are damped lerps in useFrame so a
 * view change mid-flight simply re-targets. In battle the player may orbit and zoom within
 * limits once the camera has arrived; polar angle is clamped so you can never see under the water.
 */
export function CameraRig({ view, interactive = view === 'battle', override = false }: CameraRigProps) {
  const get = useThree((s) => s.get)
  const controls = useRef<OrbitControlsImpl>(null)
  const target = useRef(new THREE.Vector3().copy(CAMERA_SHOTS[view].target))
  const settled = useRef(false)
  const prevView = useRef<CameraView | null>(null)
  const tmpPos = useRef(new THREE.Vector3())

  useEffect(() => {
    if (prevView.current === view) return
    const wasNull = prevView.current === null
    prevView.current = view
    settled.current = false
    if (wasNull) {
      // first mount: start in place (no fly-in from the default camera position)
      const camera = get().camera
      const shot = CAMERA_SHOTS[view]
      if (view === 'menu') {
        camera.position.set(0, MENU_ORBIT.height, MENU_ORBIT.radius).add(shot.target)
      } else {
        camera.position.copy(shot.position)
      }
      target.current.copy(shot.target)
      camera.lookAt(target.current)
    }
  }, [view, get])

  useFrame((state, delta) => {
    if (override) {
      settled.current = false
      return
    }
    const dt = Math.min(delta, 0.1)
    const camera = state.camera as THREE.PerspectiveCamera
    const shot = CAMERA_SHOTS[view]
    const wanted = tmpPos.current
    if (view === 'menu') {
      const a = state.clock.elapsedTime * MENU_ORBIT.speed
      wanted.set(
        shot.target.x + Math.sin(a) * MENU_ORBIT.radius,
        MENU_ORBIT.height + Math.sin(a * 0.7) * 1.2,
        shot.target.z + Math.cos(a) * MENU_ORBIT.radius,
      )
    } else {
      wanted.copy(shot.position)
    }

    const userDriving = interactive && settled.current && controls.current?.enabled
    const lambda = view === 'menu' ? 1.6 : 2.4
    if (!userDriving) {
      camera.position.x = THREE.MathUtils.damp(camera.position.x, wanted.x, lambda, dt)
      camera.position.y = THREE.MathUtils.damp(camera.position.y, wanted.y, lambda, dt)
      camera.position.z = THREE.MathUtils.damp(camera.position.z, wanted.z, lambda, dt)
      target.current.x = THREE.MathUtils.damp(target.current.x, shot.target.x, lambda, dt)
      target.current.y = THREE.MathUtils.damp(target.current.y, shot.target.y, lambda, dt)
      target.current.z = THREE.MathUtils.damp(target.current.z, shot.target.z, lambda, dt)
      camera.lookAt(target.current)
      if (controls.current) controls.current.target.copy(target.current)
      if (!settled.current && view !== 'menu' && camera.position.distanceTo(wanted) < 0.05) {
        settled.current = true
      }
    } else if (controls.current) {
      controls.current.update()
    }

    const fov = THREE.MathUtils.damp(camera.fov, shot.fov, 2, dt)
    if (Math.abs(fov - camera.fov) > 1e-3) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
    // never look under the water, even while flying between shots
    if (camera.position.y < 1.5) camera.position.y = 1.5
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault={false}
      enabled={interactive && !override}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minDistance={12}
      maxDistance={48}
      minPolarAngle={0.15}
      maxPolarAngle={Math.PI / 2 - 0.2}
      rotateSpeed={0.5}
      zoomSpeed={0.6}
      target={CAMERA_SHOTS[view].target}
    />
  )
}
