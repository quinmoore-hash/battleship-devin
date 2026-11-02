import { create } from 'zustand'

/**
 * Transient On-deck runtime the HTML HUD reads (the DeckController inside the Canvas writes it once per change,
 * never per frame except during a fade). Nothing here is game state — that lives in `useGameStore().deck`.
 * The two per-frame HUD elements (floating gun label, compass arrow) are driven directly through DOM refs instead.
 */
export interface DeckRuntime {
  /** A gun stand is within reach (E mans it): its cannon index and whether it bears on the enemy waters. */
  near: { index: number; usable: boolean } | null
  /** The nearest usable gun within `STATION_APPROACH` (floating label / compass target), or null. */
  approach: number | null
  /** Black overlay opacity 0..1 (Tab ship switch, abandon-ship beat). */
  fade: number
  /** One-line nudge shown briefly ("Man a gun to fire"). */
  nudge: string | null
  /** The controller is mounted and driving the camera (3D battle, deck on). */
  active: boolean
  /** The pirate is in the air (Space hop); `src/deck/audio` plays the landing thud on the falling edge. */
  airborne: boolean
  /** Shift held while walking (the footsteps pick the run sample from this, not from the measured speed, which lags during acceleration). */
  running: boolean
  /** HUD elements the controller positions per frame (set by the HUD's callback refs). */
  labelEl: HTMLElement | null
  compassEl: HTMLElement | null
  setNear: (near: DeckRuntime['near']) => void
  setApproach: (index: number | null) => void
  setFade: (fade: number) => void
  setActive: (active: boolean) => void
  setAirborne: (airborne: boolean) => void
  setRunning: (running: boolean) => void
  showNudge: (text: string, ms?: number) => void
  setLabelEl: (el: HTMLElement | null) => void
  setCompassEl: (el: HTMLElement | null) => void
}

let nudgeTimer: ReturnType<typeof setTimeout> | undefined

export const useDeckStore = create<DeckRuntime>((set, get) => ({
  near: null,
  approach: null,
  fade: 0,
  nudge: null,
  active: false,
  airborne: false,
  running: false,
  labelEl: null,
  compassEl: null,
  setNear: (near) => {
    const cur = get().near
    if ((cur?.index ?? -1) !== (near?.index ?? -1) || cur?.usable !== near?.usable) set({ near })
  },
  setApproach: (approach) => (get().approach !== approach ? set({ approach }) : undefined),
  setFade: (fade) => (Math.abs(get().fade - fade) > 1e-3 || (fade === 0 && get().fade !== 0) ? set({ fade }) : undefined),
  setActive: (active) => (get().active !== active ? set({ active }) : undefined),
  setAirborne: (airborne) => (get().airborne !== airborne ? set({ airborne }) : undefined),
  setRunning: (running) => (get().running !== running ? set({ running }) : undefined),
  showNudge: (text, ms = 1800) => {
    set({ nudge: text })
    clearTimeout(nudgeTimer)
    nudgeTimer = setTimeout(() => set({ nudge: null }), ms)
  },
  setLabelEl: (labelEl) => (get().labelEl !== labelEl ? set({ labelEl }) : undefined),
  setCompassEl: (compassEl) => (get().compassEl !== compassEl ? set({ compassEl }) : undefined),
}))

/** Back to the idle runtime (deck off / battle over). */
export function resetDeckRuntime() {
  clearTimeout(nudgeTimer)
  useDeckStore.setState({ near: null, approach: null, fade: 0, nudge: null, active: false, airborne: false, running: false })
}
