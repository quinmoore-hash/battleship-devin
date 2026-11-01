import { coordKey, coordLabel, enemyView, fleetUnits, isSunk, viewGrid, type Board, type CellView, type Coord, type ShipSpec } from '../engine'
import type { GridCellInfo } from './Grid'

/** Hues cycle so a Black Flag fleet of seven still reads ship by ship. */
export const SHIP_HUES = 6

export interface OwnChartModel {
  /** `viewGrid(enemyView(board), board)`: enemy hits / misses, sunk ships expanded to every cell. */
  view: CellView[][]
  /** Own ship cell → `{ uid, hue, name }`. */
  ships: Map<string, { uid: string; hue: number; name: string }>
  /** Cells where the enemy found treasure (Black Flag). */
  chests: Set<string>
}

/**
 * The "Our waters" chart's data: what the enemy has done to this board. A Stormy-seas shot lost in the storm is
 * never recorded on the board, so it shows nothing — the same as the Enemy chart.
 */
export function ownChartModel(board: Board, fleet: readonly ShipSpec[], chests: ReadonlySet<string> = new Set()): OwnChartModel {
  const order = new Map(fleetUnits(fleet).map((u, i) => [u.uid, i]))
  const ships = new Map<string, { uid: string; hue: number; name: string }>()
  board.ships.forEach((ship, i) => {
    const hue = (order.get(ship.uid) ?? i) % SHIP_HUES
    for (const c of ship.cells) ships.set(coordKey(c), { uid: ship.uid, hue, name: ship.spec.name })
  })
  return { view: viewGrid(enemyView(board), board), ships, chests: new Set(chests) }
}

/** Read-only cell mapper for the own-waters `<Grid>`: ship (per-ship hue) / hit / miss / sunk / treasure. */
export function ownChartCell(model: OwnChartModel, c: Coord): GridCellInfo {
  const key = coordKey(c)
  const state = model.view[c.y][c.x]
  const ship = model.ships.get(key)
  const chest = model.chests.has(key)
  const classes: string[] = []
  if (ship) classes.push(`cell-own cell-own-${ship.hue}`)
  if (chest) classes.push('cell-treasure')
  const label = coordLabel(c)
  const title = chest
    ? `${label} — the enemy found treasure`
    : state === 'sunk'
      ? `${label} — ${ship?.name ?? 'ship'} sunk`
      : state === 'hit'
        ? `${label} — ${ship?.name ?? 'ship'} hit`
        : state === 'miss'
          ? `${label} — enemy miss`
          : ship
            ? `${label} — ${ship.name}`
            : undefined
  return {
    state: state === 'unknown' && ship ? 'ship' : state,
    className: classes.length ? classes.join(' ') : undefined,
    title,
  }
}

export interface FleetScore {
  afloat: number
  total: number
}

export function fleetScore(board: Board, fleet: readonly ShipSpec[]): FleetScore {
  return { afloat: board.ships.filter((s) => !isSunk(s)).length, total: fleetUnits(fleet).length }
}

/** "Your fleet 4 of 5 afloat · Enemy fleet 2 of 5 afloat" — the one-line read of who is winning. */
export function scoreStripText(mine: FleetScore, theirs: FleetScore, names: { me: string; foe: string } = { me: 'Your fleet', foe: 'Enemy fleet' }): string {
  return `${names.me} ${mine.afloat} of ${mine.total} afloat · ${names.foe} ${theirs.afloat} of ${theirs.total} afloat`
}

/** Who is ahead, for the strip's tint: more ships afloat wins the read; a tie is even. */
export function scoreLead(mine: FleetScore, theirs: FleetScore): 'ahead' | 'behind' | 'even' {
  return mine.afloat === theirs.afloat ? 'even' : mine.afloat > theirs.afloat ? 'ahead' : 'behind'
}
