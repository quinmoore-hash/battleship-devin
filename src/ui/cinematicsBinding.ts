import { director, type Director } from '../cinematics'
import { is3dDisabled } from '../scene/flags'
import { useGameStore } from '../store/gameStore'
import { effectiveLevel, getDirector, setDirector } from './turnFlow'

/**
 * Hands the shared cinematics director to the turn flow and keeps it honest about the game phase:
 * leaving the battle / game-over screens (quit, rematch, menu) cuts whatever is still playing.
 * Returns an unbind function. Mounted once from `App`.
 */
export function bindCinematics(d: Director = director): () => void {
  setDirector(d)
  let prevPhase = useGameStore.getState().phase
  const unsub = useGameStore.subscribe((state) => {
    if (state.phase === prevPhase) return
    prevPhase = state.phase
    if ((state.phase === 'menu' || state.phase === 'placement') && d.busy) d.skip()
  })
  return () => {
    unsub()
    if (d.busy) d.skip()
    if (getDirector() === d) setDirector(null)
  }
}

/** True while the director (not the audio binding) is responsible for shot / sink / victory sounds. */
export function directorPlaysAudio(): boolean {
  return getDirector() !== null && !is3dDisabled() && effectiveLevel(useGameStore.getState().settings.cinematics) !== 'off'
}
