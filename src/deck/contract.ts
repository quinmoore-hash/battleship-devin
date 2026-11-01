/**
 * "On deck" first-person mode — shared contract (types only, no runtime behaviour).
 *
 * Three sessions build against this file in parallel:
 *   A. src/deck/        DeckController (walk / look / collide / ship switching / cannon stations / click-a-square firing),
 *                       deck HUD, V toggle, settings, hot-seat per captain, How to play block.  Owns `DeckState` in the store.
 *   B. src/cinematics/  POV variants of every director sequence when `deck.on` (outgoing shot, incoming splash / hull hit,
 *                       sink → "abandon ship" → switch ship, victory / defeat), camera shake via `deckBus`, spatial audio.
 *   C. src/ships/       per-class `DeckAnchors` (walkable area, obstacles, stations, spawn), lod-0 deck dressing that only
 *                       mounts on the manned ship, horizon / fog / far-plane pass, perf budget per tier.
 *
 * Rules: ship space = bow +x, stern −x, centred at the origin, waterline y = 0 (see ARCHITECTURE.md). Eye height on deck
 * is EYE_HEIGHT above the deck (1 cell = 1 world unit ≈ 10 m, so a sailor is ~0.17 units tall). Deck mode is purely a
 * different seat: it never changes rules, odds or turn flow — every shot still goes through the store's fireAt / fireBroadside.
 */
import type { Vec3 } from '../scene/layout'

/** Camera eye height above `ShipAnchors.deckY`, ship units. */
export const EYE_HEIGHT = 0.17
/** Camera near plane while on deck (the default 0.1 clips the rail). */
export const DECK_NEAR = 0.01
/** Vertical field of view on deck, degrees. */
export const DECK_FOV = 70

/** Store slice owned by session A (`useGameStore().deck`). */
export interface DeckState {
  /** Deck view active. Toggled with V / the HUD button at any time during battle; never changes game state. */
  on: boolean
  /** `PlacedShip.uid` of the own ship the player stands on (the perspective captain's fleet in hot-seat), or null. */
  shipUid: string | null
  /** Index into `SHIPS[id].anchors.cannons` of the manned gun, or null while walking. */
  station: number | null
}

export const DEFAULT_DECK: DeckState = { on: false, shipUid: null, station: null }

/** Deck settings owned by session A, persisted with the other `Settings`. */
export interface DeckSettings {
  /** Mouse-look sensitivity multiplier, 0.2–3, default 1. */
  deckSensitivity: number
  deckInvertY: boolean
}

/** Store actions owned by session A. */
export interface DeckActions {
  /** Toggle the deck view; picks the first afloat own ship when `shipUid` is null or sunk. */
  setDeck: (on: boolean) => void
  /** Stand on another own, afloat ship (Tab cycles). Clears `station`. */
  boardShip: (uid: string) => void
  /** Man cannon `index` (null = step away and walk). */
  manStation: (index: number | null) => void
}

/** Per-class walkable-deck data owned by session C, added as `ShipAnchors.deck`. Ship space, metres = cells. */
export interface DeckAnchors {
  /** Where the player appears when boarding (typically the quarterdeck behind the helm). */
  spawn: Vec3
  /** Walkable region: a convex polygon in the x/z plane (CCW), at `ShipAnchors.deckY`. Multiple polygons = multiple deck levels joined by `ramps`. */
  walk: { points: [number, number][]; y: number }[]
  /** Short ramps/stairs between two walkable polygons: walking across the segment lerps y from `from.y` to `to.y`. */
  ramps: { from: number; to: number; a: [number, number]; b: [number, number] }[]
  /** Things you cannot walk through (masts, capstan, hatches): circles in x/z. */
  obstacles: { center: [number, number]; radius: number }[]
  /**
   * One entry per `ShipAnchors.cannons[i]`: where the gunner stands and the yaw (radians, ship space) they face when
   * manning it. `breech` (optional, session C) is the inboard end of that gun's barrel on its deck — the spot to mark /
   * walk to; the gun's side is `ShipAnchors.cannons[i].side`.
   */
  stations: { stand: Vec3; yaw: number; breech?: Vec3 }[]
}

/** Fallback used by session A until a class ships real `DeckAnchors`: a rectangle `length × beam` at `deckY`, masts as obstacles. */
export const DECK_ANCHORS_FALLBACK = 'rect-from-hull' as const

/** Events session B raises and session A's DeckController consumes (camera owner stays the controller). */
export type DeckBusEvent =
  /** Camera shake, 0–1 intensity, seconds. Reduced motion → intensity 0. */
  | { type: 'shake'; intensity: number; seconds: number }
  /** Nudge the player's look direction toward a world point over `seconds` (e.g. the incoming ball, the sinking ship). */
  | { type: 'look-at'; point: Vec3; seconds: number }
  /** The ship the player stands on has sunk: play the abandon-ship beat then `boardShip(nextUid)` (null = no ship left, game over handles it). */
  | { type: 'abandon-ship'; nextUid: string | null }
  /**
   * Session B addition: the director borrows the camera for a follow-cam (a shot while on deck) and hands it back when the
   * sequence returns to the deck. `deckCameraLease.owner` mirrors the last event; the camera owner stands down while it is `'director'`.
   */
  | { type: 'camera'; owner: 'director' | 'deck' }
  /**
   * Session B addition: the incoming ball struck the hull section the player stood on (or the gun they manned). The director
   * plays the tumble / swim beat and then calls `boardShip(nextUid)` itself (`nextUid` = next afloat own ship, or the same ship
   * when it is the last one afloat); the camera owner may play its own tumble in either view.
   */
  | { type: 'thrown-overboard'; nextUid: string; cell: number; point: Vec3; seconds?: number }

type Listener = (e: DeckBusEvent) => void
const listeners = new Set<Listener>()

/** Tiny synchronous event bus. Session A subscribes in DeckController; session B emits from sequences. */
export const deckBus = {
  on(fn: Listener): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  emit(e: DeckBusEvent): void {
    for (const fn of listeners) fn(e)
  },
  /**
   * Session A addition: true while a consumer (the mounted DeckController) is subscribed. The store uses it to decide
   * whether a sunk standing ship is handed over by an `abandon-ship` beat (listener present) or switched at once (none).
   */
  hasListeners(): boolean {
    return listeners.size > 0
  },
}

/** Who drives the camera on deck right now (see the `camera` bus event). Written by the director, read by the camera owner. */
export const deckCameraLease: { owner: 'deck' | 'director' } = { owner: 'deck' }
