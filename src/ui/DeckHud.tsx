import { useCallback, useEffect } from 'react'
import { playSfx } from '../audio'
import { isAudioDebug, useDeckAudioStore, useDeckStore } from '../deck'
import { coordLabel, FLEET_BY_ID, type PlacedShip } from '../engine'
import { is3dDisabled } from '../scene/flags'
import { SHIPS } from '../ships'
import { useGameStore } from '../store/gameStore'
import { isCoarsePointer, useUiStore } from './uiStore'

/** "Third person" / "Overview" button in the battle header + the V key. Hidden under `?no3d` (no deck to stand on). */
export function DeckToggle() {
  const on = useGameStore((s) => s.deck.on)
  const setDeck = useGameStore((s) => s.setDeck)
  const phase = useGameStore((s) => s.phase)
  const no3d = is3dDisabled()
  useEffect(() => {
    if (no3d) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'v' || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return
      const g = useGameStore.getState()
      if (g.phase !== 'battle' || g.handoff) return
      playSfx('ui-click')
      g.setDeck(!g.deck.on)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [no3d])
  if (no3d) return null
  return (
    <button
      type="button"
      className={`btn btn-ghost deck-toggle ${on ? 'is-on' : ''}`}
      data-testid="deck-toggle"
      data-on={on ? 'true' : 'false'}
      aria-pressed={on}
      title={on ? 'Back to the overview (V)' : 'Walk your own deck in third person (V)'}
      disabled={phase !== 'battle'}
      onClick={() => (playSfx('ui-click'), setDeck(!useGameStore.getState().deck.on))}
    >
      {on ? 'Overview' : 'Third person'}
      <kbd aria-hidden>V</kbd>
    </button>
  )
}

/** Prompt line, floating gun label, compass arrow, the ship you stand on with its damage pips, Tab / Salvo counters and the fade curtain. */
export function DeckHud({ ship, yourTurn }: { ship: PlacedShip | null; yourTurn: boolean }) {
  const deck = useGameStore((s) => s.deck)
  const salvo = useGameStore((s) => s.modes.salvo)
  const pending = useGameStore((s) => s.salvo.pending.length)
  const size = useGameStore((s) => s.salvo.size)
  const armed = useUiStore((s) => s.armed)
  const hover = useUiStore((s) => s.hover)
  const near = useDeckStore((s) => s.near)
  const approach = useDeckStore((s) => s.approach)
  const fade = useDeckStore((s) => s.fade)
  const nudge = useDeckStore((s) => s.nudge)
  const setLabelEl = useDeckStore((s) => s.setLabelEl)
  const setCompassEl = useDeckStore((s) => s.setCompassEl)
  const manStation = useGameStore((s) => s.manStation)
  const touch = isCoarsePointer()
  const labelRef = useCallback((el: HTMLElement | null) => setLabelEl(el), [setLabelEl])
  const compassRef = useCallback((el: HTMLElement | null) => setCompassEl(el), [setCompassEl])
  if (!deck.on || !ship) return null

  const def = SHIPS[ship.spec.id]
  const spec = FLEET_BY_ID[ship.spec.id]
  const manning = deck.station !== null
  const gun = manning ? def.anchors.cannons[deck.station!] : null
  const hovered = hover?.side === 'enemy' ? hover.coord : null
  const click = touch ? 'Tap' : 'Click'
  const prompt = nudge
    ? nudge
    : manning
      ? yourTurn
        ? armed === 'spyglass'
          ? `Spyglass raised — ${click.toLowerCase()} a square on the chart to look`
          : armed === 'broadside'
            ? `Broadside — ${click.toLowerCase()} the centre square on the chart (R rotates)`
            : hovered
              ? `Fire at ${coordLabel(hovered)} — ${click.toLowerCase()}`
              : `${click} a square on the chart to fire`
        : 'Gun manned — waiting for your turn'
      : near
        ? near.usable
          ? touch
            ? 'Tap the gun to man it'
            : 'E — Man the gun'
          : 'No target that side'
        : touch
          ? 'Drag to look · tap a glowing gun to man it'
          : approach !== null
            ? 'Walk to the glowing gun · E mans it'
            : 'WASD walk · Space jump · Shift run · drag to look · E at a glowing gun · Tab next ship'
  return (
    <>
      <div className="deck-fade" data-testid="deck-fade" style={{ opacity: fade }} aria-hidden={fade === 0} />
      <div className="deck-gun-label" data-testid="deck-gun-label" data-station={approach ?? undefined} ref={labelRef} aria-hidden>
        {touch ? 'Tap — Man the gun' : 'E — Man the gun'}
      </div>
      {isAudioDebug() && <DeckAudioLog />}
      <div className="deck-prompt" data-testid="deck-prompt" role="status" aria-live="polite">
        {prompt}
      </div>
      <div className="panel parchment deck-hud" data-testid="deck-hud" data-station={deck.station ?? undefined} data-view={manning ? 'first' : 'third'}>
        <div className="deck-ship">
          <strong data-testid="deck-ship-name">{def.name}</strong>
          <span className="deck-pips" aria-label={`${ship.hits.length} of ${spec.length} sections hit`} data-testid="deck-pips">
            {ship.cells.map((c, i) => (
              <i key={i} className={ship.hits.some((h) => h.x === c.x && h.y === c.y) ? 'is-hit' : ''} />
            ))}
          </span>
        </div>
        <div className="deck-lines">
          <span data-testid="deck-station">{manning && gun ? `Manning the ${gun.side} gun ${gun.cell + 1}` : 'Walking the deck'}</span>
          {salvo && yourTurn && (
            <span data-testid="deck-salvo">
              shot {Math.min(pending + 1, size)} of {size}
            </span>
          )}
        </div>
        <div className="deck-actions">
          {!manning && (
            <button type="button" className={`btn ${near?.usable ? 'btn-brass' : 'btn-ghost'}`} data-testid="deck-man" title="E" onClick={() => (playSfx('ui-click'), window.dispatchEvent(new CustomEvent('battleship:deck-man')))}>
              {near?.usable ? 'Man the gun' : 'Man nearest gun'} <kbd aria-hidden>E</kbd>
            </button>
          )}
          {manning && (
            <button type="button" className="btn btn-ghost" data-testid="deck-step-away" title="E" onClick={() => (playSfx('ui-click'), manStation(null))}>
              Step away <kbd aria-hidden>E</kbd>
            </button>
          )}
          <button type="button" className="btn btn-ghost" data-testid="deck-next-ship" title="Tab" onClick={() => (playSfx('ui-click'), window.dispatchEvent(new CustomEvent('battleship:deck-next')))}>
            Next ship <kbd aria-hidden>Tab</kbd>
          </button>
          <span className="deck-compass" data-testid="deck-compass" title="Nearest gun that bears" aria-hidden>
            <i ref={compassRef} />
          </span>
        </div>
      </div>
    </>
  )
}

/** `?audio-debug`: the deck audio cues as they fire (the VM's browser has no speakers; tests read this). */
function DeckAudioLog() {
  const recent = useDeckAudioStore((s) => s.recent)
  const count = useDeckAudioStore((s) => s.count)
  const wind = useDeckAudioStore((s) => s.wind)
  const underwater = useDeckAudioStore((s) => s.underwater)
  return (
    <div className="deck-audio-log" data-testid="deck-audio-log" data-count={count} data-wind={wind.toFixed(2)} data-underwater={underwater ? 'true' : 'false'}>
      <strong>
        Deck audio · {count} cues · wind {wind.toFixed(2)}
        {underwater ? ' · underwater' : ''}
      </strong>
      {recent.map((c) => (
        <span key={c.n} data-cue={c.name}>
          #{c.n} {c.name}
          {c.detail ? ` — ${c.detail}` : ''}
        </span>
      ))}
    </div>
  )
}
