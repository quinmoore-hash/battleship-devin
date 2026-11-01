import { useEffect } from 'react'
import { playSfx } from '../audio'
import { SpyglassOverlay, isAudioDebug, useDeckAudioStore, useDeckStore, useSpyglassStore } from '../deck'
import { coordLabel, FLEET_BY_ID, type PlacedShip } from '../engine'
import { is3dDisabled } from '../scene/flags'
import { SHIPS } from '../ships'
import { useGameStore } from '../store/gameStore'
import { isCoarsePointer, useUiStore } from './uiStore'

/** "On deck" / "Overview" button in the battle header + the V key. Hidden under `?no3d` (no deck to stand on). */
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
      title={on ? 'Back to the overview (V)' : 'Stand on your deck (V)'}
      disabled={phase !== 'battle'}
      onClick={() => (playSfx('ui-click'), setDeck(!useGameStore.getState().deck.on))}
    >
      {on ? 'Overview' : 'On deck'}
      <kbd aria-hidden>V</kbd>
    </button>
  )
}

/** Crosshair, prompt line, the ship you stand on with its damage pips, Tab / Salvo counters and the fade curtain. */
export function DeckHud({ ship, yourTurn }: { ship: PlacedShip | null; yourTurn: boolean }) {
  const deck = useGameStore((s) => s.deck)
  const salvo = useGameStore((s) => s.modes.salvo)
  const pending = useGameStore((s) => s.salvo.pending.length)
  const size = useGameStore((s) => s.salvo.size)
  const armed = useUiStore((s) => s.armed)
  const near = useDeckStore((s) => s.near)
  const locked = useDeckStore((s) => s.locked)
  const keyboardLook = useDeckStore((s) => s.keyboardLook)
  const aim = useDeckStore((s) => s.aim)
  const fade = useDeckStore((s) => s.fade)
  const nudge = useDeckStore((s) => s.nudge)
  const manStation = useGameStore((s) => s.manStation)
  const blackFlag = useGameStore((s) => s.modes.blackFlag)
  const spyUnused = useGameStore((s) => s.powerShots[s.perspective].spyglass)
  const setArmed = useUiStore((s) => s.setArmed)
  const setSpyNote = useUiStore((s) => s.setSpyNote)
  const glassUp = useSpyglassStore((s) => s.up)
  const touch = isCoarsePointer()
  if (!deck.on || !ship) return null

  const def = SHIPS[ship.spec.id]
  const spec = FLEET_BY_ID[ship.spec.id]
  const manning = deck.station !== null
  const gun = manning ? def.anchors.cannons[deck.station!] : null
  const prompt = nudge
    ? nudge
    : glassUp
      ? 'Spyglass raised — pan to a square and click to look · Esc lowers'
      : manning
      ? yourTurn
        ? armed === 'spyglass'
          ? 'Spyglass raised — click a square to look'
          : armed === 'broadside'
            ? 'Broadside — click the centre square (R rotates)'
            : aim
              ? `Fire at ${coordLabel(aim)} — click`
              : touch
                ? 'Tap a square on the chart to fire'
                : 'Click a square — on the chart or across the water'
        : 'Gun manned — waiting for your turn'
      : near
        ? near.usable
          ? touch
            ? 'Tap the gun to man it'
            : 'E — Man the gun'
          : 'No target that side'
        : touch
          ? 'Drag to look · tap a gun to man it'
          : locked
            ? 'WASD walk · Shift run · E at a gun · Tab next ship'
            : keyboardLook
              ? 'Arrow keys look · WASD walk · E at a gun · Enter fires'
              : 'Click the sea to grab the mouse'
  return (
    <>
      <div className="deck-fade" data-testid="deck-fade" style={{ opacity: fade }} aria-hidden={fade === 0} />
      <div className="deck-crosshair" data-testid="deck-crosshair" data-manning={manning ? 'true' : 'false'} data-aim={aim ? coordLabel(aim) : undefined} aria-hidden>
        <i />
        <i />
      </div>
      <SpyglassOverlay />
      {isAudioDebug() && <DeckAudioLog />}
      <div className="deck-prompt" data-testid="deck-prompt" role="status" aria-live="polite">
        {prompt}
      </div>
      <div className="panel parchment deck-hud" data-testid="deck-hud" data-station={deck.station ?? undefined}>
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
          {blackFlag && (
            <button
              type="button"
              className={`btn ${glassUp ? 'btn-brass' : 'btn-ghost'}`}
              data-testid="deck-spyglass"
              data-spent={spyUnused ? undefined : 'true'}
              title={spyUnused ? 'G' : 'Already used this game'}
              disabled={!spyUnused}
              aria-pressed={glassUp}
              onClick={() => (playSfx('ui-click'), setSpyNote(null), setArmed(armed === 'spyglass' ? 'shot' : 'spyglass'))}
            >
              {spyUnused ? (glassUp ? 'Lower the glass' : 'Spyglass') : 'Spyglass spent'} {spyUnused && <kbd aria-hidden>G</kbd>}
            </button>
          )}
          {manning && (
            <button type="button" className="btn btn-ghost" data-testid="deck-step-away" onClick={() => (playSfx('ui-click'), manStation(null))}>
              Step away
            </button>
          )}
          <button type="button" className="btn btn-ghost" data-testid="deck-next-ship" title="Tab" onClick={() => (playSfx('ui-click'), window.dispatchEvent(new CustomEvent('battleship:deck-next')))}>
            Next ship <kbd aria-hidden>Tab</kbd>
          </button>
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
