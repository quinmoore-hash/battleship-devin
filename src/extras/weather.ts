import { TIME_PRESETS, type Weather } from '../scene'
import { selectSkyWeather, useGameStore } from '../store/gameStore'

/** Weather for `<OceanScene>`: `'stormy'` while the Stormy-seas rule is on, else the Sky & sea pick (`settings.weather`). */
export const useGameWeather = (): Weather => useGameStore(selectSkyWeather)

/** Time of day for `<OceanScene>` from the Sky & sea preset in settings. */
export const useGameTimeOfDay = (): number => useGameStore((s) => TIME_PRESETS[s.settings.timeOfDay])
