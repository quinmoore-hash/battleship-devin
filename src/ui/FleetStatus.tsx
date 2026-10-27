import { fleetUnits, FLEET, isSunk, type Board, type PlacedShip, type ShipSpec } from '../engine'

interface FleetStatusProps {
  board: Board
  /** The fleet this side placed (Black Flag presets repeat classes); defaults to the classic `FLEET`. */
  fleet?: readonly ShipSpec[]
  side: 'player' | 'enemy'
  title: string
}

export function FleetStatus({ board, side, title, fleet = FLEET }: FleetStatusProps) {
  const byUid = new Map<string, PlacedShip>(board.ships.map((s) => [s.uid, s]))
  const units = fleetUnits(fleet)
  const afloat = board.ships.filter((s) => !isSunk(s)).length
  const totalHits = board.ships.reduce((n, s) => n + s.hits.length, 0)
  return (
    <section className={`fleet-status side-${side}`} data-testid={`fleet-status-${side}`}>
      <header>
        <h3>{title}</h3>
        <span className="count" data-testid={`fleet-status-${side}-afloat`}>
          {afloat}/{units.length} afloat
        </span>
        {side === 'enemy' && (
          <span className="count hits" data-testid="fleet-status-enemy-hits">
            {totalHits} {totalHits === 1 ? 'hit' : 'hits'}
          </span>
        )}
      </header>
      <ul>
        {units.map(({ spec, uid }) => {
          const ship = byUid.get(uid)
          const sunk = ship ? isSunk(ship) : false
          // the enemy fleet stays hidden until a ship goes down: no per-ship damage before the sunk reveal (BUG-303)
          const hits = side === 'enemy' && !sunk ? 0 : (ship?.hits.length ?? 0)
          const hidden = side === 'enemy' && !sunk
          return (
            <li
              key={uid}
              className={sunk ? 'sunk' : hits > 0 ? 'damaged' : ''}
              data-testid={`fleet-status-${side}-${uid}`}
              data-sunk={sunk}
              aria-label={`${spec.name}: ${sunk ? 'sunk' : hidden ? `${spec.length} cells, afloat` : `${hits} of ${spec.length} hit`}`}
            >
              <span className="silhouette" aria-hidden>
                {Array.from({ length: spec.length }, (_, i) => (
                  <i key={i} className={i < hits ? 'hit' : ''} />
                ))}
              </span>
              <span className="name">{spec.name}</span>
              <span className="len">{sunk ? 'sunk' : hidden ? `${spec.length} · ?` : spec.length}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
