import { BOARD_SIZE, canPlace, shipCells, type Board, type Coord, type Orientation, type ShipSpec } from '../engine'

/** Shift the origin so the whole ship stays on the board when hovering near an edge. */
export function clampOrigin(hover: Coord, length: number, orientation: Orientation, size = BOARD_SIZE): Coord {
  return orientation === 'horizontal'
    ? { x: Math.min(hover.x, size - length), y: hover.y }
    : { x: hover.x, y: Math.min(hover.y, size - length) }
}

export interface Footprint {
  origin: Coord
  cells: Coord[]
  valid: boolean
}

/**
 * Where a ship would land if dropped with the pointer over `hover`. `grab` is the cell index along
 * the ship the player grabbed it by (0 = first cell), so a dragged ship stays under the hand.
 */
export function footprintAt(board: Board, spec: ShipSpec, hover: Coord, orientation: Orientation, grab = 0, size = BOARD_SIZE): Footprint {
  const g = Math.max(0, Math.min(spec.length - 1, grab))
  const anchor = orientation === 'horizontal' ? { x: hover.x - g, y: hover.y } : { x: hover.x, y: hover.y - g }
  const clamped = { x: Math.max(0, anchor.x), y: Math.max(0, anchor.y) }
  const origin = clampOrigin(clamped, spec.length, orientation, size)
  return { origin, cells: shipCells(spec, origin, orientation), valid: canPlace(board, spec, origin, orientation) }
}
