// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { loadSettings, saveSettings, SETTINGS_STORAGE_KEY, useGameStore } from './gameStore'

const mem = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

describe('settings persistence', () => {
  it('round-trips the player-chosen settings and ignores quality / reducedMotion / garbage', () => {
    const s = mem()
    saveSettings({ sfxVolume: 0.35, musicVolume: 0.45, reducedMotion: true, cinematics: 'fast', quality: 'low', colorblind: true }, s)
    const back = loadSettings(s)
    expect(back).toMatchObject({ sfxVolume: 0.35, musicVolume: 0.45, cinematics: 'fast', colorblind: true, reducedMotion: false, quality: 'auto' })
    s.setItem(SETTINGS_STORAGE_KEY, '{"cinematics":"wild","sfxVolume":7}')
    expect(loadSettings(s)).toMatchObject({ cinematics: 'full', sfxVolume: 0.8 })
    s.setItem(SETTINGS_STORAGE_KEY, 'not json')
    expect(loadSettings(s).cinematics).toBe('full')
    expect(loadSettings(null).cinematics).toBe('full')
  })

  it('updateSettings writes through to localStorage', () => {
    useGameStore.getState().updateSettings({ cinematics: 'off', musicVolume: 0.2 })
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({ cinematics: 'off', musicVolume: 0.2 })
    useGameStore.getState().updateSettings({ cinematics: 'full', musicVolume: 0.5 })
  })
})
