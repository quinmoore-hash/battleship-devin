/**
 * Perf state: detected tier, player override and the resolved `PerfProfile`.
 * The override lives in `useGameStore().settings.quality` (persisted with the other settings) and is mirrored here.
 */
import { create } from 'zustand'
import { useGameStore } from '../store/gameStore'
import { readDeviceInfo } from './detect'
import { guessTier, lowerTier, profileFor, refineTier, resolveTier, type DeviceInfo, type PerfProfile, type QualitySetting, type Tier } from './tier'

export const QUALITY_STORAGE_KEY = 'pirate-battleship.quality'

export interface PerfState {
  device: DeviceInfo
  detected: Tier
  /** Set once the 2 s startup probe has finished. */
  probed: boolean
  setting: QualitySetting
  profile: PerfProfile
  setQuality: (q: QualitySetting) => void
  /** Called by the probe with the measured median FPS. */
  reportProbe: (fps: number) => void
  /** True once the in-battle watchdog has dropped a tier (it only ever does so once). */
  autoLowered: boolean
  /** One-time player-facing notice ("Lowered quality for smoother play"), null when nothing to show. */
  notice: string | null
  /** Watchdog hook: drop the detected tier by one when on `auto`. Returns true when it did. */
  autoLower: () => boolean
  dismissNotice: () => void
}

export const LOWERED_NOTICE = 'Lowered quality for smoother play — change it any time in Settings › Graphics quality'

function readUrlQuality(): QualitySetting | null {
  if (typeof window === 'undefined') return null
  const q = new URLSearchParams(window.location.search).get('quality')
  return q === 'low' || q === 'medium' || q === 'high' || q === 'auto' ? q : null
}

function readStoredQuality(): QualitySetting {
  const fromUrl = readUrlQuality()
  if (fromUrl) return fromUrl
  // persisted with the other settings (`battleship-devin.settings`, BUG-314); the old key is read once as a migration
  const fromSettings = useGameStore.getState().settings.quality
  if (fromSettings !== 'auto') return fromSettings
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(QUALITY_STORAGE_KEY) : null
    if (v === 'low' || v === 'medium' || v === 'high' || v === 'auto') return v
  } catch {
    /* private mode */
  }
  return 'auto'
}

/** `?gpu=low|medium|high` pins the *detected* tier (and skips the probe) so the auto path — including the
 *  in-battle watchdog — can be exercised on any machine. `?quality=` is the player override instead. */
function readUrlDetected(): Tier | null {
  if (typeof window === 'undefined') return null
  const g = new URLSearchParams(window.location.search).get('gpu')
  return g === 'low' || g === 'medium' || g === 'high' ? g : null
}

const device = readDeviceInfo()
const pinnedDetected = readUrlDetected()
const detected = pinnedDetected ?? guessTier(device)
const initialSetting = readStoredQuality()

export const usePerfStore = create<PerfState>((set, get) => ({
  device,
  detected,
  probed: pinnedDetected !== null,
  setting: initialSetting,
  profile: profileFor(resolveTier(initialSetting, detected)),
  setQuality: (setting) => {
    try {
      localStorage.setItem(QUALITY_STORAGE_KEY, setting)
    } catch {
      /* ignore */
    }
    set((s) => ({ setting, profile: profileFor(resolveTier(setting, s.detected)) }))
    if (useGameStore.getState().settings.quality !== setting) useGameStore.getState().updateSettings({ quality: setting })
  },
  reportProbe: (fps) => {
    const s = get()
    const info = { ...s.device, probeFps: fps }
    const refined = refineTier(guessTier(info), info)
    set({ device: info, detected: refined, probed: true, profile: profileFor(resolveTier(s.setting, refined)) })
  },
  autoLowered: false,
  notice: null,
  autoLower: () => {
    const s = get()
    if (s.setting !== 'auto' || s.autoLowered || s.detected === 'low') return false
    const next = lowerTier(s.detected)
    set({ detected: next, autoLowered: true, notice: LOWERED_NOTICE, profile: profileFor(next) })
    return true
  },
  dismissNotice: () => set({ notice: null }),
}))

// keep the game store's `settings.quality` and the perf override in sync both ways
if (useGameStore.getState().settings.quality !== initialSetting) useGameStore.getState().updateSettings({ quality: initialSetting })
useGameStore.subscribe((s, prev) => {
  if (s.settings.quality !== prev.settings.quality && s.settings.quality !== usePerfStore.getState().setting) {
    usePerfStore.getState().setQuality(s.settings.quality)
  }
})

/** The resolved performance profile for this device + player override. */
export const usePerf = (): PerfProfile => usePerfStore((s) => s.profile)
export const getPerf = (): PerfProfile => usePerfStore.getState().profile

/** Tier multiplier for particle counts; `scaleCount(n)` keeps at least one particle. */
export const useParticlesScale = (): number => usePerfStore((s) => s.profile.particlesScale)
export const scaleCount = (n: number, scale: number): number => Math.max(1, Math.round(n * scale))
