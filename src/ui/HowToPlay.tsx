import { FLEET } from '../engine'
import { Modal } from './Modal'

export function HowToPlayModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" testId="how-to-play" onClose={onClose}>
      <ol className="howto">
        <li>
          <strong>Muster your fleet.</strong> Pick a ship from the tray and hover your waters — on the sea or
          on the chart — to preview where it anchors. Press <kbd>R</kbd>, right-click or tap <em>Rotate</em> to
          turn it, click to drop it. Drag a ship on the water to move it, click it to lift it, or just hit{' '}
          <em>Auto-place</em>.
        </li>
        <li>
          <strong>Take turns firing.</strong> Aim your spyglass over the enemy waters and click to fire (on a
          touch screen, tap once to aim and again to fire). Orange means hit, blue means miss, crimson means
          you sank something. Then the enemy fires back — press <kbd>Space</kbd> to skip the cinematic.
        </li>
        <li>
          <strong>Sink every enemy ship</strong> before they sink yours.
        </li>
      </ol>
      <h3>Rules of engagement</h3>
      <p className="muted small">Tick any combination in the menu; all off is Classic.</p>
      <dl className="howto-rules" data-testid="howto-rules">
        <dt>Classic</dt>
        <dd>One shot per turn, every shot visible, five ships each.</dd>
        <dt>Salvo</dt>
        <dd>Each side fires one shot per surviving ship every turn; the volley resolves at once.</dd>
        <dt>Stormy seas</dt>
        <dd>30% of shots — yours and the enemy's — are lost in the storm: no hit or miss is shown and the square stays open; fire at it again.</dd>
        <dt>Black Flag</dt>
        <dd data-testid="howto-black-flag">
          <b>Pick your fleet</b> before placing: Classic (5·4·3·3·2), Armada (two Men-o’-War, Galleon, Frigate), Wolf pack (Frigate, two Brigantines, four Sloops) or Raiders (Galleon, two Frigates, Brigantine, two Sloops) — every preset covers 17 cells and the enemy picks one too; both fleets are shown.
          <br />
          <b>Two power shots</b> per side per game, under the enemy chart: <b>Broadside</b> (<kbd>B</kbd>, <kbd>R</kbd> rotates) fires a line of three cells centred on your target — cells already shot or off the chart are skipped, and it is your whole turn (in Salvo it replaces the volley; in the storm each ball rolls its own 30% chance of being lost). <b>Spyglass</b> (<kbd>G</kbd>) reveals one cell as ship or open water without firing and without spending your turn; the glyph stays on the chart.
          <br />
          <b>Hidden treasure</b>: two chests lie in the open water of each board, never under a ship or next to each other. Hit one and you fire again at once (in Salvo, one more shot in the volley; in the storm that shot can still be lost). The enemy captain uses the same powers — Easy never does, Medium and Hard fire their Broadside the turn after their first hit, and Hard looks through the Spyglass when one cell is far likelier than the rest.
        </dd>
        <dt>Two captains</dt>
        <dd>
          Hot-seat for two players on one laptop. Captain 1 sails under the black flag and musters first, Captain 2 commands the Royal Navy. After each
          placement and after every broadside a parchment curtain hides both charts: pass the deck, and the next captain taps <em>when ready</em>{' '}
          (only that button drops it — <kbd>Space</kbd> and <kbd>Esc</kbd> do nothing). The camera and the charts flip to the active captain's side; your
          un-sunk ships are never shown to the other captain. Salvo, Stormy seas and Black Flag all apply to both captains. The winner is named on the
          report; Rematch lets the other captain place first.
        </dd>
        <dt>Sky &amp; sea (looks only)</dt>
        <dd data-testid="howto-sky-sea">
          Pick the time of day (Dawn, Noon, Golden hour, Dusk, Moonlit night) and the weather (Calm, Overcast, Squall)
          from the corner of the menu or in Settings. It only changes the light and the water — shots, odds and turns are
          untouched. Stormy seas brings its own weather while it is on.
        </dd>
      </dl>
      <h3>The fleet</h3>
      <ul className="howto-fleet">
        {FLEET.map((s) => (
          <li key={s.id}>
            <span className="silhouette" aria-hidden>
              {Array.from({ length: s.length }, (_, i) => (
                <i key={i} />
              ))}
            </span>
            <span>
              <strong>{s.name}</strong> ({s.length}) — {s.description}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted">
        Keyboard: <kbd>Tab</kbd> into a grid, arrow keys to move, <kbd>Enter</kbd> to place or fire.
      </p>
    </Modal>
  )
}
