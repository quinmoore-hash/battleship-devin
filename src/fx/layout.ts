import { BOARD_SIZE, type Coord, type Orientation, type PlacedShip, type ShipSpec } from '../engine'

export type Vec3 = [number, number, number]

/**
 * Fallback board layout. The scene module exports the canonical `BOARD_LAYOUT` and
 * `cellToWorld`; integration should swap these for the scene exports once they land.
 * Cell size 1, the player board centred on the origin, Devin's board 14 units further
 * away from the camera (negative z).
 */
export interface BoardLayout {
  cellSize: number
  boardSize: number
  player: { origin: Vec3 }
  otter: { origin: Vec3 }
}

export const BOARD_LAYOUT: BoardLayout = {
  cellSize: 1,
  boardSize: BOARD_SIZE,
  player: { origin: [0, 0, 0] },
  otter: { origin: [0, 0, -14] },
}

/** World position of the centre of `coord` on a board whose centre is `origin`. */
export function cellToWorld(
  coord: Coord,
  origin: Vec3 = BOARD_LAYOUT.player.origin,
  cellSize: number = BOARD_LAYOUT.cellSize,
): Vec3 {
  const half = (BOARD_SIZE - 1) / 2
  return [
    origin[0] + (coord.x - half) * cellSize,
    origin[1],
    origin[2] + (coord.y - half) * cellSize,
  ]
}

/** Cells covered by a ship of `spec` placed at `origin` (duplicated from the engine so fx stays decoupled from placement validation). */
export function shipCells(spec: ShipSpec, origin: Coord, orientation: Orientation): Coord[] {
  return Array.from({ length: spec.length }, (_, i) => ({
    x: origin.x + (orientation === 'horizontal' ? i : 0),
    y: origin.y + (orientation === 'vertical' ? i : 0),
  }))
}

/** World position of the middle of a ship. */
export function shipCenter(
  spec: ShipSpec,
  origin: Coord,
  orientation: Orientation,
  boardOrigin: Vec3 = BOARD_LAYOUT.player.origin,
  cellSize: number = BOARD_LAYOUT.cellSize,
): Vec3 {
  const cells = shipCells(spec, origin, orientation)
  const a = cellToWorld(cells[0], boardOrigin, cellSize)
  const b = cellToWorld(cells[cells.length - 1], boardOrigin, cellSize)
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
}

/** Ships are modelled along their local +x axis; vertical ships are rotated to run along +z. */
export const shipRotationY = (orientation: Orientation): number =>
  orientation === 'horizontal' ? 0 : -Math.PI / 2

/** Index (0..length-1) of a cell along the ship, or -1 if the cell is not on the ship. */
export function cellIndexOnShip(ship: Pick<PlacedShip, 'origin' | 'orientation' | 'spec'>, cell: Coord): number {
  const i = ship.orientation === 'horizontal' ? cell.x - ship.origin.x : cell.y - ship.origin.y
  const other = ship.orientation === 'horizontal' ? cell.y - ship.origin.y : cell.x - ship.origin.x
  if (other !== 0 || i < 0 || i >= ship.spec.length) return -1
  return i
}

/** Local x offset (in world units) of the i-th cell from the ship's centre. */
export const cellOffsetAlongShip = (length: number, index: number, cellSize = BOARD_LAYOUT.cellSize): number =>
  (index - (length - 1) / 2) * cellSize

/** Small deterministic hash so each ship gets a stable per-ship animation phase. */
export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Stable bob/roll phase in [0, 2π) derived from the ship id and position. */
export const shipPhase = (ship: Pick<PlacedShip, 'spec' | 'origin'>): number =>
  ((hashString(`${ship.spec.id}:${ship.origin.x},${ship.origin.y}`) % 1000) / 1000) * Math.PI * 2

/** Deterministic PRNG (mulberry32) returning numbers in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
