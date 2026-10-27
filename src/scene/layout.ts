import type { Coord } from '../engine'

/** World-space position as an `[x, y, z]` tuple. */
export type Vec3 = [number, number, number]

export interface BoardPlacement {
  /** World position of the board's (0,0) corner: min x / min z. Row `y` grows toward +z (toward the camera). */
  origin: Vec3
  /** Cells per side (always 10 in Battleship). */
  size: number
  /** World units per cell. */
  cellSize: number
}

/**
 * Where the two boards float on the bay. The boards are stacked front/back: the human's
 * fleet is near the camera (+z) and enemy's waters are across the gap behind it (-z), so the
 * battle camera looks "across the water" at the enemy. Both share x extents [-5, 5].
 *
 *   z = -13 ┌──────────┐  enemy's board  (rows 1..10 run toward the camera)
 *   z =  -3 └──────────┘
 *             ~ gap ~
 *   z =   1 ┌──────────┐  player's board
 *   z =  11 └──────────┘
 *
 * `cellToWorld(coord, origin, cellSize)` gives the centre of a cell on either board.
 */
/**
 * Boards, ships and markers sit this far above the resting water (y = 0). Ship models put their
 * waterline at local y = 0, so this must stay near zero or hulls hover above the sea (BUG-110b);
 * the grid ropes/floats and the fleet both ride the same wave bank on top of it.
 */
export const SURFACE_Y = 0.04

export const BOARD_LAYOUT = {
  /** The human's own fleet (the enemy fires at it). Nearest the camera. */
  player: { origin: [-5, SURFACE_Y, 1] as Vec3, size: 10, cellSize: 1 } satisfies BoardPlacement,
  /** The enemy's waters (the human fires at it). Across the gap, further from the camera. */
  enemy: { origin: [-5, SURFACE_Y, -13] as Vec3, size: 10, cellSize: 1 } satisfies BoardPlacement,
  /** Open water between the two boards, in world units along z. */
  gap: 4,
  /** Height above the resting water line at which boards, ships and markers sit (see SURFACE_Y). */
  surfaceY: SURFACE_Y,
} as const

export type BoardKey = keyof Pick<typeof BOARD_LAYOUT, 'player' | 'enemy'>

/** World-space centre of `coord` on a board whose (0,0) corner is at `origin`. */
export function cellToWorld(coord: Coord, origin: Vec3, cellSize = 1): Vec3 {
  return [origin[0] + (coord.x + 0.5) * cellSize, origin[1], origin[2] + (coord.y + 0.5) * cellSize]
}

/** Inverse of `cellToWorld`: the cell under a world point, or null when outside the board. */
export function worldToCell(point: { x: number; z: number }, origin: Vec3, cellSize = 1, size = 10): Coord | null {
  const x = Math.floor((point.x - origin[0]) / cellSize)
  const y = Math.floor((point.z - origin[2]) / cellSize)
  if (x < 0 || y < 0 || x >= size || y >= size) return null
  return { x, y }
}

/** Centre of a whole board (handy for camera targets and the mascot). */
export function boardCenter(board: BoardPlacement): Vec3 {
  const half = (board.size * board.cellSize) / 2
  return [board.origin[0] + half, board.origin[1], board.origin[2] + half]
}

/** Axis-aligned world bounds of a board: `[minX, minZ, maxX, maxZ]`. */
export function boardBounds(board: BoardPlacement): [number, number, number, number] {
  const extent = board.size * board.cellSize
  return [board.origin[0], board.origin[2], board.origin[0] + extent, board.origin[2] + extent]
}
