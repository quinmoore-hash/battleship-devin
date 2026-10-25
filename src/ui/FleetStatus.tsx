import { FLEET, isSunk, type Board, type PlacedShip } from '../engine'

interface FleetStatusProps {
  board: Board
  side: 'player' | 'enemy'
  title: string
}

export function FleetStatus({ board, side, title }: FleetStatusProps) {
  const byId = new Map<string, PlacedShip>(board.ships.map((s) => [s.spec.id, s]))
  const afloat = board.ships.filter((s) => !isSunk(s)).length
  return (
    <section className={`fleet-status side-${side}`} data-testid={`fleet-status-${side}`}>
      <header>
        <h3>{title}</h3>
        <span className="count" data-testid={`fleet-status-${side}-afloat`}>
          {afloat}/{FLEET.length} afloat
        </span>
      </header>
      <ul>
        {FLEET.map((spec) => {
          const ship = byId.get(spec.id)
          const hits = ship?.hits.length ?? 0
          const sunk = ship ? isSunk(ship) : false
          return (
            <li
              key={spec.id}
              className={sunk ? 'sunk' : hits > 0 ? 'damaged' : ''}
              data-testid={`fleet-status-${side}-${spec.id}`}
              data-sunk={sunk}
              aria-label={`${spec.name}: ${sunk ? 'sunk' : `${hits} of ${spec.length} hit`}`}
            >
              <span className="silhouette" aria-hidden>
                {Array.from({ length: spec.length }, (_, i) => (
                  <i key={i} className={i < hits ? 'hit' : ''} />
                ))}
              </span>
              <span className="name">{spec.name}</span>
              <span className="len">{sunk ? 'sunk' : spec.length}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
