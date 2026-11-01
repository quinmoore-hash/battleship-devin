/**
 * Distance-based ship LOD with hysteresis. Pure so it is unit-tested; `useDistanceLod` in
 * `LodShip.tsx` drives it from the camera each frame.
 */
import type { Lod } from '../ships/types'

export interface LodThresholds {
  /** Camera distance (world units) beyond which lod 1 is used, scaled by the hull length. */
  mid: number
  /** Distance beyond which lod 2 is used. */
  far: number
  /** Fraction of the threshold the camera must come back by before switching to a finer level. */
  hysteresis: number
  /** Minimum seconds between two switches (no popping within 1 s). */
  dwell: number
}

// Tuned against the real battle cameras (BUG-706): `CAMERA_SHOTS.battle` / `battle-far` sit 16.5 units up and 21.5
// units behind the near board, so hulls are 23–44 units away at the overview. lod 1 is the visually complete baked
// ship and must cover that whole range for every hull length (the sloop scales thresholds by 2/3); lod 2 is only the
// genuinely far silhouette (OrbitControls zoomed all the way out, or the Low tier cap). lod 0 stays reserved for the
// cinematic close-ups so the High tier does not raise the overview budget.
export const LOD_THRESHOLDS: LodThresholds = { mid: 6, far: 80, hysteresis: 0.15, dwell: 1 }

/** Target level for a ship of `hullLength` cells at `distance`, ignoring hysteresis. */
export function lodForDistance(distance: number, hullLength: number, t: LodThresholds = LOD_THRESHOLDS): Lod {
  const scale = Math.max(1, hullLength) / 3
  if (distance > t.far * scale) return 2
  if (distance > t.mid * scale) return 1
  return 0
}

export interface LodState {
  lod: Lod
  /** Time of the last switch (seconds). */
  since: number
}

/**
 * Next LOD given the current state. Coarser levels switch as soon as the dwell time allows;
 * finer levels also need the camera to come `hysteresis` closer than the threshold, so a
 * camera hovering around a boundary never flickers. `maxDetail` is the tier cap (0 = full).
 */
export function stepLod(state: LodState, distance: number, hullLength: number, now: number, maxDetail: Lod = 0, t: LodThresholds = LOD_THRESHOLDS): LodState {
  const target = Math.max(maxDetail, lodForDistance(distance, hullLength, t)) as Lod
  if (target === state.lod) return state
  if (now - state.since < t.dwell) return state
  if (target < state.lod) {
    const scale = Math.max(1, hullLength) / 3
    const threshold = (state.lod === 2 ? t.far : t.mid) * scale
    if (distance > threshold * (1 - t.hysteresis)) return state
  }
  return { lod: target, since: now }
}
