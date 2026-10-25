import { useEffect } from 'react'
import './audio.css'
import { initAudio, playSfx, useAudioRuntime } from './index'
import { useAudioSettings } from './settings'

export interface AudioSettingsProps {
  /** Sound played by the "Test sound" button. */
  testSfx?: 'fire' | 'hit' | 'miss' | 'ui-click'
  /** Hide the test button (e.g. in a very compact settings row). */
  showTestButton?: boolean
}

function useAudioUnlocked(): boolean {
  useEffect(() => initAudio(), [])
  return useAudioRuntime().unlocked
}

/**
 * Drop-in audio controls: SFX + music sliders, mute toggle, test-sound button.
 * State lives in `useAudioSettings` (persisted to localStorage), so it survives reloads.
 */
export function AudioSettings({ testSfx = 'hit', showTestButton = true }: AudioSettingsProps) {
  const sfxVolume = useAudioSettings((s) => s.sfxVolume)
  const musicVolume = useAudioSettings((s) => s.musicVolume)
  const muted = useAudioSettings((s) => s.muted)
  const setSfxVolume = useAudioSettings((s) => s.setSfxVolume)
  const setMusicVolume = useAudioSettings((s) => s.setMusicVolume)
  const toggleMuted = useAudioSettings((s) => s.toggleMuted)
  const unlocked = useAudioUnlocked()

  return (
    <div className="audio-settings" data-testid="audio-settings">
      <label className="audio-settings__row">
        <span>Sound FX</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={sfxVolume}
          disabled={muted}
          data-testid="audio-sfx-volume"
          aria-label="Sound effects volume"
          onChange={(e) => setSfxVolume(e.target.valueAsNumber)}
          onPointerUp={() => playSfx('ui-click')}
        />
        <output>{Math.round(sfxVolume * 100)}</output>
      </label>
      <label className="audio-settings__row">
        <span>Music</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={musicVolume}
          disabled={muted}
          data-testid="audio-music-volume"
          aria-label="Music volume"
          onChange={(e) => setMusicVolume(e.target.valueAsNumber)}
        />
        <output>{Math.round(musicVolume * 100)}</output>
      </label>
      <div className="audio-settings__actions">
        <button
          type="button"
          data-testid="audio-mute"
          aria-pressed={muted}
          onClick={() => {
            toggleMuted()
            if (muted) playSfx('ui-click')
          }}
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>
        {showTestButton && (
          <button type="button" data-testid="audio-test-sound" disabled={muted} onClick={() => playSfx(testSfx)}>
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
