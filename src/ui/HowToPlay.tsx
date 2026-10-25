import { FLEET } from '../engine'
import { Modal } from './Modal'

export function HowToPlayModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" testId="how-to-play" onClose={onClose}>
      <ol className="howto">
        <li>
          <strong>Place your fleet.</strong> Pick a ship from the tray, hover the grid to preview, press{' '}
          <kbd>R</kbd> to rotate, click to drop it. Click a placed ship to pick it back up, or just
          hit <em>Auto-place</em>.
        </li>
        <li>
          <strong>Take turns firing.</strong> Click a cell on Devin&apos;s radar. Orange means hit, blue
          means miss, red means you sank something. Then Devin fires back.
        </li>
        <li>
          <strong>Sink all five</strong> of Devin&apos;s ships before he sinks yours.
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
