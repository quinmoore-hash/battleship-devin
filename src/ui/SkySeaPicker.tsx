import { playSfx } from '../audio'
import { TIME_PRESET_LABELS, TIME_PRESET_NAMES, WEATHER_LABELS, type TimePreset } from '../scene/sun'
import { selectSkyWeather, SKY_WEATHERS, useGameStore, type SkyWeather } from '../store/gameStore'

/**
 * "Sky & sea": time of day + weather, looks only. Shared by the menu corner control and Settings; the
 * scene behind the UI re-lights instantly (uniform changes, no shader recompiles). While the Stormy-seas
 * rule is on the weather select is locked on "Stormy seas".
 */
export function SkySeaPicker({ compact = false }: { compact?: boolean }) {
  const settings = useGameStore((s) => s.settings)
  const updateSettings = useGameStore((s) => s.updateSettings)
  const weather = useGameStore(selectSkyWeather)
  const stormRule = weather === 'stormy'
  return (
    <div className={`skysea ${compact ? 'skysea-compact' : ''}`} data-testid="skysea-picker" role="group" aria-label="Sky and sea (looks only)">
      {compact && (
        <span className="skysea-title" aria-hidden>
          Sky &amp; sea
        </span>
      )}
      <label className="skysea-field">
        <span>Time</span>
        <select
          className="select"
          data-testid="skysea-time"
          value={settings.timeOfDay}
          onChange={(e) => (playSfx('ui-click'), updateSettings({ timeOfDay: e.target.value as TimePreset }))}
        >
          {TIME_PRESET_NAMES.map((t) => (
            <option key={t} value={t}>
              {TIME_PRESET_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="skysea-field">
        <span>Weather</span>
        <select
          className="select"
          data-testid="skysea-weather"
          value={weather}
          disabled={stormRule}
          title={stormRule ? 'Stormy seas rule is on — the storm sets the weather' : undefined}
          onChange={(e) => (playSfx('ui-click'), updateSettings({ weather: e.target.value as SkyWeather }))}
        >
          {SKY_WEATHERS.map((w) => (
            <option key={w} value={w}>
              {WEATHER_LABELS[w]}
            </option>
          ))}
          {stormRule && (
            <option value="stormy" disabled>
              {WEATHER_LABELS.stormy}
            </option>
          )}
        </select>
      </label>
    </div>
  )
}
