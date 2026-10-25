import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('howler', () => ({
  Howl: class {},
  Howler: { mute: vi.fn(), ctx: undefined, autoUnlock: true, usingWebAudio: true },
}))

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(key: string) {
    return this.map.get(key) ?? null
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.map.delete(key)
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value))
  }
}

const storage = new MemoryStorage()
vi.stubGlobal('localStorage', storage)

const { useAudioSettings, AUDIO_SETTINGS_STORAGE_KEY, DEFAULT_AUDIO_SETTINGS, clamp01 } = await import('./settings')

const persisted = () => JSON.parse(storage.getItem(AUDIO_SETTINGS_STORAGE_KEY) ?? 'null')

describe('useAudioSettings', () => {
  beforeEach(() => {
    storage.clear()
    useAudioSettings.setState({ ...DEFAULT_AUDIO_SETTINGS })
  })
  afterEach(() => vi.restoreAllMocks())

  it('starts with sensible defaults', () => {
    const s = useAudioSettings.getState()
    expect(s.sfxVolume).toBe(0.8)
    expect(s.musicVolume).toBe(0.5)
    expect(s.muted).toBe(false)
  })

  it('clamps volumes to 0..1 and rejects NaN', () => {
    const s = useAudioSettings.getState()
    s.setSfxVolume(1.7)
    expect(useAudioSettings.getState().sfxVolume).toBe(1)
    s.setSfxVolume(-3)
    expect(useAudioSettings.getState().sfxVolume).toBe(0)
    s.setMusicVolume(Number.NaN)
    expect(useAudioSettings.getState().musicVolume).toBe(0)
    s.setMusicVolume(0.42)
    expect(useAudioSettings.getState().musicVolume).toBe(0.42)
    expect(clamp01(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('mutes and toggles', () => {
    const s = useAudioSettings.getState()
    s.setMuted(true)
    expect(useAudioSettings.getState().muted).toBe(true)
    s.toggleMuted()
    expect(useAudioSettings.getState().muted).toBe(false)
    s.toggleMuted()
    expect(useAudioSettings.getState().muted).toBe(true)
  })

  it('persists only the three settings to localStorage', () => {
    const s = useAudioSettings.getState()
    s.setSfxVolume(0.25)
    s.setMusicVolume(0.75)
    s.setMuted(true)
    const stored = persisted()
    expect(stored.state).toEqual({ sfxVolume: 0.25, musicVolume: 0.75, muted: true })
    expect(stored.version).toBe(1)
  })

  it('rehydrates from localStorage and sanitises bad values', async () => {
    storage.setItem(
      AUDIO_SETTINGS_STORAGE_KEY,
      JSON.stringify({ state: { sfxVolume: 9, musicVolume: 'loud', muted: 'yes' }, version: 1 }),
    )
    await useAudioSettings.persist.rehydrate()
    const s = useAudioSettings.getState()
    expect(s.sfxVolume).toBe(1)
    expect(s.musicVolume).toBe(DEFAULT_AUDIO_SETTINGS.musicVolume)
    expect(s.muted).toBe(DEFAULT_AUDIO_SETTINGS.muted)
    expect(typeof s.setSfxVolume).toBe('function')

    storage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify({ state: { sfxVolume: 0.1, musicVolume: 0.2, muted: true }, version: 1 }))
    await useAudioSettings.persist.rehydrate()
    expect(useAudioSettings.getState()).toMatchObject({ sfxVolume: 0.1, musicVolume: 0.2, muted: true })
  })
})
