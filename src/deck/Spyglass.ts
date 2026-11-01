/**
 * First-person Spyglass (Black Flag, on deck): runtime store + pure pose / projection maths. `G` or the HUD button arms
 * the chart power (`useUiStore().armed === 'spyglass'`); while on deck that also raises the glass (SpyglassController).
 * Looking through it and clicking a cell calls the same `useBattleController().aim(coord)` path as the chart, so the
 * rules (one look per game per side, one cell, turn kept) live in the store untouched.
 */
import { create } from 'zustand'
import type { Coord } from '../engine'
import { BOARD_LAYOUT, type BoardPlacement, type Vec3 } from '../scene/layout'
import { EYE_HEIGHT, type DeckAnchors } from './contract'
import { PITCH_LIMIT, clampToPolygon, lookAngles, lookForward, rayToCell, type Pt } from './math'

/** Camera FOV through the glass (DECK_FOV is 70). */
export const SPYGLASS_FOV = 22
/** Raise / lower blend. */
export const SPYGLASS_BLEND_S = 0.4
/** Half-range of the pan (radians) when the mouse sweeps the whole window (no pointer lock). */
export const SPYGLASS_PAN = { yaw: 0.6, pitch: 0.22 }
/** Pointer-locked pan per pixel (slower than the deck look: the view is zoomed ~3×). */
export const SPYGLASS_LOOK_PER_PIXEL = 0.0007
/** 3D reveal flash lifetime. */
export const SPYGLASS_REVEAL_MS = 1500
/** Hand sway amplitude (radians) and speed; off under reduced motion. */
export const SPYGLASS_SWAY = { amp: 0.004, hz: 0.7 }

export interface SpyglassReveal {
  coord: Coord
  seen: 'ship' | 'water'
  at: number
}

export interface SpyglassRuntime {
  /** The glass is raised (or raising). */
  up: boolean
  /** The enemy cell under the crosshair, or null (over open sea / off the board). */
  cell: Coord | null
  /** Last reveal seen through the glass (drives the 3D flash). */
  reveal: SpyglassReveal | null
  setUp: (up: boolean) => void
  setCell: (cell: Coord | null) => void
  setReveal: (reveal: SpyglassReveal | null) => void
}

export const useSpyglassStore = create<SpyglassRuntime>((set, get) => ({
  up: false,
  cell: null,
  reveal: null,
  setUp: (up) => (get().up !== up ? set({ up }) : undefined),
  setCell: (cell) => {
    const cur = get().cell
    if ((cur?.x ?? -1) !== (cell?.x ?? -1) || (cur?.y ?? -1) !== (cell?.y ?? -1)) set({ cell })
  },
  setReveal: (reveal) => set({ reveal }),
}))

export function resetSpyglass() {
  useSpyglassStore.setState({ up: false, cell: null, reveal: null })
}

const rotY = (p: Pt, yaw: number): Pt => [p[0] * Math.cos(yaw) + p[1] * Math.sin(yaw), -p[0] * Math.sin(yaw) + p[1] * Math.cos(yaw)]

/** The walkable point on the main deck nearest the enemy waters (ship space): where the lookout stands at the rail. */
export function railPoint(deck: DeckAnchors, towardLocal: Pt): Pt {
  const poly = deck.walk[0]?.points ?? []
  const len = Math.hypot(towardLocal[0], towardLocal[1]) || 1
  const far: Pt = [(towardLocal[0] / len) * 50, (towardLocal[1] / len) * 50]
  const rail = clampToPolygon(far, poly)
  // a step back from the very edge so the camera is not inside the bulwark
  return [rail[0] - (towardLocal[0] / len) * 0.04, rail[1] - (towardLocal[1] / len) * 0.04]
}

/** World eye pose at the rail facing `foeCenter`: `hullY` is the hull's current (wave) height. */
export function spyglassEye(deck: DeckAnchors, transform: { position: Vec3; rotationY: number }, hullY: number, foeCenter: Vec3): { eye: Vec3; yaw: number; pitch: number } {
  const towardWorld: Pt = [foeCenter[0] - transform.position[0], foeCenter[2] - transform.position[2]]
  const towardLocal = rotY(towardWorld, -transform.rotationY)
  const rail = railPoint(deck, towardLocal)
  const w = rotY(rail, transform.rotationY)
  const eye: Vec3 = [transform.position[0] + w[0], hullY + (deck.walk[0]?.y ?? 0) + EYE_HEIGHT, transform.position[2] + w[1]]
  return { eye, ...lookAngles(eye, foeCenter) }
}

/** Pan from a pointer position normalised to −0.5..0.5 over the window: right → yaw right, up → pitch up. */
export function pointerPan(nx: number, ny: number): { yaw: number; pitch: number } {
  const cx = Math.max(-0.5, Math.min(0.5, nx))
  const cy = Math.max(-0.5, Math.min(0.5, ny))
  return { yaw: -cx * 2 * SPYGLASS_PAN.yaw, pitch: -cy * 2 * SPYGLASS_PAN.pitch }
}

export const clampPitch = (p: number): number => Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, p))

/** Enemy cell under the crosshair for a camera at `eye` looking along (yaw, pitch); null off the board. */
export function cellUnderGlass(eye: Vec3, yaw: number, pitch: number, board: BoardPlacement = BOARD_LAYOUT.enemy): Coord | null {
  return rayToCell(eye, lookForward(yaw, pitch), BOARD_LAYOUT.surfaceY, board.origin, board.size, board.cellSize)
}

/** Hand sway offsets (radians) at time `t`; zero under reduced motion. */
export function handSway(t: number, reducedMotion: boolean): { yaw: number; pitch: number } {
  if (reducedMotion) return { yaw: 0, pitch: 0 }
  return { yaw: SPYGLASS_SWAY.amp * Math.sin(t * SPYGLASS_SWAY.hz * Math.PI * 2), pitch: SPYGLASS_SWAY.amp * 0.6 * Math.sin(t * SPYGLASS_SWAY.hz * 1.37 * Math.PI * 2 + 1) }
}
