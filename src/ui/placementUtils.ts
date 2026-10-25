import { BOARD_SIZE, type Coord, type Orientation } from '../engine'

/** Shift the origin so the whole ship stays on the board when hovering near an edge. */
export function clampOrigin(hover: Coord, length: number, orientation: Orientation, size = BOARD_SIZE): Coord {
  return orientation === 'horizontal'
    ? { x: Math.min(hover.x, size - length), y: hover.y }
    : { x: hover.x, y: Math.min(hover.y, size - length) }
}
