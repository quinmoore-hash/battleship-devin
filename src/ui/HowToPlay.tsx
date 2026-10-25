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
          <strong>Sink all five</strong> enemy ships before they sink yours.
        </li>
      </ol>
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
