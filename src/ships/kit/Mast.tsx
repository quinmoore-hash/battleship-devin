import { useMemo } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../../scene/layout'
import type { Livery, Lod } from '../types'
import { shipMaterials } from './materials'
import { Block, Rope } from './Rope'
import { Sail } from './Sail'

export interface MastProps {
  position: Vec3
  height: number
  livery: Livery
  /** [yardWidth, yardHeightAboveDeck] pairs, lowest first. */
  yards?: [number, number][]
  /** Sail set 0..1 (applies to every sail on this mast). */
  sails?: number
  /** 0 standing … 1 snapped at the lower-mast cap, with the upper section hanging by its rigging. */
  snapped?: number
  /** Extra tearing applied to the sails (0..1). */
  torn?: number
  phase?: number
  crowsNest?: boolean
  /** Aft rake in radians (positive leans the mast toward the stern). */
  rake?: number
  lod?: Lod
}

const _dir = new THREE.Vector3()

/** Tapered cylinder along +y from y0 to y1. */
function Spar({ r0, r1, y0, y1, material, radial }: { r0: number; r1: number; y0: number; y1: number; material: THREE.Material; radial: number }) {
  return (
    <mesh material={material} position-y={(y0 + y1) / 2} castShadow receiveShadow>
      <cylinderGeometry args={[r1, r0, y1 - y0, radial, 1]} />
    </mesh>
  )
}

/**
 * Mast with lower / top / topgallant sections, a round top at the doubling, crosstrees, yards with footropes,
 * blocks and sails. `snapped` hinges everything above the lower cap over to leeward and lets it hang by a stay.
 */
export function Mast({ position, height, livery, yards = [], sails = 1, snapped = 0, torn = 0, phase = 0, crowsNest = false, rake = 0, lod = 0 }: MastProps) {
  const m = shipMaterials(livery)
  const radial = lod === 0 ? 12 : lod === 1 ? 8 : 5
  const r0 = 0.03 + height * 0.011
  const lowerTop = height * 0.56
  const topTop = height * 0.84
  const platformR = Math.max(0.12, r0 * 3.2)

  const sailSpecs = useMemo(() => {
    const sorted = [...yards].sort((a, b) => a[1] - b[1])
    return sorted.map(([w, y], i) => {
      const below = i === 0 ? 0.42 : sorted[i - 1][1]
      const h = Math.min(w * 1.1, (y - below) * (i === 0 ? 0.74 : 0.86))
      return { w, y, h, upper: y > lowerTop, idx: i }
    })
  }, [yards, lowerTop])

  const renderYard = (spec: { w: number; y: number; h: number; idx: number }, localY: number) => {
    const yr = 0.016 + spec.w * 0.011
    return (
      <group key={spec.idx} position-y={localY}>
        <mesh material={m.spar} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[yr * 0.55, yr * 0.55, spec.w, radial, 1]} />
        </mesh>
        <mesh material={m.spar} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[yr, yr, spec.w * 0.5, radial, 1]} />
        </mesh>
        {/* parrel */}
        <mesh material={m.iron} rotation-x={Math.PI / 2}>
          <torusGeometry args={[yr + 0.012, 0.012, 5, 10]} />
        </mesh>
        <Sail width={spec.w * 0.94} height={spec.h} livery={livery} set={sails} torn={torn} phase={phase + spec.idx * 1.7} lod={lod} />
        {lod < 2 && (
          <>
            <Rope from={[0, -0.01, -spec.w / 2 + 0.05]} to={[0, -0.01, -0.06]} sag={0.09} livery={livery} radius={0.008} lod={lod} />
            <Rope from={[0, -0.01, 0.06]} to={[0, -0.01, spec.w / 2 - 0.05]} sag={0.09} livery={livery} radius={0.008} lod={lod} />
            <Block position={[0, -0.06, -spec.w / 2 + 0.02]} livery={livery} size={0.07} />
            <Block position={[0, -0.06, spec.w / 2 - 0.02]} livery={livery} size={0.07} />
            {/* lifts */}
            <Rope from={[0, 0.02, -spec.w / 2 + 0.02]} to={[0, Math.min(height - localY - 0.02, spec.h * 0.6 + 0.3), 0]} sag={0.01} livery={livery} radius={0.006} lod={lod} />
            <Rope from={[0, 0.02, spec.w / 2 - 0.02]} to={[0, Math.min(height - localY - 0.02, spec.h * 0.6 + 0.3), 0]} sag={0.01} livery={livery} radius={0.006} lod={lod} />
          </>
        )}
      </group>
    )
  }

  const lowerYards = sailSpecs.filter((s) => !s.upper)
  const upperYards = sailSpecs.filter((s) => s.upper)
  const breakAngle = snapped * 1.65
  const hangFrom: Vec3 = [0, lowerTop + 0.05, 0]
  _dir.set(Math.sin(breakAngle) * (height - lowerTop) * 0.7, lowerTop + Math.cos(breakAngle) * (height - lowerTop) * 0.7 - snapped * 0.25, 0)

  return (
    <group position={position} rotation-z={-rake}>
      {/* lower mast + partners */}
      <Spar r0={r0} r1={r0 * 0.78} y0={0} y1={lowerTop + 0.08} material={m.spar} radial={radial} />
      <mesh material={m.oak} position-y={0.06} receiveShadow castShadow>
        <cylinderGeometry args={[r0 * 1.8, r0 * 2.1, 0.12, 8]} />
      </mesh>
      {lod < 2 &&
        [0.25, 0.5, 0.75].map((f) => (
          <mesh key={f} material={m.iron} position-y={lowerTop * f}>
            <cylinderGeometry args={[r0 * (1 - 0.22 * f) + 0.006, r0 * (1 - 0.22 * f) + 0.006, 0.04, radial]} />
          </mesh>
        ))}
      {lowerYards.map((s) => renderYard(s, s.y))}
      {/* top platform + cap */}
      {lod < 2 && (
        <group position-y={lowerTop}>
          <mesh material={m.deck} castShadow receiveShadow>
            <cylinderGeometry args={[platformR, platformR * 0.9, 0.035, crowsNest ? 16 : 8]} />
          </mesh>
          {crowsNest && (
            <mesh material={m.oak} position-y={0.14} castShadow>
              <cylinderGeometry args={[platformR * 1.02, platformR * 0.95, 0.26, 16, 1, true]} />
            </mesh>
          )}
          {!crowsNest && (
            <mesh material={m.oak} position-y={0.045}>
              <torusGeometry args={[platformR * 0.92, 0.012, 5, 16]} />
            </mesh>
          )}
          <mesh material={m.oak} position={[r0 * 0.6, 0.11, 0]} castShadow>
            <boxGeometry args={[r0 * 3.6, 0.09, r0 * 2.4]} />
          </mesh>
        </group>
      )}
      {/* upper section (hinged for the snap) */}
      <group position-y={lowerTop} rotation-z={breakAngle} position-x={snapped * 0.06}>
        <group position-y={-snapped * 0.2}>
          <Spar r0={r0 * 0.68} r1={r0 * 0.5} y0={-0.25} y1={topTop - lowerTop + 0.05} material={m.spar} radial={radial} />
          {lod < 2 && (
            <mesh material={m.oak} position-y={topTop - lowerTop} castShadow>
              <boxGeometry args={[r0 * 3.2, 0.03, r0 * 4.4]} />
            </mesh>
          )}
          <Spar r0={r0 * 0.46} r1={r0 * 0.3} y0={topTop - lowerTop - 0.15} y1={height - lowerTop} material={m.spar} radial={radial} />
          <mesh material={m.oak} position-y={height - lowerTop + 0.01}>
            <cylinderGeometry args={[r0 * 0.7, r0 * 0.35, 0.03, 8]} />
          </mesh>
          {upperYards.map((s) => renderYard(s, s.y - lowerTop))}
        </group>
      </group>
      {snapped > 0.05 && lod < 2 && (
        <>
          <Rope from={hangFrom} to={[_dir.x, _dir.y, 0.02]} sag={0.06 * (1 - snapped)} livery={livery} radius={0.012} lod={lod} />
          <Rope from={[-0.02, lowerTop - 0.3, 0.03]} to={[_dir.x * 0.6, _dir.y * 0.9, 0.08]} sag={0.2} livery={livery} radius={0.009} lod={lod} />
          {/* splintered stump */}
          <mesh material={m.spar} position={[0.01, lowerTop + 0.12, 0]} rotation-z={0.25} castShadow>
            <coneGeometry args={[r0 * 0.7, 0.22, 5]} />
          </mesh>
        </>
      )}
    </group>
  )
}
