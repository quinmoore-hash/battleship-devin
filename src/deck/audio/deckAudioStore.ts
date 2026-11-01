import { create } from 'zustand'

/** One deck audio cue that fired (what `DeckAudio` asked `playSfx` for), for the HUD debug log and e2e proof. */
export interface DeckAudioCue {
  n: number
  name: string
  detail?: string
  at: number
}

export interface DeckAudioRuntime {
  /** Most recent cues first, capped. */
  recent: DeckAudioCue[]
  /** Cues fired since the deck audio layer mounted. */
  count: number
  /** Wind loop gain currently applied (weather × duck). */
  wind: number
  /** Underwater muffle engaged. */
  underwater: boolean
  log: (name: string, detail?: string) => void
  setWind: (wind: number) => void
  setUnderwater: (underwater: boolean) => void
  reset: () => void
}

const KEEP = 10

export const useDeckAudioStore = create<DeckAudioRuntime>((set, get) => ({
  recent: [],
  count: 0,
  wind: 0,
  underwater: false,
  log: (name, detail) => {
    const count = get().count + 1
    set({ count, recent: [{ n: count, name, detail, at: Date.now() }, ...get().recent].slice(0, KEEP) })
  },
  setWind: (wind) => (Math.abs(get().wind - wind) > 1e-3 ? set({ wind }) : undefined),
  setUnderwater: (underwater) => (get().underwater !== underwater ? set({ underwater }) : undefined),
  reset: () => set({ recent: [], count: 0, wind: 0, underwater: false }),
}))

/** `?audio-debug` shows the cue log in the deck HUD (SwiftShader has no speakers: this is how tests prove cues fire). */
export const isAudioDebug = (): boolean => typeof location !== 'undefined' && new URLSearchParams(location.search).has('audio-debug')
