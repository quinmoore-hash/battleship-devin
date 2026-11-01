import { createDeckLoops, playSfxAt } from '../audio'
import { useGameStore } from '../store/gameStore'
import { readDeckState, shipWorldPosition, standingShip } from './pov'

/**
 * Loops that live while the player stands on deck: fire crackle on the standing ship while it has hit (burning)
 * cells (creak / rope ambience is the deck audio layer's, src/deck/audio). Subscribes to the game store; returns an unsubscribe that also stops
 * the loops. Mount once next to `bindCinematics` (App).
 */
export function bindDeckAudio(): () => void {
  if (typeof document === 'undefined') return () => {}
  const loops = createDeckLoops({ playAt: (name, at, gain) => playSfxAt(name, at, { gain, noDuck: true }) })
  let lastKey = ''
  const apply = () => {
    const s = useGameStore.getState()
    const deck = readDeckState()
    const inBattle = s.phase === 'battle'
    const own = s.perspective === 'human' ? s.playerBoard.ships : s.enemyBoard.ships
    const ship = deck.on && inBattle ? standingShip(own, deck) : null
    const burning = !!ship && ship.hits.length > 0
    const key = `${!!ship}:${ship?.uid ?? ''}:${burning}`
    if (key === lastKey) return
    lastKey = key
    const at = ship ? shipWorldPosition(ship, s.perspective) : null
    loops.update({ on: !!ship, burning, fireAt: at, creakAt: at })
  }
  apply()
  const unsub = useGameStore.subscribe(apply)
  return () => {
    unsub()
    loops.stop()
  }
}
