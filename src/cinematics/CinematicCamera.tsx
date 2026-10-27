import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { BOARD_LAYOUT, boardCenter, type Vec3 } from '../scene/layout'
import { CAMERA_SHOTS } from '../scene/CameraRig'
import { SHIPS, shipWorldTransform } from '../ships'
import { ownBoardOrigin } from './battery'
import { director as defaultDirector, type ActiveCinematic, type Director } from './director'
import { beatAt, type Beat, type BeatState } from './sequence'
import { follow, smoothstep } from './shared'

export interface CinematicCameraProps {
  director?: Director
}

interface Pose {
  position: THREE.Vector3
  target: THREE.Vector3
  fov: number
}

const UP = new THREE.Vector3(0, 1, 0)
const playerCenter = boardCenter(BOARD_LAYOUT.player)
const enemyCenter = boardCenter(BOARD_LAYOUT.enemy)
const MIN_Y = 0.9
const overview = CAMERA_SHOTS.battle

/** Scratch vectors shared by the pure shot functions (one camera per scene). */
const tmp = {
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  right: new THREE.Vector3(),
  n: new THREE.Vector3(),
  side: new THREE.Vector3(),
}

const set = (v: THREE.Vector3, p: Vec3) => v.set(p[0], p[1], p[2])
const beatScratch: BeatState = { beat: null, k: 1, index: -1 }

function horizontal(out: THREE.Vector3, from: Vec3, to: Vec3): THREE.Vector3 {
  out.set(to[0] - from[0], 0, to[2] - from[2])
  return out.lengthSq() > 1e-6 ? out.normalize() : out.set(0, 0, -1)
}

function lerpPose(out: Pose, from: Pose, to: Pose, k: number) {
  out.position.lerpVectors(from.position, to.position, k)
  out.target.lerpVectors(from.target, to.target, k)
  out.fov = THREE.MathUtils.lerp(from.fov, to.fov, k)
}

const overviewPose: Pose = { position: overview.position, target: overview.target, fov: overview.fov }

/**
 * The wanted camera pose for `active` at `beat` / `k`. `start` is the camera pose when the beat began, so
 * eases run from wherever the camera actually was. Returns `cut` = true when the pose should be applied
 * without smoothing (a hard cut).
 */
export function wantedPose(out: Pose, active: ActiveCinematic, beat: Beat | null, k: number, start: Pose): boolean {
  const { event, plan } = active
  if (event.type === 'shot' && plan) {
    const enemy = plan.by === 'enemy'
    const m = plan.muzzles
    const M = tmp.a.set(0, 0, 0)
    if (m.length) {
      for (const mz of m) M.add(set(tmp.b, mz.position))
      M.multiplyScalar(1 / m.length)
    } else if (plan.shooter) set(M, plan.shooter.position)
    const fireDir = horizontal(tmp.dir, [M.x, M.y, M.z], plan.impact)
    const right = tmp.right.set(fireDir.z, 0, -fireDir.x)
    const behind: Pose = { position: tmp.b, target: tmp.n, fov: enemy ? 44 : 48 }
    behind.position.copy(M).addScaledVector(fireDir, enemy ? -3.8 : -5.2).addScaledVector(right, enemy ? 1.4 : 2.1).addScaledVector(UP, enemy ? 1.5 : 1.9)
    behind.target.copy(M).addScaledVector(fireDir, 4).addScaledVector(UP, 0.3)
    switch (beat?.name) {
      case 'approach':
        if (enemy) {
          out.position.copy(behind.position).addScaledVector(fireDir, 0.3 * k)
          out.target.copy(behind.target)
          out.fov = behind.fov
          return true
        }
        lerpPose(out, start, behind, smoothstep(k))
        return false
      case 'fire':
        out.position.copy(behind.position).addScaledVector(fireDir, 0.5 * k)
        out.target.copy(behind.target)
        out.fov = behind.fov
        return false
      case 'flight': {
        if (follow.active) {
          const dir = tmp.n.copy(follow.velocity)
          if (dir.lengthSq() < 1e-6) dir.copy(fireDir)
          dir.normalize()
          const h = tmp.side.set(dir.x, 0, dir.z)
          if (h.lengthSq() < 1e-6) h.copy(fireDir)
          h.normalize()
          out.position.copy(follow.position).addScaledVector(h, -3.2).addScaledVector(right, 0.9).addScaledVector(UP, 1.4)
          out.target.copy(follow.position).addScaledVector(dir, 2.5)
        } else {
          const B = tmp.n.copy(M).lerp(set(tmp.side, plan.impact), k)
          B.y += Math.sin(Math.PI * k) * 2
          out.position.copy(B).addScaledVector(fireDir, -3.2).addScaledVector(right, 0.9).addScaledVector(UP, 1.4)
          out.target.copy(B).addScaledVector(fireDir, 2.5)
        }
        out.fov = 50
        return false
      }
      case 'impact': {
        const I = set(tmp.a, plan.impact)
        const n = set(tmp.n, plan.normal)
        const side = tmp.side.crossVectors(UP, n).normalize()
        if (enemy) side.negate()
        const miss = plan.result.outcome === 'miss'
        // a real hull (the player's ship, or a revealed wreck) needs room: stay outside the rigging of its neighbours
        const hull = plan.victim ? SHIPS[plan.victim.ship.spec.id].anchors.hull : null
        const r = miss ? 5.5 : hull ? hull.beam * 1.5 + 5.5 : 4.6
        const a = k * 0.45
        const dir = tmp.b.copy(n).multiplyScalar(hull ? 0.9 : 0.75).addScaledVector(side, hull ? 0.45 : 0.65).normalize().applyAxisAngle(UP, a)
        out.position.copy(I).addScaledVector(dir, r).addScaledVector(UP, miss ? 2.3 : (hull ? hull.height * 0.9 + 1.6 : 1.7) + k * 0.4)
        out.target.copy(I).addScaledVector(UP, miss ? 0.2 : 0.35)
        out.fov = miss ? 46 : 42
        return false
      }
      default:
        lerpPose(out, start, overviewPose, smoothstep(k))
        return false
    }
  }
  if (event.type === 'sink') {
    const fleet = event.owner === 'human' ? active.fleets.human : active.fleets.enemy
    const ship = fleet.find((s) => s.uid === (event.uid ?? event.shipId))
    const pose = ship ? shipWorldTransform(ship, ownBoardOrigin(event.owner)) : { position: [0, 0.2, event.owner === 'human' ? playerCenter[2] : enemyCenter[2]] as Vec3, rotationY: 0 }
    const hull = SHIPS[event.shipId].anchors.hull
    const C = set(tmp.a, pose.position)
    if (beat?.name === 'sink') {
      const r = hull.length * 0.7 + 2.6
      const a = pose.rotationY + 0.95 + k * 1.1
      const orbit: Pose = { position: tmp.b, target: tmp.n, fov: 40 - k * 4 }
      orbit.position.set(C.x + Math.sin(a) * r, C.y + 1.3 + k * 0.9, C.z + Math.cos(a) * r)
      orbit.target.set(C.x, C.y + 0.5 - k * 0.6, C.z)
      lerpPose(out, start, orbit, smoothstep(k / 0.18))
      return false
    }
    lerpPose(out, start, overviewPose, smoothstep(k))
    return false
  }
  if (event.type === 'battle-start') {
    if (beat?.name === 'flyover') {
      const e = smoothstep(k)
      const p0 = tmp.a.set(playerCenter[0] - 10, 6.5, playerCenter[2] + 9)
      const p1 = tmp.b.set(1, 10, (playerCenter[2] + enemyCenter[2]) / 2)
      const p2 = tmp.n.set(enemyCenter[0] + 10, 6, enemyCenter[2] - 8)
      const u = 1 - e
      out.position.copy(p0).multiplyScalar(u * u).addScaledVector(p1, 2 * u * e).addScaledVector(p2, e * e)
      out.target.set(THREE.MathUtils.lerp(playerCenter[0], enemyCenter[0], e), 0.4, THREE.MathUtils.lerp(playerCenter[2] - 2, enemyCenter[2] + 2, e))
      out.fov = 46
      return k === 0
    }
    lerpPose(out, start, overviewPose, smoothstep(k))
    return false
  }
  if (event.type !== 'victory') {
    lerpPose(out, start, overviewPose, smoothstep(k))
    return false
  }
  // victory: slow orbit over the fleet there is something to see — the pirates' (fireworks over it for a win,
  // its burning wrecks for a loss; the Navy's winning fleet stays hidden)
  const F = set(tmp.a, playerCenter)
  const hold = beat?.name === 'hold'
  const a = hold ? 0.8 + k * 0.5 : -0.6 + k * 1.4
  const r = hold ? 15 + k * 3 : 15
  const orbit: Pose = { position: tmp.b, target: tmp.n, fov: hold ? 40 : 44 }
  orbit.position.set(F.x + Math.sin(a) * r, 6.5 + (hold ? k * 2 : 0), F.z + Math.cos(a) * r)
  orbit.target.set(F.x, 0.6, F.z)
  if (!hold) lerpPose(out, start, orbit, smoothstep(k / 0.25))
  else lerpPose(out, orbit, orbit, 1)
  return false
}

/**
 * Drives the camera while the director is busy. Mount it inside `<OceanScene>` and set the scene's
 * `cameraOverride` from `useDirector((s) => s.busy)` so the rig stands down. Camera shake is a decaying
 * impulse the director sets on impacts (never under reduced motion).
 */
export function CinematicCamera({ director = defaultDirector }: CinematicCameraProps) {
  const want = useRef<Pose>({ position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 42 })
  const start = useRef<Pose>({ position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 42 })
  const smooth = useRef<Pose>({ position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 42 })
  const lastKey = useRef('')
  const shake = useRef(0)
  const shakeT = useRef(0)
  const offset = useRef(new THREE.Vector3())

  useFrame((state, delta) => {
    const s = director.store.getState()
    const active = s.active
    const camera = state.camera as THREE.PerspectiveCamera
    if (!active) {
      lastKey.current = ''
      shake.current = 0
      return
    }
    const dt = Math.min(delta, 0.1)
    const { beat, k } = beatAt(active.seq, active.clock.t, beatScratch)
    const key = `${active.id}:${beat?.name ?? ''}`
    if (key !== lastKey.current) {
      lastKey.current = key
      start.current.position.copy(camera.position).sub(offset.current)
      camera.getWorldDirection(tmp.a)
      start.current.target.copy(start.current.position).addScaledVector(tmp.a, 12)
      start.current.fov = camera.fov
      smooth.current.position.copy(start.current.position)
      smooth.current.target.copy(start.current.target)
      smooth.current.fov = camera.fov
    }
    const cut = wantedPose(want.current, active, beat, k, start.current)
    const lambda = beat?.name === 'flight' ? 9 : beat?.name === 'impact' ? 5 : 14
    if (cut) {
      smooth.current.position.copy(want.current.position)
      smooth.current.target.copy(want.current.target)
      smooth.current.fov = want.current.fov
    } else {
      const f = 1 - Math.exp(-lambda * dt)
      smooth.current.position.lerp(want.current.position, f)
      smooth.current.target.lerp(want.current.target, f)
      smooth.current.fov += (want.current.fov - smooth.current.fov) * f
    }

    if (s.shake > 0) {
      shake.current += s.shake
      director.store.setState({ shake: 0 })
    }
    shake.current *= Math.exp(-dt * 5.5)
    shakeT.current += dt
    const amp = shake.current
    const t = shakeT.current
    offset.current.set(Math.sin(t * 37.1) * amp, Math.sin(t * 51.7 + 1.3) * amp * 0.8, Math.sin(t * 43.3 + 2.1) * amp * 0.6)

    camera.position.copy(smooth.current.position).add(offset.current)
    if (camera.position.y < MIN_Y) camera.position.y = MIN_Y
    camera.lookAt(smooth.current.target)
    if (Math.abs(camera.fov - smooth.current.fov) > 1e-3) {
      camera.fov = smooth.current.fov
      camera.updateProjectionMatrix()
    }
  })
  return null
}
