import type { Coord, PlacedShip, ShotResult } from '../engine'

/**
 * Placeholder for ship models, Devin-the-Otter mascot and visual effects.
 * The fx child session replaces these with real 3D models / sprites and particle VFX.
 * Keep the public API stable so UI and integration can code against it.
 */
export interface FleetProps {
  ships: PlacedShip[]
  /** true for the human's own fleet (always visible); false renders only sunk enemy ships. */
  revealed: boolean
}
export function Fleet(_props: FleetProps) {
  return null
}

export interface ShotMarkersProps {
  shots: ShotResult[]
  /** World-space offset of the board this belongs to. */
  offset?: Coord
}
export function ShotMarkers(_props: ShotMarkersProps) {
  return null
}

export type OtterMood = 'idle' | 'cheer' | 'grumble' | 'taunt' | 'victory' | 'defeat'
export function OtterMascot(_props: { mood: OtterMood }) {
  return null
}
