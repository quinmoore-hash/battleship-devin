import { useMemo } from 'react'
import type { Vec3 } from '../../scene/layout'
import type { CellDamage } from '../../ships/types'
import { useGameStore } from '../../store/gameStore'
import { SmokeColumn } from '../ParticleFx'
import { footprintCenters } from './debris'
import { cellX, sectionSurfaceY, type SinkPose } from './pose'

export interface SteamProps {
  pose: SinkPose
  damage: readonly CellDamage[]
  /** World position / heading of the ship root and its deck height. */
  position: Vec3
  rotationY: number
  deckY: number
  /** Live water level. */
  waterY?: number
}

/** Hiss strength of a deck section whose height above the water is `y`: peaks as it goes under. */
export function hissIntensity(y: number): number {
  const d = Math.abs(y - 0.02) / 0.32
  return d >= 1 ? 0 : 1 - d * d
}

/**
 * White steam where burning sections meet the water. Fires are owned by the damage VFX; this only
 * renders the hiss, driven from the pose (so scrubbing the sequence is exact).
 */
export function Steam({ pose, damage, position, rotationY, deckY, waterY = 0 }: SteamProps) {
  const reduced = useGameStore((s) => s.settings.reducedMotion)
  const n = damage.length
  const centers = useMemo(() => footprintCenters(position, rotationY, n), [position, rotationY, n])
  const puffs: { at: Vec3; k: number; seed: number }[] = []
  for (let i = 0; i < n; i++) {
    if (damage[i] !== 'burning') continue
    const y = position[1] + sectionSurfaceY(pose, cellX(i, n), deckY) - waterY
    const k = hissIntensity(y)
    if (k > 0.02) puffs.push({ at: [centers[i][0], waterY + 0.05, centers[i][2]], k, seed: i })
  }
  // the whole deck flooding at once gives one last big gasp of steam from amidships
  const midY = position[1] + sectionSurfaceY(pose, 0, deckY) - waterY
  const gasp = hissIntensity(midY) * (damage.some((d) => d !== 'intact') ? 1 : 0.5)
  return (
    <group>
      {puffs.map((p) => (
        <SmokeColumn key={p.seed} position={p.at} color="#f1f6f8" opacity={0.5} intensity={p.k * (reduced ? 0.6 : 1)} count={reduced ? 6 : 10} period={1.3} height={0.9} drift={0.2} baseScale={0.11} seed={p.seed * 3} />
      ))}
      {gasp > 0.02 && (
        <SmokeColumn position={[position[0], waterY + 0.05, position[2]]} color="#eef3f5" opacity={0.42} intensity={gasp * 1.2} count={reduced ? 8 : 14} period={2} height={1.4} drift={0.4} baseScale={0.18} seed={99} />
      )}
    </group>
  )
}
