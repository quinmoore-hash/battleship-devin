import { setMusicVolume, setSfxVolume } from '../audio'
import { useGameStore, type QualitySetting } from '../store/gameStore'
import { Modal } from './Modal'
import { withSfx } from './sfx'

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useGameStore((s) => s.settings)
  const updateSettings = useGameStore((s) => s.updateSettings)

  return (
    <Modal title="Settings" testId="settings" onClose={onClose}>
      <label className="setting setting-toggle">
        <span>
          Graphics quality
          <small>Auto picks a tier from your GPU; lower it if the sea stutters</small>
        </span>
        <select data-testid="setting-quality" value={settings.quality} onChange={withSfx((e) => updateSettings({ quality: e.target.value as QualitySetting }))}>
          <option value="auto">Auto</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <label className="setting">
        <span>Sound effects</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.sfxVolume}
          data-testid="setting-sfx"
          aria-label="Sound effects volume"
          onChange={(e) => {
            const v = Number(e.target.value)
            updateSettings({ sfxVolume: v })
            setSfxVolume(v)
          }}
        />
        <output>{Math.round(settings.sfxVolume * 100)}%</output>
      </label>
      <label className="setting">
        <span>Music</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.musicVolume}
          data-testid="setting-music"
          aria-label="Music volume"
          onChange={(e) => {
            const v = Number(e.target.value)
            updateSettings({ musicVolume: v })
            setMusicVolume(v)
          }}
        />
        <output>{Math.round(settings.musicVolume * 100)}%</output>
      </label>
      <label className="setting setting-toggle">
        <span>
          Reduced motion
          <small>Fewer animations and snappier turns</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={settings.reducedMotion}
          data-testid="setting-reduced-motion"
          aria-checked={settings.reducedMotion}
          onChange={withSfx((e) => updateSettings({ reducedMotion: e.target.checked }))}
        />
      </label>
      <label className="setting setting-toggle">
        <span>
          Colour-blind markers
          <small>Shapes and patterns for hits, misses and sunk ships</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={settings.colorblind}
          data-testid="setting-colorblind"
          aria-checked={settings.colorblind}
          onChange={withSfx((e) => updateSettings({ colorblind: e.target.checked }))}
        />
      </label>
    </Modal>
  )
}
