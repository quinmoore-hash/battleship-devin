import { coordLabel, FLEET_BY_ID } from '../engine'
import type { GameEvent } from '../store/gameStore'

const word = (e: GameEvent): string =>
  e.kind === 'treasure' ? 'treasure!' : e.result.outcome === 'lost' ? (e.by === 'human' ? 'lost in the storm — fire again' : 'lost in the storm') : e.result.outcome === 'sunk' && e.result.shipId ? `sank ${FLEET_BY_ID[e.result.shipId]?.name ?? 'a ship'}` : e.result.outcome

/** One log line per event; the balls of a Black Flag Broadside collapse into one line ("Broadside D4–F4: miss, HIT, miss"). */
export interface LogLine {
  id: number
  by: GameEvent['by']
  className: string
  coord: string
  outcome: string
}

export function logLines(events: readonly GameEvent[]): LogLine[] {
  const lines: LogLine[] = []
  const groups = new Map<number, GameEvent[]>()
  for (const e of events) {
    if (e.kind === 'spyglass') {
      lines.push({ id: e.id, by: e.by, className: 'log-spyglass', coord: `Spyglass ${coordLabel(e.result.coord)}`, outcome: e.spied === 'ship' ? 'ship!' : 'open water' })
    } else if (e.group !== undefined) {
      const g = groups.get(e.group)
      if (g) g.push(e)
      else {
        const balls = [e]
        groups.set(e.group, balls)
        lines.push({ id: e.id, by: e.by, className: 'log-broadside', coord: '', outcome: '' })
        const line = lines[lines.length - 1]
        Object.defineProperty(line, 'balls', { value: balls, enumerable: false })
      }
    } else if (e.kind === 'treasure') {
      lines.push({ id: e.id, by: e.by, className: 'log-treasure', coord: `Treasure at ${coordLabel(e.result.coord)}`, outcome: 'fire again!' })
    } else {
      lines.push({ id: e.id, by: e.by, className: `log-${e.result.outcome}`, coord: coordLabel(e.result.coord), outcome: word(e) })
    }
  }
  for (const line of lines) {
    const balls = (line as LogLine & { balls?: GameEvent[] }).balls
    if (!balls) continue
    const first = balls[0].result.coord
    const last = balls[balls.length - 1].result.coord
    line.coord = `Broadside ${coordLabel(first)}${balls.length > 1 ? `–${coordLabel(last)}` : ''}`
    line.outcome = balls.map((b) => (b.result.outcome === 'miss' ? word(b) : word(b).toUpperCase())).join(', ')
    if (balls.some((b) => b.result.outcome !== 'miss')) line.className += ' log-hit'
  }
  return lines
}

export function ShotLog({ events, names }: { events: GameEvent[]; names?: { human: string; enemy: string } }) {
  const shots = events.filter((e) => e.kind !== 'spyglass').length
  const recent = logLines(events).reverse().slice(0, 40)
  return (
    <section className="shot-log" data-testid="shot-log" aria-label="Shot log">
      <header>
        <h3>Shot log</h3>
        <span className="count">{shots} shots</span>
      </header>
      {recent.length === 0 ? (
        <p className="muted">No shots yet. Fire when ready.</p>
      ) : (
        <ol>
          {recent.map((l) => (
            <li key={l.id} className={`${l.className} by-${l.by}`}>
              <span className="who">{names ? names[l.by] : l.by === 'human' ? 'You' : 'Enemy'}</span>
              <span className="coord">{l.coord}</span>
              <span className="outcome">{l.outcome}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
