import { coordLabel, FLEET_BY_ID } from '../engine'
import type { GameEvent } from '../store/gameStore'

export function ShotLog({ events }: { events: GameEvent[] }) {
  const recent = [...events].reverse().slice(0, 40)
  return (
    <section className="shot-log" data-testid="shot-log" aria-label="Shot log">
      <header>
        <h3>Shot log</h3>
        <span className="count">{events.length} shots</span>
      </header>
      {recent.length === 0 ? (
        <p className="muted">No shots yet. Fire when ready.</p>
      ) : (
        <ol>
          {recent.map((e) => (
            <li key={e.id} className={`log-${e.result.outcome} by-${e.by}`}>
              <span className="who">{e.by === 'human' ? 'You' : 'Devin'}</span>
              <span className="coord">{coordLabel(e.result.coord)}</span>
              <span className="outcome">
                {e.result.outcome === 'sunk' && e.result.shipId
                  ? `sank ${FLEET_BY_ID[e.result.shipId]?.name ?? 'a ship'}`
                  : e.result.outcome}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
