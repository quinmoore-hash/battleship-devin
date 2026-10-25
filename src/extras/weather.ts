import type { Weather } from '../scene'
import { useGameStore } from '../store/gameStore'

/** `'stormy'` while the stormy-seas mode is on; `undefined` otherwise so `<OceanScene>` keeps its default. */
export const useGameWeather = (): Weather | undefined => useGameStore((s) => (s.modes.storm ? 'stormy' : undefined))
