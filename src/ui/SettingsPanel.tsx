import { playSfx, useAudioSettings } from '../audio'
import { useGameStore, type CinematicsLevel, type QualitySetting } from '../store/gameStore'
import { Modal } from './Modal'
import { SkySeaPicker } from './SkySeaPicker'

/**
 * Settings. Volumes/mute are written to both the game store (rules/cinematics timing) and the
 * audio module's persisted `useAudioSettings` (what Howler actually reads).
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useGameStore((s) => s.settings)
  const updateSettings = useGameStore((s) => s.updateSettings)
  const muted = useAudioSettings((s) => s.muted)
  const setSfx = useAudioSettings((s) => s.setSfxVolume)
  const setMusic = useAudioSettings((s) => s.setMusicVolume)
  const toggleMuted = useAudioSettings((s) => s.toggleMuted)

  const onSfx = (v: number) => (updateSettings({ sfxVolume: v }), setSfx(v))
  const onMusic = (v: number) => (updateSettings({ musicVolume: v }), setMusic(v))

  return (
    <Modal title="Ship's settings" testId="settings" onClose={onClose}>
      <div className="settings">
        <fieldset className="settings-quality">
          <legend>Picture</legend>
          <label className="row">
            <span>Quality</span>
            <select className="select" data-testid="setting-quality" value={settings.quality} onChange={(e) => (playSfx('ui-click'), updateSettings({ quality: e.target.value as QualitySetting }))}>
              <option value="auto">Auto</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <p className="muted small">If the sea stutters, pick Low or Medium: no bloom, shadows or far waves (Low also simplifies the ships). Auto picks for your machine.</p>
          <label className="row">
            <span>Cinematics</span>
            <Segmented value={settings.cinematics} options={['full', 'fast', 'off']} testId="setting-cinematics" onChange={(v) => updateSettings({ cinematics: v as CinematicsLevel })} />
          </label>
        </fieldset>
        <fieldset className="settings-skysea">
          <legend>Sky &amp; sea</legend>
          <SkySeaPicker />
          <p className="muted">Looks only — the rules of engagement are unchanged.</p>
        </fieldset>
        <fieldset>
          <legend>Sound</legend>
          <label className="row">
            <span>Effects</span>
            <input type="range" min={0} max={1} step={0.05} value={settings.sfxVolume} data-testid="setting-sfx" onChange={(e) => onSfx(e.target.valueAsNumber)} onPointerUp={() => playSfx('hit')} />
          </label>
          <label className="row">
            <span>Music</span>
            <input type="range" min={0} max={1} step={0.05} value={settings.musicVolume} data-testid="setting-music" onChange={(e) => onMusic(e.target.valueAsNumber)} />
          </label>
          <label className="row row-check">
            <input type="checkbox" checked={muted} data-testid="setting-mute" onChange={() => toggleMuted()} />
            <span>Mute all</span>
          </label>
        </fieldset>
        <fieldset>
          <legend>Accessibility</legend>
          <label className="row row-check">
            <input type="checkbox" checked={settings.reducedMotion} data-testid="setting-reduced-motion" onChange={(e) => updateSettings({ reducedMotion: e.target.checked })} />
            <span>Reduced motion (no camera shake, shorter effects, quick turns)</span>
          </label>
          <label className="row row-check">
            <input type="checkbox" checked={settings.colorblind} data-testid="setting-colorblind" onChange={(e) => updateSettings({ colorblind: e.target.checked })} />
            <span>Colorblind-safe markers (shapes on hits, misses and sunk cells)</span>
          </label>
        </fieldset>
      </div>
    </Modal>
  )
}

function Segmented({ value, options, testId, onChange }: { value: string; options: string[]; testId: string; onChange: (v: string) => void }) {
  return (
    <span className="segmented" role="radiogroup" data-testid={testId}>
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} className={value === o ? 'is-on' : ''} data-testid={`${testId}-${o}`} onClick={() => (playSfx('ui-click'), onChange(o))}>
          {o}
        </button>
      ))}
    </span>
  )
}
