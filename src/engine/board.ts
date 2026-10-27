import { FLEET, fleetUnits } from './fleet'
import {
  BOARD_SIZE,
  type Board,
  type CellView,
  type Coord,
  type EnemyBoardView,
  type Orientation,
  type PlacedShip,
  type ShipSpec,
  type ShotResult,
} from './types'

export const coordKey = (c: Coord): string => `${c.x},${c.y}`

export const sameCoord = (a: Coord, b: Coord): boolean => a.x === b.x && a.y === b.y

export const inBounds = (c: Coord, size = BOARD_SIZE): boolean =>
  c.x >= 0 && c.y >= 0 && c.x < size && c.y < size

export function createBoard(size = BOARD_SIZE): Board {
  return { size, ships: [], shots: [] }
}

export function shipCells(spec: ShipSpec, origin: Coord, orientation: Orientation): Coord[] {
  const cells: Coord[] = []
  for (let i = 0; i < spec.length; i++) {
    cells.push(
      orientation === 'horizontal'
        ? { x: origin.x + i, y: origin.y }
        : { x: origin.x, y: origin.y + i },
    )
  }
  return cells
}

/** `uid` = the ship instance being (re)placed; defaults to the class id (classic fleets). */
export function canPlace(
  board: Board,
  spec: ShipSpec,
  origin: Coord,
  orientation: Orientation,
  uid: string = spec.id,
): boolean {
  const cells = shipCells(spec, origin, orientation)
  if (!cells.every((c) => inBounds(c, board.size))) return false
  const occupied = new Set(
    board.ships.filter((s) => s.uid !== uid).flatMap((s) => s.cells.map(coordKey)),
  )
  return cells.every((c) => !occupied.has(coordKey(c)))
}

/** Returns a new board with the ship placed (replacing any previous placement of the same `uid`). */
export function placeShip(
  board: Board,
  spec: ShipSpec,
  origin: Coord,
  orientation: Orientation,
  uid: string = spec.id,
): Board {
  if (!canPlace(board, spec, origin, orientation, uid)) {
    throw new Error(`Cannot place ${uid} at ${coordKey(origin)} ${orientation}`)
  }
  const ship: PlacedShip = {
    spec,
    uid,
    origin,
    orientation,
    cells: shipCells(spec, origin, orientation),
    hits: [],
  }
  return {
    ...board,
    ships: [...board.ships.filter((s) => s.uid !== uid), ship],
  }
}

/** Removes the ship with this `uid` (a class id removes the first ship of that class, as before). */
export function removeShip(board: Board, uid: string): Board {
  return { ...board, ships: board.ships.filter((s) => s.uid !== uid) }
}

/** Every unit of `fleet` is on the board (by `uid`, so a Wolf pack needs all four sloops). */
export const isFleetPlaced = (board: Board, fleet: readonly ShipSpec[] = FLEET): boolean =>
  fleetUnits(fleet).every((u) => board.ships.some((s) => s.uid === u.uid))

export function randomPlacement(
  rng: () => number = Math.random,
  fleet: readonly ShipSpec[] = FLEET,
  size = BOARD_SIZE,
): Board {
  let board = createBoard(size)
  for (const { spec, uid } of fleetUnits(fleet)) {
    let placed = false
    for (let attempt = 0; attempt < 1000 && !placed; attempt++) {
      const orientation: Orientation = rng() < 0.5 ? 'horizontal' : 'vertical'
      const origin = { x: Math.floor(rng() * size), y: Math.floor(rng() * size) }
      if (canPlace(board, spec, origin, orientation, uid)) {
        board = placeShip(board, spec, origin, orientation, uid)
        placed = true
      }
    }
    if (!placed) throw new Error(`Failed to place ${uid}`)
  }
  return board
}

export const hasBeenShot = (board: Board, coord: Coord): boolean =>
  board.shots.some((s) => sameCoord(s.coord, coord))

export const shipAt = (board: Board, coord: Coord): PlacedShip | undefined =>
  board.ships.find((s) => s.cells.some((c) => sameCoord(c, coord)))

export const isSunk = (ship: PlacedShip): boolean => ship.hits.length >= ship.spec.length

export const isFleetSunk = (board: Board): boolean =>
  board.ships.length > 0 && board.ships.every(isSunk)

/** Fires at `coord` on `board`. Returns the updated board and the shot result. */
export function fire(board: Board, coord: Coord): { board: Board; result: ShotResult } {
  if (!inBounds(coord, board.size)) throw new Error(`Shot out of bounds: ${coordKey(coord)}`)
  if (hasBeenShot(board, coord)) throw new Error(`Already fired at ${coordKey(coord)}`)

  const target = shipAt(board, coord)
  if (!target) {
    const result: ShotResult = { coord, outcome: 'miss' }
    return { board: { ...board, shots: [...board.shots, result] }, result }
  }

  const hitShip: PlacedShip = { ...target, hits: [...target.hits, coord] }
  const result: ShotResult = {
    coord,
    outcome: isSunk(hitShip) ? 'sunk' : 'hit',
    shipId: target.spec.id,
    shipUid: target.uid,
  }
  return {
    board: {
      ...board,
      ships: board.ships.map((s) => (s.uid === target.uid ? hitShip : s)),
      shots: [...board.shots, result],
    },
    result,
  }
}

/** The attacker's knowledge of `board`. */
export function enemyView(board: Board): EnemyBoardView {
  return {
    size: board.size,
    shots: board.shots,
    remainingShips: board.ships.filter((s) => !isSunk(s)).map((s) => s.spec),
  }
}

/** The ship a hit belongs to: its `uid` when known, else the class id (older replays, hand-made results). */
export const shotShipKey = (s: ShotResult): string | undefined => s.shipUid ?? s.shipId

/** size x size grid of what the attacker can see. Indexed [y][x]. */
export function viewGrid(view: EnemyBoardView, board?: Board): CellView[][] {
  const grid: CellView[][] = Array.from({ length: view.size }, () =>
    Array.from({ length: view.size }, () => 'unknown' as CellView),
  )
  const sunkIds = new Set(view.shots.filter((s) => s.outcome === 'sunk').map(shotShipKey))
  for (const shot of view.shots) {
    grid[shot.coord.y][shot.coord.x] =
      shot.outcome === 'miss' ? 'miss' : shot.shipId && sunkIds.has(shotShipKey(shot)) ? 'sunk' : 'hit'
  }
  if (board) {
    for (const ship of board.ships) {
      if (isSunk(ship)) for (const c of ship.cells) grid[c.y][c.x] = 'sunk'
    }
  }
  return grid
}

export const allCoords = (size = BOARD_SIZE): Coord[] =>
  Array.from({ length: size * size }, (_, i) => ({ x: i % size, y: Math.floor(i / size) }))

export const neighbors = (c: Coord, size = BOARD_SIZE): Coord[] =>
  [
    { x: c.x + 1, y: c.y },
    { x: c.x - 1, y: c.y },
    { x: c.x, y: c.y + 1 },
    { x: c.x, y: c.y - 1 },
  ].filter((n) => inBounds(n, size))

/** Column letter + row number, e.g. {x:0,y:0} -> "A1". */
export const coordLabel = (c: Coord): string => `${String.fromCharCode(65 + c.x)}${c.y + 1}`

/**
 * Black Flag — Broadside: the 3 cells centred on `target` along a row (`horizontal`) or column (`vertical`),
 * clipped to the board. Pure; the store skips cells already shot.
 */
export function broadsideCells(target: Coord, orientation: Orientation, size = BOARD_SIZE): Coord[] {
  const out: Coord[] = []
  for (let i = -1; i <= 1; i++) {
    const c = orientation === 'horizontal' ? { x: target.x + i, y: target.y } : { x: target.x, y: target.y + i }
    if (inBounds(c, size)) out.push(c)
  }
  return out
}

/** Chebyshev adjacency (shares an edge or a corner). */
export const touching = (a: Coord, b: Coord): boolean => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1

/**
 * Black Flag — treasure: `count` chests on open-water cells of `board` (never under a ship, never touching each
 * other), drawn with `rng` so a seeded game is reproducible. Deterministic given the same board + rng sequence.
 */
export function treasureCells(board: Board, rng: () => number, count = 2): Coord[] {
  const occupied = new Set(board.ships.flatMap((s) => s.cells.map(coordKey)))
  let open = allCoords(board.size).filter((c) => !occupied.has(coordKey(c)))
  const out: Coord[] = []
  while (out.length < count && open.length > 0) {
    const pick = open[Math.floor(rng() * open.length)]
    out.push(pick)
    open = open.filter((c) => !touching(c, pick))
  }
  return out
}

export const hasTreasureAt = (treasure: readonly Coord[], c: Coord): boolean => treasure.some((t) => sameCoord(t, c))
