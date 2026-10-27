import type { Orientation } from '../engine'
import type { PowerShots as PowerShotsState } from '../store/gameStore'

export type Armed = 'shot' | 'broadside' | 'spyglass'

interface Props {
  power: PowerShotsState
  armed: Armed
  orientation: Orientation
  treasure: number
  disabled: boolean
  onArm: (armed: Armed) => void
  onRotate: () => void
}

/** Black Flag HUD under the enemy chart: the two brass power-shot buttons (B / G, R rotates the Broadside) and the chests found. */
export function PowerShots({ power, armed, orientation, treasure, disabled, onArm, onRotate }: Props) {
  const toggle = (kind: Exclude<Armed, 'shot'>) => onArm(armed === kind ? 'shot' : kind)
  return (
    <div className="power-shots" data-testid="power-shots" data-armed={armed}>
      <button
        type="button"
        className={`btn btn-brass power-btn ${armed === 'broadside' ? 'is-armed' : ''}`}
        data-testid="power-broadside"
        data-used={!power.broadside}
        aria-pressed={armed === 'broadside'}
        disabled={disabled || !power.broadside}
        title="Broadside — three balls in a line through the target (B; R rotates)"
        onClick={() => toggle('broadside')}
      >
        <span className="power-icon" aria-hidden>
          ⚔
        </span>
        <span>
          Broadside <small>{power.broadside ? `1 left · ${orientation === 'horizontal' ? '↔' : '↕'}` : 'spent'}</small>
        </span>
      </button>
      <button
        type="button"
        className={`btn btn-brass power-btn ${armed === 'spyglass' ? 'is-armed' : ''}`}
        data-testid="power-spyglass"
        data-used={!power.spyglass}
        aria-pressed={armed === 'spyglass'}
        disabled={disabled || !power.spyglass}
        title="Spyglass — reveal one cell without firing (G)"
        onClick={() => toggle('spyglass')}
      >
        <span className="power-icon" aria-hidden>
          ◎
        </span>
        <span>
          Spyglass <small>{power.spyglass ? '1 left' : 'spent'}</small>
        </span>
      </button>
      {armed === 'broadside' && (
        <button type="button" className="btn btn-ghost power-rotate" data-testid="power-rotate" onClick={onRotate} title="Rotate the Broadside (R)">
          {orientation === 'horizontal' ? 'Row ↔' : 'Column ↕'}
        </button>
      )}
      <span className="power-treasure" data-testid="treasure-count" title="Treasure chests you have found">
        <span aria-hidden>▣</span> {treasure}/2
      </span>
    </div>
  )
}
