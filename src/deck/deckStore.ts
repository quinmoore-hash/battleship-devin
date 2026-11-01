import { create } from 'zustand'
import type { Coord } from '../engine'

/**
 * Transient On-deck runtime state the HTML HUD reads (the DeckController inside the Canvas writes it once per change,
 * never per frame except during a fade). Nothing here is game state — that lives in `useGameStore().deck`.
 */
export interface DeckRuntime {
  /** A gun stand is within reach: its cannon index and whether it bears on the enemy waters. */
  near: { index: number; usable: boolean } | null
  /** The pointer is locked to the canvas (mouse look active). */
  locked: boolean
  /** Pointer lock was refused or is unsupported: arrow keys look. */
  keyboardLook: boolean
  /** The enemy cell under the crosshair while manning a gun (pointer-locked / keyboard aim), or null. */
  aim: Coord | null
  /** Black overlay opacity 0..1 (Tab ship switch, abandon-ship beat). */
  fade: number
  /** One-line nudge shown briefly ("Man a gun to fire"). */
  nudge: string | null
  /** The controller is mounted and driving the camera (3D battle, deck on). */
  active: boolean
  setNear: (near: DeckRuntime['near']) => void
  setLocked: (locked: boolean) => void
  setKeyboardLook: (on: boolean) => void
  setAim: (aim: Coord | null) => void
  setFade: (fade: number) => void
  setActive: (active: boolean) => void
  showNudge: (text: string) => void
}

let nudgeTimer: ReturnType<typeof setTimeout> | undefined

export const useDeckStore = create<DeckRuntime>((set, get) => ({
  near: null,
  locked: false,
  keyboardLook: false,
  aim: null,
  fade: 0,
  nudge: null,
  active: false,
  setNear: (near) => {
    const cur = get().near
    if ((cur?.index ?? -1) !== (near?.index ?? -1) || cur?.usable !== near?.usable) set({ near })
  },
  setLocked: (locked) => (get().locked !== locked ? set({ locked }) : undefined),
  setKeyboardLook: (keyboardLook) => (get().keyboardLook !== keyboardLook ? set({ keyboardLook }) : undefined),
  setAim: (aim) => {
    const cur = get().aim
    if ((cur?.x ?? -1) !== (aim?.x ?? -1) || (cur?.y ?? -1) !== (aim?.y ?? -1)) set({ aim })
  },
  setFade: (fade) => (Math.abs(get().fade - fade) > 1e-3 || (fade === 0 && get().fade !== 0) ? set({ fade }) : undefined),
  setActive: (active) => (get().active !== active ? set({ active }) : undefined),
  showNudge: (text) => {
    set({ nudge: text })
    clearTimeout(nudgeTimer)
    nudgeTimer = setTimeout(() => set({ nudge: null }), 1800)
  },
}))

/** Back to the idle runtime (deck off / battle over). */
export function resetDeckRuntime() {
  useDeckStore.setState({ near: null, locked: false, aim: null, fade: 0, nudge: null, active: false })
}
