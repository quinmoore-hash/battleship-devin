import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const AUDIO_SETTINGS_STORAGE_KEY = 'battleship-devin.audio'

export interface AudioSettingsState {
  /** 0..1 */
  sfxVolume: number
  /** 0..1. Ambience follows this slider too. */
  musicVolume: number
  muted: boolean
  setSfxVolume: (v: number) => void
  setMusicVolume: (v: number) => void
  setMuted: (muted: boolean) => void
  toggleMuted: () => void
}

export const DEFAULT_AUDIO_SETTINGS = { sfxVolume: 0.8, musicVolume: 0.5, muted: false }

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

/**
 * Audio preferences, persisted to localStorage under `battleship-devin.audio`.
 * The Howler layer in ./index.ts subscribes to this store and applies changes immediately.
 */
export const useAudioSettings = create<AudioSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_AUDIO_SETTINGS,
      setSfxVolume: (v) => set({ sfxVolume: clamp01(v) }),
      setMusicVolume: (v) => set({ musicVolume: clamp01(v) }),
      setMuted: (muted) => set({ muted: Boolean(muted) }),
      toggleMuted: () => set((s) => ({ muted: !s.muted })),
    }),
    {
      name: AUDIO_SETTINGS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ sfxVolume: s.sfxVolume, musicVolume: s.musicVolume, muted: s.muted }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<typeof DEFAULT_AUDIO_SETTINGS>
        return {
          ...current,
          sfxVolume: clamp01(typeof p.sfxVolume === 'number' ? p.sfxVolume : current.sfxVolume),
          musicVolume: clamp01(typeof p.musicVolume === 'number' ? p.musicVolume : current.musicVolume),
          muted: typeof p.muted === 'boolean' ? p.muted : current.muted,
        }
      },
    },
  ),
)
