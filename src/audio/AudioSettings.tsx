import { useEffect } from 'react'
import './audio.css'
import { initAudio, playSfx, useAudioRuntime, type Sfx } from './index'
import { useAudioSettings, type AudioSettingsState } from './settings'

export interface AudioSettingsProps {
  /** Sound played by the "Test sound" button. */
  testSfx?: Sfx
  /** Hide the test button (e.g. in a very compact settings row). */
  showTestButton?: boolean
  /** Show the master + ambience sliders too (the in-game panel only needs SFX + music). */
  showAllBuses?: boolean
}

function useAudioUnlocked(): boolean {
  useEffect(() => initAudio(), [])
  return useAudioRuntime().unlocked
}

interface BusRow {
  key: 'masterVolume' | 'sfxVolume' | 'musicVolume' | 'ambienceVolume'
  setter: keyof Pick<AudioSettingsState, 'setMasterVolume' | 'setSfxVolume' | 'setMusicVolume' | 'setAmbienceVolume'>
  label: string
  testId: string
  aria: string
  /** Sound to preview when the slider is released. */
  preview?: Sfx
}

const BUSES: BusRow[] = [
  { key: 'masterVolume', setter: 'setMasterVolume', label: 'Master', testId: 'audio-master-volume', aria: 'Master volume', preview: 'ui-click' },
  { key: 'sfxVolume', setter: 'setSfxVolume', label: 'Sound FX', testId: 'audio-sfx-volume', aria: 'Sound effects volume', preview: 'impact-wood' },
  { key: 'musicVolume', setter: 'setMusicVolume', label: 'Music', testId: 'audio-music-volume', aria: 'Music volume' },
  { key: 'ambienceVolume', setter: 'setAmbienceVolume', label: 'Ambience', testId: 'audio-ambience-volume', aria: 'Ambience volume' },
]

/**
 * Drop-in audio controls: bus sliders (SFX + music, optionally master + ambience), mute toggle, test-sound button.
 * State lives in `useAudioSettings` (persisted to localStorage), so it survives reloads.
 */
export function AudioSettings({ testSfx = 'impact-wood', showTestButton = true, showAllBuses = false }: AudioSettingsProps) {
  const settings = useAudioSettings()
  const unlocked = useAudioUnlocked()
  const rows = showAllBuses ? BUSES : BUSES.filter((b) => b.key === 'sfxVolume' || b.key === 'musicVolume')

  return (
    <div className="audio-settings" data-testid="audio-settings">
      {rows.map((bus) => (
        <label className="audio-settings__row" key={bus.key}>
          <span>{bus.label}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={settings[bus.key]}
            disabled={settings.muted}
            data-testid={bus.testId}
            aria-label={bus.aria}
            onChange={(e) => settings[bus.setter](e.target.valueAsNumber)}
            onPointerUp={() => bus.preview && playSfx(bus.preview)}
          />
          <output>{Math.round(settings[bus.key] * 100)}</output>
        </label>
      ))}
      <div className="audio-settings__actions">
        <button
          type="button"
          data-testid="audio-mute"
          aria-pressed={settings.muted}
          onClick={() => {
            settings.toggleMuted()
            if (settings.muted) playSfx('ui-click')
          }}
        >
          {settings.muted ? 'Unmute' : 'Mute'}
        </button>
        {showTestButton && (
          <button type="button" data-testid="audio-test-sound" disabled={settings.muted} onClick={() => playSfx(testSfx)}>
            Test sound
          </button>
        )}
      </div>
      {!unlocked && (
        <p className="audio-settings__hint" data-testid="audio-unlock-hint">
          Click or tap anywhere to enable audio.
        </p>
      )}
    </div>
  )
}

export default AudioSettings
