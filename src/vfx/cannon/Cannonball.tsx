import { useFrame } from '@react-three/fiber'
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import { seededRandom } from '../random'
import { createImpactLatch, normalize, solveArc, type Arc } from './ballistics'
import { DEFAULT_WIND, perpendicularBasis, useReducedMotion } from './motion'
import { SpriteCloud, type SpriteCloudHandle } from './SpriteCloud'
import { glowTexture, ironTexture, smokeTexture } from './textures'
import { useEffectTimeline } from './timeline'

export interface CannonballHandle {
  /** Current world position (updated every frame; read, don't mutate). */
  readonly position: THREE.Vector3
  /** Current world velocity in units per second. */
  readonly velocity: THREE.Vector3
  /** 0 at the muzzle … 1 at impact. */
  readonly progress: number
  readonly inFlight: boolean
  readonly impacted: boolean
  /** Finish instantly: the ball lands, `onImpact` fires once, `onDone` follows. */
  skip(): void
}

export interface CannonballProps {
  from: Vec3
  to: Vec3
  /** Apex height above the chord; default scales with distance. */
  apex?: number
  /** Average horizontal speed, units per second. */
  speed?: number
  /** Seconds to wait at the muzzle (hidden) before launching. */
  delay?: number
  /** Radians per second about the axis perpendicular to flight. */
  spin?: number
  radius?: number
  seed?: number
  trail?: boolean
  wind?: Vec3
  /** Fires exactly once, with the impact point, the frame the ball reaches `to`. */
  onImpact?: (point: Vec3) => void
  /** Fires once when the ball leaves the muzzle (after `delay`). */
  onLaunch?: () => void
  /** Fires once after the impact, when the trail has faded. */
  onDone?: () => void
}

const TRAIL = 26
const TRAIL_SPACING = 0.035
const TRAIL_FADE = 0.75
const BALL_GEOMETRY = new THREE.SphereGeometry(1, 28, 20)
let ballMaterial: THREE.MeshStandardMaterial | null = null
const getBallMaterial = () => {
  if (!ballMaterial) {
    const iron = ironTexture()
    ballMaterial = new THREE.MeshStandardMaterial({
      color: '#2b2b2f',
      metalness: 0.85,
      roughness: 0.5,
      bumpMap: iron,
      bumpScale: 0.6,
      roughnessMap: iron,
    })
  }
  return ballMaterial
}
const axisTmp = new THREE.Vector3()

/**
 * A real iron ball on a ballistic arc from `from` to `to`, spinning, with a faint powder trail and a heat
 * glow for the first moments after leaving the muzzle. Casts a shadow. `onImpact` fires exactly once.
 */
export const Cannonball = forwardRef<CannonballHandle, CannonballProps>(function Cannonball(
  { from, to, apex, speed, delay = 0, spin = 9, radius = 0.075, seed = 1, trail = true, wind = DEFAULT_WIND, onImpact, onLaunch, onDone },
  ref,
) {
  const reduced = useReducedMotion()
  const arc: Arc = useMemo(() => solveArc(from, to, { apex, speed }), [from, to, apex, speed])
  const flight = arc.duration
  const dir = useMemo(() => normalize([to[0] - from[0], 0, to[2] - from[2]]), [from, to])
  const basis = useMemo(() => perpendicularBasis(dir), [dir])
  const wobblePhase = useMemo(() => seededRandom(seed)() * Math.PI * 2, [seed])
  const fade = trail ? TRAIL_FADE : 0.05
  const tl = useEffectTimeline(delay + flight + fade, { onDone })
  const impact = useMemo(() => createImpactLatch<Vec3>(onImpact), [onImpact])
  const launch = useMemo(() => createImpactLatch<void>(onLaunch), [onLaunch])

  const mesh = useRef<THREE.Mesh>(null)
  const cloud = useRef<SpriteCloudHandle>(null)
  const glow = useRef<SpriteCloudHandle>(null)
  const state = useRef({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), progress: 0, inFlight: false })
  const trailCount = trail ? (reduced ? 12 : TRAIL) : 0

  useImperativeHandle(
    ref,
    () => ({
      get position() {
        return state.current.position
      },
      get velocity() {
        return state.current.velocity
      },
      get progress() {
        return state.current.progress
      },
      get inFlight() {
        return state.current.inFlight
      },
      get impacted() {
        return impact.fired
      },
      skip: () => tl.skip(),
    }),
    [tl, impact],
  )

  useFrame(() => {
    const t = tl.t - delay
    const k = Math.min(1, Math.max(0, t / flight))
    const s = state.current
    const p = arc.pointAt(k)
    const v = arc.velocityAt(k)
    s.position.set(p[0], p[1], p[2])
    s.velocity.set(v[0], v[1], v[2])
    s.progress = k
    s.inFlight = t >= 0 && t < flight
    if (t >= 0) launch.fire()
    if (t >= flight) impact.fire(to)

    const m = mesh.current
    if (m) {
      m.visible = s.inFlight
      if (s.inFlight) {
        const wob = 0.012 * Math.sin(t * 46 + wobblePhase) * (1 - k)
        m.position.set(p[0] + basis.u[0] * wob, p[1] + basis.u[1] * wob, p[2] + basis.u[2] * wob)
        axisTmp.set(basis.u[0], basis.u[1], basis.u[2])
        m.quaternion.setFromAxisAngle(axisTmp, spin * t + wobblePhase)
      }
    }

    const g = glow.current
    if (g) {
      const heat = s.inFlight ? Math.max(0, 1 - t / 0.5) : 0
      if (heat > 0) g.write(0, p[0], p[1], p[2], radius * 7 * (1.6 - heat * 0.6), heat * 0.85, 0, heat)
      else g.hide(0)
      g.commit()
    }
    const c = cloud.current
    if (!c) return
    for (let j = 0; j < trailCount; j++) {
      const te = t - j * TRAIL_SPACING * (reduced ? 2 : 1)
      const age = t - te
      if (te < 0 || te > flight || age > TRAIL_FADE) {
        c.hide(j)
        continue
      }
      const q = arc.pointAt(te / flight)
      const a = age / TRAIL_FADE
      const size = radius * (1.6 + a * 7)
      c.write(j, q[0] + wind[0] * age, q[1] + wind[1] * age + 0.25 * age, q[2] + wind[2] * age, size, 0.42 * Math.pow(1 - a, 1.3) * (1 - k * 0.35), j * 0.9, 0.4 + a * 0.5)
    }
    c.commit()
  })

  return (
    <group>
      <mesh ref={mesh} geometry={BALL_GEOMETRY} material={getBallMaterial()} scale={radius} castShadow visible={false} frustumCulled={false} />
      {trailCount > 0 && <SpriteCloud ref={cloud} count={trailCount} map={smokeTexture()} colorA="#8a8680" colorB="#ddd9d0" shading={0.5} renderOrder={11} />}
      <SpriteCloud ref={glow} count={1} map={glowTexture()} blending="additive" colorA="#ff5a00" colorB="#ffd27a" renderOrder={21} />
    </group>
  )
})
