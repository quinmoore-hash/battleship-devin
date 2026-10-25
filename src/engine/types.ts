export const BOARD_SIZE = 10

export interface Coord {
  x: number
  y: number
}

export type Orientation = 'horizontal' | 'vertical'

export type ShipId =
  | 'kelp-carrier'
  | 'clam-cruiser'
  | 'driftwood-destroyer'
  | 'stream-sub'
  | 'pebble-patrol'

export interface ShipSpec {
  id: ShipId
  name: string
  length: number
  description: string
}

export interface PlacedShip {
  spec: ShipSpec
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

export type Player = 'human' | 'otter'

export type CellView = 'unknown' | 'miss' | 'hit' | 'sunk'
