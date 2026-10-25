import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { coordKey, type Coord, type ShotOutcome, type ShotResult } from '../engine'
import { BOARD_LAYOUT, cellToWorld, hashString, type Vec3 } from './layout'
import { MAT } from './materials'
import { ParticleBurst, SmokeColumn } from './ParticleFx'
import { markerPhase, PROJECTILE_DURATION, projectileApex, projectilePoint, settledMarkerPhase } from './timeline'

// ---------------------------------------------------------------------------
// Single marker
// ---------------------------------------------------------------------------

interface MarkerProps {
  shot: ShotResult
  position: Vec3
  /** false = the shot was already there when we mounted: show the settled marker, skip the show. */
  animate: boolean
  cellSize: number
}

function Marker({ shot, position, animate, cellSize }: MarkerProps) {
  const ring = useRef<THREE.Mesh>(null)
  const flash = useRef<THREE.Mesh>(null)
  const settled = useRef<THREE.Group>(null)
  const start = useRef<number | null>(animate ? null : -Infinity)
  const seed = useMemo(() => hashString(coordKey(shot.coord) + shot.outcome), [shot])
  const outcome: ShotOutcome = shot.outcome

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    if (start.current === null) start.current = t
    const p = start.current === -Infinity ? settledMarkerPhase(outcome) : markerPhase(outcome, t - start.current)
    if (ring.current) {
      ring.current.visible = p.ringOpacity > 0.01
      ring.current.scale.setScalar(p.ringScale * cellSize)
      ;(ring.current.material as THREE.MeshBasicMaterial).opacity = p.ringOpacity
    }
    if (flash.current) {
      flash.current.visible = p.flash > 0.01
      flash.current.scale.setScalar((0.3 + p.flash * 0.9) * cellSize)
      ;(flash.current.material as THREE.MeshBasicMaterial).opacity = p.flash
    }
    if (settled.current) {
      const s = Math.max(p.settled, 0.0001)
      settled.current.scale.setScalar(s * cellSize)
      settled.current.visible = p.settled > 0.001
      settled.current.position.y = outcome === 'miss' ? Math.sin(t * 1.6 + seed) * 0.03 : 0
    }
  })

  const ringMat = useMemo(() => (outcome === 'miss' ? MAT.splashRing : MAT.fireRing).clone(), [outcome])
  const flashMat = useMemo(() => MAT.flash.clone(), [])

  return (
    <group position={position}>
      <mesh ref={ring} material={ringMat} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.32, 0.46, 40]} />
      </mesh>
      {outcome !== 'miss' && (
        <mesh ref={flash} material={flashMat} position={[0, 0.25, 0]} visible={false}>
          <sphereGeometry args={[0.5, 14, 12]} />
        </mesh>
      )}
      <group ref={settled} visible={false}>
        {outcome === 'miss' ? <Buoy /> : <HitBeacon big={outcome === 'sunk'} seed={seed} />}
      </group>
      {animate && <MarkerBurst outcome={outcome} seed={seed} cellSize={cellSize} />}
    </group>
  )
}

/** Small striped buoy left behind by a miss. */
function Buoy() {
  return (
    <group>
      <mesh material={MAT.buoyWhite} position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.1, 0.14, 0.26, 12]} />
      </mesh>
      <mesh material={MAT.buoyRed} position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.105, 0.12, 0.08, 12]} />
      </mesh>
      <mesh material={MAT.buoyRed} position={[0, 0.3, 0]}>
        <sphereGeometry args={[0.07, 10, 8]} />
      </mesh>
      <mesh material={MAT.metalDark} position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.1, 6]} />
      </mesh>
      <mesh material={MAT.ripple} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.2, 0.26, 24]} />
      </mesh>
    </group>
  )
}

/** Glowing red marker with a smoke column left behind by a hit. */
function HitBeacon({ big, seed }: { big: boolean; seed: number }) {
  const core = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!core.current) return
    const pulse = 1 + Math.sin(clock.elapsedTime * 4 + seed) * 0.12
    core.current.scale.setScalar(pulse)
    core.current.rotation.y = clock.elapsedTime * 0.8
  })
  const k = big ? 1.35 : 1
  return (
    <group>
      <mesh material={MAT.scorch} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.38 * k, 18]} />
      </mesh>
      <mesh ref={core} material={MAT.hitMarker} position={[0, 0.22 * k, 0]}>
        <octahedronGeometry args={[0.2 * k, 0]} />
      </mesh>
      <mesh material={MAT.metalDark} position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.06, 0.1, 0.1, 8]} />
      </mesh>
      <SmokeColumn position={[0, 0.3 * k, 0]} count={big ? 12 : 8} period={big ? 3.2 : 2.6} height={big ? 2.2 : 1.5} baseScale={big ? 0.14 : 0.1} seed={seed % 97} />
      <SmokeColumn position={[0, 0.08, 0]} color="#ff8a2a" opacity={0.85} count={4} period={0.7} height={0.3} drift={0.05} baseScale={0.07} seed={seed % 13} />
    </group>
  )
}

/** One-shot particles: water column for a miss, fire for a hit, fire + debris for a sink. */
function MarkerBurst({ outcome, seed, cellSize }: { outcome: ShotOutcome; seed: number; cellSize: number }) {
  if (outcome === 'miss') {
    return (
      <ParticleBurst
        count={34}
        seed={seed}
        speed={[0.3, 1.4]}
        up={[2.6, 4.6]}
        size={[0.03, 0.09]}
        life={[0.5, 0.95]}
        stagger={0.12}
        spread={0.12 * cellSize}
        gravity={-9.8}
        colors={['#e8f6ff', '#ffffff', '#b9e3f7']}
        opacity={0.9}
      />
    )
  }
  const big = outcome === 'sunk'
  return (
    <>
      <ParticleBurst
        count={big ? 60 : 36}
        seed={seed}
        speed={[0.3, big ? 2.2 : 1.4]}
        up={[1.4, big ? 4.2 : 3]}
        size={[0.05, big ? 0.2 : 0.14]}
        life={[0.45, big ? 1.1 : 0.8]}
        stagger={0.1}
        spread={0.15 * cellSize}
        gravity={-3.5}
        drag={1.6}
        colors={['#ffe08a', '#ff9f1c', '#ff5e1a', '#ff3b1a']}
        emissive
      />
      <ParticleBurst
        count={big ? 22 : 12}
        seed={seed + 1}
        speed={[0.2, 1]}
        up={[0.8, 2.2]}
        size={[0.08, 0.2]}
        life={[1.2, 2.2]}
        stagger={0.25}
        spread={0.1}
        gravity={0.6}
        drag={1.2}
        colors={['#3a3a3a', '#555555', '#2a2a2a']}
        opacity={0.6}
      />
      {big && (
        <ParticleBurst
          count={26}
          seed={seed + 2}
          speed={[1, 3.2]}
          up={[3, 6.5]}
          size={[0.06, 0.16]}
          life={[1, 1.7]}
          stagger={0.08}
          spread={0.2}
          gravity={-9.8}
          shape="shard"
          colors={['#8a5a2b', '#5e3b1a', '#c99a62', '#efe3d0']}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// ShotMarkers
// ---------------------------------------------------------------------------

export interface ShotMarkersProps {
  shots: ShotResult[]
  /**
   * Board offset in world units: `{x, y}` maps to world `[x, 0, y]`. Kept for API compatibility;
   * prefer `origin`.
   */
  offset?: Coord
  /** World position of the board centre (takes precedence over `offset`). */
  origin?: Vec3
  cellSize?: number
  /** Skip one-shot bursts entirely (reduced-motion setting). */
  reducedMotion?: boolean
}

/**
 * Renders every shot on a board. Shots that exist when this mounts render settled instantly;
 * only shots added afterwards play their splash / explosion.
 */
export function ShotMarkers({ shots, offset, origin, cellSize = BOARD_LAYOUT.cellSize, reducedMotion = false }: ShotMarkersProps) {
  const boardOrigin: Vec3 = origin ?? (offset ? [offset.x, 0, offset.y] : BOARD_LAYOUT.player.origin)
  // Decide once per shot whether it animates, and remember that decision across re-renders.
  const [decisions] = useState(() => new Map<string, boolean>(shots.map((s) => [coordKey(s.coord), false])))
  return (
    <>
      {shots.map((shot) => {
        const key = coordKey(shot.coord)
        if (!decisions.has(key)) decisions.set(key, !reducedMotion)
        return (
          <Marker
            key={key}
            shot={shot}
            animate={decisions.get(key) ?? false}
            position={cellToWorld(shot.coord, boardOrigin, cellSize)}
            cellSize={cellSize}
          />
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// Projectile
// ---------------------------------------------------------------------------

export interface ProjectileProps {
  from: Vec3
  to: Vec3
  /** Fired exactly once when the shell lands. */
  onImpact?: () => void
  /** Flight time in seconds. */
  duration?: number
  /** Height of the arc above the straight line; defaults to scale with distance. */
  apex?: number
  /** `acorn` (default) or `pebble`. */
  shell?: 'acorn' | 'pebble'
}

const TRAIL = 7

/** An arcing acorn/pebble shell with a fading trail. Unmounts itself after impact. */
export function Projectile({ from, to, onImpact, duration = PROJECTILE_DURATION, apex, shell = 'acorn' }: ProjectileProps) {
  const body = useRef<THREE.Group>(null)
  const trail = useRef<THREE.InstancedMesh>(null)
  const start = useRef<number | null>(null)
  const [landed, setLanded] = useState(false)
  const peak = apex ?? projectileApex(from, to)
  const obj = useMemo(() => new THREE.Object3D(), [])

  useFrame(({ clock }) => {
    if (landed || !body.current) return
    if (start.current === null) start.current = clock.elapsedTime
    const t = (clock.elapsedTime - start.current) / duration
    const p = projectilePoint(from, to, t, peak)
    body.current.position.set(p[0], p[1], p[2])
    body.current.rotation.x += 0.25
    body.current.rotation.z += 0.12
    if (trail.current) {
      for (let i = 0; i < TRAIL; i++) {
        const q = projectilePoint(from, to, t - (i + 1) * 0.035, peak)
        obj.position.set(q[0], q[1], q[2])
        obj.scale.setScalar(t > (i + 1) * 0.035 ? 0.07 * (1 - i / TRAIL) : 0.0001)
        obj.updateMatrix()
        trail.current.setMatrixAt(i, obj.matrix)
      }
      trail.current.instanceMatrix.needsUpdate = true
    }
    if (t >= 1) {
      setLanded(true)
      onImpact?.()
    }
  })

  if (landed) return null
  return (
    <>
      <group ref={body} position={from}>
        {shell === 'acorn' ? (
          <>
            <mesh material={MAT.acorn} position={[0, -0.03, 0]} scale={[1, 1.15, 1]}>
              <sphereGeometry args={[0.12, 12, 10]} />
            </mesh>
            <mesh material={MAT.acornCap} position={[0, 0.07, 0]} scale={[1, 0.65, 1]}>
              <sphereGeometry args={[0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            </mesh>
            <mesh material={MAT.acornCap} position={[0, 0.16, 0]}>
              <cylinderGeometry args={[0.015, 0.025, 0.1, 6]} />
            </mesh>
          </>
        ) : (
          <mesh material={MAT.rock} scale={[1.1, 0.8, 1]}>
            <dodecahedronGeometry args={[0.13, 0]} />
          </mesh>
        )}
      </group>
      <instancedMesh ref={trail} args={[undefined, undefined, TRAIL]} frustumCulled={false}>
        <sphereGeometry args={[1, 6, 5]} />
        <meshBasicMaterial color="#fff2c8" transparent opacity={0.55} depthWrite={false} />
      </instancedMesh>
    </>
  )
}
