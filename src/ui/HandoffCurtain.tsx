import { useEffect, useRef, type KeyboardEvent } from 'react'
import { playSfx } from '../audio'
import { useGameStore } from '../store/gameStore'
import { Skull, WaxSeal } from './Ornaments'

/**
 * Hot-seat handoff: a full-screen parchment that hides both boards while the laptop changes hands. Only its button
 * (click / tap / Enter) drops it — Space and Escape do nothing, and the HUD / Letterbox skip handlers are not reached
 * because the curtain is the only thing on screen. Rendered by `<GameUI>` whenever `handoff` is set (placement and battle).
 */
export function HandoffCurtain() {
  const handoff = useGameStore((s) => s.handoff)
  const players = useGameStore((s) => s.players)
  const phase = useGameStore((s) => s.phase)
  const endHandoff = useGameStore((s) => s.endHandoff)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    button.current?.focus()
  }, [handoff])

  if (!handoff) return null
  const name = players[handoff].name
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    // Space would "click" a focused button; the curtain is dismissed on purpose only (click / tap / Enter)
    if (e.key === ' ' || e.key === 'Escape') e.preventDefault()
  }
  return (
    <div className="handoff hud" data-testid="handoff" data-captain={handoff} role="dialog" aria-modal="true" aria-labelledby="handoff-title" data-no-skip>
      <article className="panel parchment handoff-card ink-in">
        <div className="title-rule" aria-hidden>
          <span />
          <Skull size={18} />
          <span />
        </div>
        <span className="handoff-kicker">{phase === 'placement' ? 'Muster the fleets' : 'Change of watch'}</span>
        <h2 id="handoff-title" className="handoff-title">
          Pass the deck to <strong data-testid="handoff-name">{name}</strong>
        </h2>
        <p className="handoff-sub">{phase === 'placement' ? `${name} places their fleet next — the other captain looks away.` : `${name} takes the next broadside. Nobody peeks at the charts.`}</p>
        <button ref={button} type="button" className="btn btn-brass btn-big" data-testid="handoff-ready" onKeyDown={onKey} onClick={() => (playSfx('ui-click'), endHandoff())}>
          {name} — tap when ready
        </button>
        <WaxSeal tone="crimson" className="handoff-seal">
          <Skull size={22} />
        </WaxSeal>
      </article>
    </div>
  )
}
