import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const AUDIO_SETTINGS_STORAGE_KEY = 'battleship-devin.audio'

export interface AudioSettingsState {
  /** 0..1 master bus; every other bus is multiplied by it. */
  masterVolume: number
  /** 0..1 */
  sfxVolume: number
  /** 0..1 */
  musicVolume: number
  /** 0..1 */
  ambienceVolume: number
  /** Master mute (everything, including loops that keep running silently). */
  muted: boolean
  setMasterVolume: (v: number) => void
  setSfxVolume: (v: number) => void
  setMusicVolume: (v: number) => void
  setAmbienceVolume: (v: number) => void
  setMuted: (muted: boolean) => void
  toggleMuted: () => void
}

export const DEFAULT_AUDIO_SETTINGS = { masterVolume: 1, sfxVolume: 0.8, musicVolume: 0.5, ambienceVolume: 0.6, muted: false }
export type PersistedAudioSettings = typeof DEFAULT_AUDIO_SETTINGS

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

/**
 * Merge whatever is in localStorage (v1 had only sfx/music/muted) with defaults. Pure, so it is unit-tested.
 */
export function mergeAudioSettings(persisted: unknown, current: PersistedAudioSettings = DEFAULT_AUDIO_SETTINGS): PersistedAudioSettings {
  const p = (persisted && typeof persisted === 'object' ? persisted : {}) as Partial<Record<keyof PersistedAudioSettings, unknown>>
  const num = (key: keyof PersistedAudioSettings) => clamp01(typeof p[key] === 'number' ? (p[key] as number) : (current[key] as number))
  return {
    masterVolume: num('masterVolume'),
    sfxVolume: num('sfxVolume'),
    musicVolume: num('musicVolume'),
    ambienceVolume: num('ambienceVolume'),
    muted: typeof p.muted === 'boolean' ? p.muted : current.muted,
  }
}

/**
 * Audio preferences, persisted to localStorage under `battleship-devin.audio`.
 * The Howler layer in ./index.ts subscribes to this store and applies changes immediately.
 */
export const useAudioSettings = create<AudioSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_AUDIO_SETTINGS,
      setMasterVolume: (v) => set({ masterVolume: clamp01(v) }),
      setSfxVolume: (v) => set({ sfxVolume: clamp01(v) }),
      setMusicVolume: (v) => set({ musicVolume: clamp01(v) }),
      setAmbienceVolume: (v) => set({ ambienceVolume: clamp01(v) }),
      setMuted: (muted) => set({ muted: Boolean(muted) }),
      toggleMuted: () => set((s) => ({ muted: !s.muted })),
    }),
    {
      name: AUDIO_SETTINGS_STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        masterVolume: s.masterVolume,
        sfxVolume: s.sfxVolume,
        musicVolume: s.musicVolume,
        ambienceVolume: s.ambienceVolume,
        muted: s.muted,
      }),
      migrate: (persisted) => mergeAudioSettings(persisted),
      merge: (persisted, current) => ({ ...current, ...mergeAudioSettings(persisted, current) }),
    },
  ),
)
