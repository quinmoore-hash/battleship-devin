import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Coord, Orientation, ShipId } from '../engine'
import { useGameStore } from '../store/gameStore'

export const UI_PREFS_STORAGE_KEY = 'battleship-devin.ui'

export type BoardSide = 'player' | 'enemy'

/** Persisted player preferences that don't belong to the game rules store. */
export interface UiPrefs {
  /** First-play hints the player has dismissed. */
  hintsSeen: string[]
}

/**
 * Shared, non-persisted interaction state between the HTML HUD and the 3D world inside the Canvas:
 * which cell the pointer is over on which board, the ship being carried during placement, the
 * target waiting for a confirm tap on touch screens, and whether the world has drawn its first frame.
 */
export interface UiInteraction {
  hover: { side: BoardSide; coord: Coord } | null
  /** Ship currently being carried (picked from the tray or lifted off the water). */
  carrying: ShipId | null
  orientation: Orientation
  /** True while the pointer button is held on a carried ship (drag), false for click-to-carry. */
  dragging: boolean
  /** Touch targeting: the cell selected with a first tap, fired by a second tap / the Fire button. */
  pendingTarget: Coord | null
  worldReady: boolean
  battleStartedAt: number | null
}

export interface UiState extends UiPrefs, UiInteraction {
  setHover: (hover: UiInteraction['hover']) => void
  setCarrying: (id: ShipId | null, orientation?: Orientation) => void
  setOrientation: (o: Orientation) => void
  rotate: () => void
  setDragging: (dragging: boolean) => void
  setPendingTarget: (coord: Coord | null) => void
  setWorldReady: (ready: boolean) => void
  markBattleStart: () => void
  setPrefs: (patch: Partial<UiPrefs>) => void
  dismissHint: (id: string) => void
}

const DEFAULT_PREFS: UiPrefs = { hintsSeen: [] }

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFS,
      hover: null,
      carrying: null,
      orientation: 'horizontal',
      dragging: false,
      pendingTarget: null,
      worldReady: false,
      battleStartedAt: null,

      setHover: (hover) => set({ hover }),
      setCarrying: (id, orientation) => set((s) => ({ carrying: id, orientation: orientation ?? s.orientation, dragging: false })),
      setOrientation: (orientation) => set({ orientation }),
      rotate: () => set((s) => ({ orientation: s.orientation === 'horizontal' ? 'vertical' : 'horizontal' })),
      setDragging: (dragging) => set({ dragging }),
      setPendingTarget: (pendingTarget) => set({ pendingTarget }),
      setWorldReady: (worldReady) => set({ worldReady }),
      markBattleStart: () => set({ battleStartedAt: Date.now() }),
      setPrefs: (patch) => set(patch),
      dismissHint: (id) => set((s) => (s.hintsSeen.includes(id) ? {} : { hintsSeen: [...s.hintsSeen, id] })),
    }),
    {
      name: UI_PREFS_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ hintsSeen: s.hintsSeen }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiPrefs>
        return {
          ...current,
          hintsSeen: Array.isArray(p.hintsSeen) ? p.hintsSeen.filter((h): h is string => typeof h === 'string') : current.hintsSeen,
        }
      },
    },
  ),
)

/** Reset the transient interaction state (new game / phase change). Prefs are kept. */
export function resetInteraction() {
  useUiStore.setState({ hover: null, carrying: null, dragging: false, pendingTarget: null, orientation: 'horizontal' })
}

// Any phase change (new game, quit, game over) drops hover / carried ship / pending target.
useGameStore.subscribe((state, prev) => {
  if (state.phase !== prev.phase) resetInteraction()
})
