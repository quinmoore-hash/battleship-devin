import { useGameStore } from '../../store/gameStore'

/** Player setting: fewer, shorter particles and no flashes/shakes. */
export const useReducedMotion = (): boolean => useGameStore((s) => s.settings.reducedMotion)
