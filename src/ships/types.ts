import type { ComponentType } from 'react'
import type { ShipId } from '../engine'
import type { Vec3 } from '../scene/layout'

/** One ship class per engine `ShipId`. */
export type ShipClass = ShipId

/** Who the ship belongs to. Pirates: dark hull, black sails, red trim, Jolly Roger. Navy: pale sails, blue/gold trim, ensign. */
export type Livery = 'pirate' | 'navy'

/** Damage of one cell-section of a ship, bow (index 0) to stern. */
export type CellDamage = 'intact' | 'hit' | 'burning'

export type Lod = 0 | 1 | 2

/**
 * Props every ship class component accepts. Conventions (DO NOT change without updating ARCHITECTURE.md):
 * - The model is built along local +x with the BOW at +x and the stern at -x, centred on the origin.
 * - One world unit per grid cell: a length-N ship spans x in [-N/2, +N/2]. Beam/height are free.
 * - y = 0 is the resting waterline. Everything below y=0 is underwater.
 * - The model must NOT translate/rotate its own root for bobbing or sinking; `<Fleet>` / the sinking VFX
 *   own the root transform. The model only changes its *shape* (torn sails, snapped masts, holes) from props.
 */
export interface ShipModelProps {
  livery: Livery
  /** `damage.length === spec.length`. Index 0 is the bow section. */
  damage: readonly CellDamage[]
  /** 0 = afloat … 1 = fully sunk. Models snap masts / shred sails / darken as this grows. */
  sinkProgress?: number
  /** 0 = full detail (close-up), 2 = silhouette (far / low-end GPU). */
  lod?: Lod
  quality?: 'low' | 'high'
  /** Sails set: 0 furled … 1 full. Default 1. */
  sails?: number
  /** Seconds offset so flags/sails on different ships don't flap in sync. */
  phase?: number
  /** Which cannons are recoiling right now (cell index + side), driven by the cinematic director. */
  firing?: readonly CannonRef[]
}

export type Side = 'port' | 'starboard'

export interface CannonRef {
  cell: number
  side: Side
}

/** Local-space anchor points the cinematics/VFX need, in the model's own frame (see ShipModelProps). */
export interface ShipAnchors {
  /** Every cannon: cell index along the ship, side, muzzle position and the direction it fires. */
  cannons: { cell: number; side: Side; muzzle: Vec3; direction: Vec3 }[]
  /** Base of each mast, bow to stern. Masts snap during sinking. */
  masts: { base: Vec3; height: number }[]
  /** Main deck height above the waterline. Fires/splinters spawn here. */
  deckY: number
  /** Overall hull size for camera framing and LOD switching. */
  hull: { length: number; beam: number; height: number; draft: number }
  /** Where a cannonball hitting cell `i` should impact (hull side at the waterline-ish), per cell, port side. Mirror z for starboard. */
  impactPoints: Vec3[]
}

export interface ShipDefinition {
  id: ShipClass
  /** Human-readable, e.g. "Man-o’-War". */
  name: string
  length: number
  Model: ComponentType<ShipModelProps>
  anchors: ShipAnchors
}
