export const BOARD_SIZE = 10

export interface Coord {
  x: number
  y: number
}

export type Orientation = 'horizontal' | 'vertical'

export type ShipId = 'man-o-war' | 'galleon' | 'frigate' | 'brigantine' | 'sloop'

export interface ShipSpec {
  id: ShipId
  name: string
  length: number
  description: string
}

export interface PlacedShip {
  spec: ShipSpec
  /**
   * Unique per board: `spec.id` for the first ship of a class, `spec.id#2`, `#3`… for repeats (Black Flag fleets may
   * carry two Men-o'-War or four Sloops). Everything that keys per-ship state (sink progress, firing, flotsam, replay)
   * uses it; in a classic fleet it is always equal to `spec.id`.
   */
  uid: string
  origin: Coord
  orientation: Orientation
  cells: Coord[]
  hits: Coord[]
}

export type ShotOutcome = 'miss' | 'hit' | 'sunk'

export interface ShotResult {
  coord: Coord
  outcome: ShotOutcome
  /** Set when outcome is 'hit' or 'sunk'. */
  shipId?: ShipId
  /** The hit ship's `PlacedShip.uid` (same as `shipId` unless the fleet repeats a class). */
  shipUid?: string
}

export interface Board {
  size: number
  ships: PlacedShip[]
  /** Every shot the opponent has fired at this board, in order. */
  shots: ShotResult[]
}

/** What a player knows about the enemy board: only the shots they have fired. */
export interface EnemyBoardView {
  size: number
  shots: ShotResult[]
  /** Ships the enemy still has afloat (length is public knowledge in Battleship). */
  remainingShips: ShipSpec[]
}

export type Difficulty = 'easy' | 'medium' | 'hard'

/** `human` is the pirate player; `enemy` is the AI-controlled Royal Navy fleet. */
export type Player = 'human' | 'enemy'

export type CellView = 'unknown' | 'miss' | 'hit' | 'sunk'
