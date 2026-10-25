/**
 * Howler-based audio for Devin the Otter: Battleship.
 *
 *  - `playSfx(name)` picks a random variant and nudges pitch ±5% so repeats don't sound robotic.
 *  - `startMusic()` / `stopMusic()` crossfade the 64 s loop; `sunk` / `victory` / `defeat` duck it briefly.
 *  - `startAmbience()` / `stopAmbience()` run the river-and-birds bed under everything.
 *  - `useAudioSettings` (zustand, persisted to localStorage) is the source of truth for volumes + mute;
 *    `setSfxVolume` / `setMusicVolume` / `setMuted` are thin wrappers over it.
 *  - `initAudio()` registers one-shot gesture listeners that resume the AudioContext and preload the SFX.
 *  - `bindGameAudio()` is optional glue that plays sounds from `useGameStore` changes.
 */
import { Howl, Howler } from 'howler'
import { useSyncExternalStore } from 'react'
import { useGameStore } from '../store/gameStore'
import { LOOP_FILES, SFX_FILES, SFX_NAMES, audioUrls, type Sfx } from './manifest'
import { useAudioSettings } from './settings'

export type { Sfx } from './manifest'
export { SFX_FILES, SFX_NAMES, audioUrls } from './manifest'
export { useAudioSettings, AUDIO_SETTINGS_STORAGE_KEY, DEFAULT_AUDIO_SETTINGS, clamp01 } from './settings'
export type { AudioSettingsState } from './settings'

const MUSIC_FADE_IN_MS = 1500
const MUSIC_FADE_OUT_MS = 900
const AMBIENCE_GAIN = 0.6
const DUCK_LEVEL = 0.25
const DUCK_MS: Partial<Record<Sfx, number>> = { sunk: 1800, victory: 2600, defeat: 2200 }
const PITCH_JITTER = 0.05

const hasDom = typeof window !== 'undefined'

// ------------------------------------------------------------------ runtime state (for React)

export interface AudioRuntimeState {
  /** True once a user gesture has resumed the AudioContext. */
  unlocked: boolean
  musicPlaying: boolean
  ambiencePlaying: boolean
}

let runtime: AudioRuntimeState = { unlocked: false, musicPlaying: false, ambiencePlaying: false }
const runtimeListeners = new Set<() => void>()

function setRuntime(patch: Partial<AudioRuntimeState>): void {
  runtime = { ...runtime, ...patch }
  for (const l of runtimeListeners) l()
}

export function getAudioRuntime(): AudioRuntimeState {
  return runtime
}

export function subscribeAudioRuntime(listener: () => void): () => void {
  runtimeListeners.add(listener)
  return () => runtimeListeners.delete(listener)
}

/** React hook over the non-persisted runtime flags (unlock state, which loops are playing). */
export function useAudioRuntime(): AudioRuntimeState {
  return useSyncExternalStore(subscribeAudioRuntime, getAudioRuntime, getAudioRuntime)
}

// ------------------------------------------------------------------ SFX

const sfxPool = new Map<Sfx, Howl[]>()
let lastVariant: Partial<Record<Sfx, number>> = {}

function sfxVariants(name: Sfx): Howl[] {
  let pool = sfxPool.get(name)
  if (!pool) {
    pool = SFX_FILES[name].map((file) => new Howl({ src: audioUrls(file), preload: true }))
    sfxPool.set(name, pool)
  }
  return pool
}

function pickVariant(name: Sfx): Howl {
  const pool = sfxVariants(name)
  if (pool.length === 1) return pool[0]
  let idx = Math.floor(Math.random() * pool.length)
  if (idx === lastVariant[name]) idx = (idx + 1) % pool.length
  lastVariant[name] = idx
  return pool[idx]
}

export function playSfx(name: Sfx): void {
  if (!hasDom) return
  const { muted, sfxVolume } = useAudioSettings.getState()
  if (muted || sfxVolume <= 0) return
  const howl = pickVariant(name)
  const id = howl.play()
  howl.volume(sfxVolume, id)
  howl.rate(1 + (Math.random() * 2 - 1) * PITCH_JITTER, id)
  const duck = DUCK_MS[name]
  if (duck) duckMusic(duck)
}

/** Create every SFX Howl up front so the first shot isn't late. */
export function preloadSfx(): void {
  if (!hasDom) return
  for (const name of SFX_NAMES) sfxVariants(name)
}

// ------------------------------------------------------------------ loops (music + ambience)

interface Loop {
  howl?: Howl
  file: string
  state: 'stopped' | 'playing' | 'stopping'
  gain: () => number
  generation: number
}

const music: Loop = { file: LOOP_FILES.music, state: 'stopped', generation: 0, gain: () => musicTarget() }
const ambience: Loop = {
  file: LOOP_FILES.ambience,
  state: 'stopped',
  generation: 0,
  gain: () => useAudioSettings.getState().musicVolume * AMBIENCE_GAIN,
}

let duckTimer: ReturnType<typeof setTimeout> | undefined
let ducked = false

function musicTarget(): number {
  return useAudioSettings.getState().musicVolume * (ducked ? DUCK_LEVEL : 1)
}

function loopHowl(loop: Loop): Howl {
  if (!loop.howl) {
    loop.howl = new Howl({ src: audioUrls(loop.file), loop: true, volume: 0, preload: true })
  }
  return loop.howl
}

function startLoop(loop: Loop, fadeMs: number): void {
  if (!hasDom || loop.state === 'playing') return
  const howl = loopHowl(loop)
  loop.generation++
  setLoopState(loop, 'playing')
  const from = loop.howl?.playing() ? (howl.volume() as number) : 0
  if (!howl.playing()) {
    howl.volume(0)
    howl.play()
  }
  howl.fade(from, loop.gain(), fadeMs)
}

function stopLoop(loop: Loop, fadeMs: number): void {
  if (!hasDom || !loop.howl || loop.state !== 'playing') return
  const howl = loop.howl
  const gen = ++loop.generation
  setLoopState(loop, 'stopping')
  howl.fade(howl.volume() as number, 0, fadeMs)
  howl.once('fade', () => {
    if (loop.generation !== gen) return
    howl.stop()
    setLoopState(loop, 'stopped')
  })
}

function setLoopState(loop: Loop, state: Loop['state']): void {
  loop.state = state
  const playing = state === 'playing'
  if (loop === music) setRuntime({ musicPlaying: playing })
  else setRuntime({ ambiencePlaying: playing })
}

function applyLoopVolume(loop: Loop): void {
  if (loop.state !== 'playing' || !loop.howl) return
  loop.howl.volume(loop.gain())
}

export function startMusic(): void {
  startLoop(music, MUSIC_FADE_IN_MS)
}

export function stopMusic(): void {
  stopLoop(music, MUSIC_FADE_OUT_MS)
}

export function startAmbience(): void {
  startLoop(ambience, 2500)
}

export function stopAmbience(): void {
  stopLoop(ambience, 1500)
}

export function isMusicPlaying(): boolean {
  return music.state === 'playing'
}

export function isAmbiencePlaying(): boolean {
  return ambience.state === 'playing'
}

/** Pull the music down for `ms` milliseconds so a big SFX (sunk / victory / defeat) reads clearly. */
export function duckMusic(ms: number): void {
  if (music.state !== 'playing' || !music.howl) return
  const howl = music.howl
  ducked = true
  howl.fade(howl.volume() as number, musicTarget(), 150)
  if (duckTimer) clearTimeout(duckTimer)
  duckTimer = setTimeout(() => {
    ducked = false
    duckTimer = undefined
    if (music.state === 'playing') howl.fade(howl.volume() as number, musicTarget(), 700)
  }, ms)
}

// ------------------------------------------------------------------ settings bridge

export function setSfxVolume(volume: number): void {
  useAudioSettings.getState().setSfxVolume(volume)
}

export function setMusicVolume(volume: number): void {
  useAudioSettings.getState().setMusicVolume(volume)
}

export function setMuted(muted: boolean): void {
  useAudioSettings.getState().setMuted(muted)
}

function applySettings(): void {
  if (!hasDom) return
  const { muted } = useAudioSettings.getState()
  Howler.mute(muted)
  applyLoopVolume(music)
  applyLoopVolume(ambience)
}

if (hasDom) {
  applySettings()
  useAudioSettings.subscribe(applySettings)
}

// ------------------------------------------------------------------ unlock

let initialised = false

export function isAudioUnlocked(): boolean {
  return runtime.unlocked
}

function markUnlocked(): void {
  if (!runtime.unlocked) setRuntime({ unlocked: true })
}

/**
 * Browsers refuse to start an AudioContext until the user interacts with the page. Call this once
 * at app start; the first pointer/key/touch gesture resumes the context and warms up the SFX pool.
 * Safe to call more than once.
 */
export function initAudio(): void {
  if (!hasDom || initialised) return
  initialised = true
  Howler.autoUnlock = true
  const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchend']
  const onGesture = () => {
    preloadSfx() // creating a Howl during the gesture also creates/unlocks Howler.ctx
    const ctx = Howler.ctx as AudioContext | undefined
    const finish = () => {
      if (!Howler.usingWebAudio || (Howler.ctx as AudioContext | undefined)?.state === 'running') {
        markUnlocked()
        for (const e of events) window.removeEventListener(e, onGesture, true)
      }
    }
    const resumed = ctx?.resume?.()
    if (resumed && typeof resumed.then === 'function') resumed.then(finish, finish)
    else finish()
  }
  for (const e of events) window.addEventListener(e, onGesture, true)
  if ((Howler.ctx as AudioContext | undefined)?.state === 'running') markUnlocked()
}

// ------------------------------------------------------------------ game glue

const RESULT_DELAY_MS = 350

/**
 * Optional one-call wiring: plays `place` when a ship is placed, `fire` + `hit`/`miss`/`sunk` for every shot,
 * `victory` / `defeat` at game over, and starts music + ambience when a game begins.
 * Returns an unsubscribe function. The UI may instead call `playSfx` itself for tighter animation sync.
 */
export function bindGameAudio(): () => void {
  if (!hasDom) return () => {}
  initAudio()
  let prev = useGameStore.getState()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t)
      fn()
    }, ms)
    timers.add(t)
  }
  const unsub = useGameStore.subscribe((state) => {
    const before = prev
    prev = state
    if (state.phase !== before.phase) {
      if (state.phase === 'placement') {
        startAmbience()
        startMusic()
      }
      if (state.phase === 'gameover') {
        later(RESULT_DELAY_MS + 500, () => playSfx(state.winner === 'human' ? 'victory' : 'defeat'))
      }
    }
    if (state.phase === 'placement' && state.playerBoard.ships.length > before.playerBoard.ships.length) {
      playSfx('place')
    }
    if (state.events.length > before.events.length) {
      const event = state.events[state.events.length - 1]
      playSfx('fire')
      later(RESULT_DELAY_MS, () => playSfx(event.result.outcome))
    }
  })
  return () => {
    unsub()
    for (const t of timers) clearTimeout(t)
  }
}
