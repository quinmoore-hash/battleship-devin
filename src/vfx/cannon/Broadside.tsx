import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { Vec3 } from '../../scene/layout'
import { aimDirection, scheduleBroadside, type ArcOptions, type BroadsideShot } from './ballistics'
import { Cannonball, type CannonballHandle } from './Cannonball'
import { CannonSmoke } from './CannonSmoke'
import { useReducedMotion } from './motion'
import { MuzzleFlash } from './MuzzleFlash'

export interface BroadsideHandle {
  /** One handle per shot, in `shots` order (null until mounted). */
  readonly balls: readonly (CannonballHandle | null)[]
  /** The ball a follow-camera should track: the furthest along that has not landed, else the last one. */
  lead(): CannonballHandle | null
  /** Land every ball now. Each `onImpact` still fires exactly once, then `onAllImpacted`. */
  skip(): void
}

export interface BroadsideProps extends ArcOptions {
  shots: readonly BroadsideShot[]
  /** Seconds between the first and the last gun. Default 0.55 (reduced motion: 0.25). */
  stagger?: number
  seed?: number
  /** Muzzle flash + powder smoke at each `from` (default true). */
  muzzleFx?: boolean
  wind?: Vec3
  onFire?: (index: number) => void
  onImpact?: (point: Vec3, index: number) => void
  onAllImpacted?: () => void
  /** Fires when every ball has landed and all smoke has cleared. */
  onDone?: () => void
}

/**
 * A volley: every gun gets a muzzle flash, smoke and a cannonball, staggered bow to stern. A single shot is a
 * broadside of one. Composes the individual effects so the cinematic director only needs world-space
 * `from`/`to` pairs (see `batteryMuzzles` / `impactPointWorld` / `cellToWorld`).
 */
export const Broadside = forwardRef<BroadsideHandle, BroadsideProps>(function Broadside(
  { shots, stagger, seed = 1, muzzleFx = true, wind, apex, speed, minDuration, onFire, onImpact, onAllImpacted, onDone },
  ref,
) {
  const reduced = useReducedMotion()
  const gap = stagger ?? (reduced ? 0.25 : 0.55)
  const plan = useMemo(() => scheduleBroadside(shots, gap, { apex, speed, minDuration }), [shots, gap, apex, speed, minDuration])
  const balls = useRef<(CannonballHandle | null)[]>([])
  const impacts = useRef(0)
  const finished = useRef(0)
  const allFired = useRef(false)
  const cbs = useRef({ onFire, onImpact, onAllImpacted, onDone })
  useEffect(() => {
    cbs.current = { onFire, onImpact, onAllImpacted, onDone }
  }, [onFire, onImpact, onAllImpacted, onDone])

  const handleImpact = useCallback(
    (point: Vec3, index: number) => {
      cbs.current.onImpact?.(point, index)
      impacts.current++
      if (impacts.current === plan.length && !allFired.current) {
        allFired.current = true
        cbs.current.onAllImpacted?.()
      }
    },
    [plan.length],
  )
  const handleDone = useCallback(() => {
    finished.current++
    if (finished.current === plan.length * (muzzleFx ? 2 : 1)) cbs.current.onDone?.()
  }, [plan.length, muzzleFx])

  useImperativeHandle(
    ref,
    () => ({
      get balls() {
        return balls.current
      },
      lead() {
        let best: CannonballHandle | null = null
        for (const b of balls.current) {
          if (!b) continue
          if (b.inFlight && (!best || b.progress > best.progress)) best = b
        }
        return best ?? balls.current.findLast((b) => b && b.impacted) ?? null
      },
      skip() {
        for (const b of balls.current) b?.skip()
      },
    }),
    [],
  )

  // per-shot stable callbacks so Cannonball's latches are not recreated on parent re-render
  const impactCbs = useMemo(() => plan.map((s) => (point: Vec3) => handleImpact(point, s.index)), [plan, handleImpact])
  const fireCbs = useMemo(() => plan.map((s) => () => cbs.current.onFire?.(s.index)), [plan])

  return (
    <group>
      {plan.map((s) => {
        const direction = aimDirection(s.from, s.to)
        return (
          <group key={s.index}>
            {muzzleFx && <MuzzleFlash position={s.from} direction={direction} delay={s.delay} seed={seed * 101 + s.index} />}
            {muzzleFx && <CannonSmoke position={s.from} direction={direction} delay={s.delay} seed={seed * 101 + s.index} wind={wind} onDone={handleDone} />}
            <Cannonball
              ref={(h: CannonballHandle | null) => {
                balls.current[s.index] = h
              }}
              from={s.from}
              to={s.to}
              apex={s.arc.apex}
              speed={speed}
              delay={s.delay}
              seed={seed * 101 + s.index}
              wind={wind}
              onLaunch={fireCbs[s.index]}
              onImpact={impactCbs[s.index]}
              onDone={handleDone}
            />
          </group>
        )
      })}
    </group>
  )
})

export type { CannonballHandle }
