/**
 * The two lenses the one scene camera wears: the overview rig's (near 0.5 / far 1500) and the deck's (near 0.03 / far 300,
 * fov 70). Everyone who hands the camera to or from the deck goes through here — `DeckController`, `CinematicCamera`'s
 * follow-cam hand-back, the demos — so the near/far pair can never drift apart again (BUG-7xx: the deck set near 0.02 and
 * left far at 1500; the demos used near 0.01).
 */
import { DECK_FAR, DECK_FOV, DECK_NEAR, OVERVIEW_FAR, OVERVIEW_NEAR } from './contract'

export interface Lens {
  near: number
  far: number
  fov: number
  updateProjectionMatrix(): void
}

/** True when `camera` already wears the deck near/far (the fov is checked separately: a follow-cam blends it). */
export const hasDeckLens = (camera: Pick<Lens, 'near' | 'far'>): boolean => camera.near === DECK_NEAR && camera.far === DECK_FAR

/** Put the deck lens on; returns whether anything changed (the projection matrix is only rebuilt then). */
export function applyDeckLens(camera: Lens, fov = DECK_FOV): boolean {
  if (hasDeckLens(camera) && camera.fov === fov) return false
  camera.near = DECK_NEAR
  camera.far = DECK_FAR
  camera.fov = fov
  camera.updateProjectionMatrix()
  return true
}

/** Give the overview its near/far back (the rig owns the fov). */
export function applyOverviewLens(camera: Lens): boolean {
  if (camera.near === OVERVIEW_NEAR && camera.far === OVERVIEW_FAR) return false
  camera.near = OVERVIEW_NEAR
  camera.far = OVERVIEW_FAR
  camera.updateProjectionMatrix()
  return true
}

/** Depth resolution (world units) of a `bits`-bit depth buffer at view distance `z` for a perspective lens. */
export const depthResolution = (z: number, near: number, far: number, bits = 24): number => (z * z * (far - near)) / (2 * far * near * 2 ** bits)
