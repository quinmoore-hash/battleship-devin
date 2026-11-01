import { playSfx, useAudioSettings } from '../audio'
import { useGameStore, type CinematicsLevel, type QualitySetting } from '../store/gameStore'
import { Modal } from './Modal'
import { RULES, RULES_OPTIONAL_COPY, rulesSummary } from './rules'
import { SkySeaPicker } from './SkySeaPicker'

/**
 * Settings. Volumes/mute are written to both the game store (rules/cinematics timing) and the
 * audio module's persisted `useAudioSettings` (what Howler actually reads).
 */
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useGameStore((s) => s.settings)
  const updateSettings = useGameStore((s) => s.updateSettings)
  const modes = useGameStore((s) => s.modes)
  const setModes = useGameStore((s) => s.setModes)
  const rulesLocked = useGameStore((s) => s.phase !== 'menu')
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
        <fieldset className="settings-rules" data-testid="settings-rules" aria-describedby="settings-rules-note">
          <legend>Rules of engagement</legend>
          <p className="muted small" id="settings-rules-note">
            {rulesLocked ? 'Set before you sail — these are fixed for the game under way; change them from the menu.' : RULES_OPTIONAL_COPY}
          </p>
          {RULES.map((rule) => (
            <label key={rule.id} className="row row-check">
              <input type="checkbox" checked={modes[rule.id]} disabled={rulesLocked} data-testid={`setting-rule-${rule.id}`} onChange={(e) => (playSfx('ui-click'), setModes({ [rule.id]: e.target.checked }))} />
              <span>
                <b>{rule.label}</b> <small className="muted">{rule.blurb}</small>
              </span>
            </label>
          ))}
          <p className="muted small settings-rules-summary" data-testid="settings-rules-summary" role="status" aria-live="polite">
            Sailing under: <b>{rulesSummary(modes)}</b>
          </p>
        </fieldset>
        <fieldset className="settings-skysea">
          <legend>Sky &amp; sea</legend>
          <SkySeaPicker />
          <p className="muted">Looks only — the rules of engagement above are unchanged.</p>
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
        <fieldset className="settings-deck">
          <legend>On deck</legend>
          <label className="row">
            <span>Look sensitivity</span>
            <input type="range" min={0.2} max={3} step={0.1} value={settings.deckSensitivity} data-testid="setting-deck-sensitivity" aria-valuetext={`${settings.deckSensitivity.toFixed(1)}×`} onChange={(e) => updateSettings({ deckSensitivity: e.target.valueAsNumber })} />
          </label>
          <label className="row row-check">
            <input type="checkbox" checked={settings.deckInvertY} data-testid="setting-deck-invert-y" onChange={(e) => updateSettings({ deckInvertY: e.target.checked })} />
            <span>Invert Y (mouse look)</span>
          </label>
          <p className="muted small">Press V in battle to stand on your own deck. Same shots, same odds — just a different seat.</p>
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
