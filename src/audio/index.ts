/**
 * Howler-based pirate soundscape for Pirate Battleship.
 *
 *  Buses:   master → sfx / music / ambience, each a slider in `useAudioSettings` (persisted to localStorage
 *           under `battleship-devin.audio`), plus a master mute. Volume changes apply live.
 *  SFX:     `playSfx(name)` cycles variants and jitters pitch ±5%; `playSfxAt(name, worldPos)` adds camera-
 *           relative stereo pan and distance attenuation (see ./spatial.ts, `setAudioListener`).
 *           Looping SFX (`fire-loop`, `bubbles`) return a handle with `stop()`.
 *  Music:   `startMusic('menu' | 'battle')` crossfades between the two shanty variants, optionally after the
 *           intro sting; `duckMusic(ms)` pulls it down under cinematics.
 *  Ambience: `startAmbience()` runs the sea bed; `setStorm(0..1)` fades the rain/wind layer in on top.
 *  Glue:    `initAudio()` unlocks on the first gesture; `bindGameAudio()` subscribes to `useGameStore` and plays
 *           fire → whistle → impact timelines (./sequence.ts). `playCinematicAudio(event)` is the hook point for
 *           `src/cinematics` once its director lands (see README section in the PR).
 */
import { Howl, Howler } from 'howler'
import { useSyncExternalStore } from 'react'
import type { CinematicEvent } from '../cinematics/types'
import { BOARD_LAYOUT, boardCenter, cellToWorld } from '../scene/layout'
import { useGameStore } from '../store/gameStore'
import {
  AMBIENCE_FILES,
  LOOPING_SFX,
  MUSIC_FILES,
  SFX_DUCK_MS,
  SFX_FILES,
  SFX_GAIN,
  SFX_NAMES,
  audioUrls,
  resolveSfx,
  type CanonicalSfx,
  type MusicTrack,
  type Sfx,
} from './manifest'
import { broadsideTimeline, shotTimeline, type AudioCue, type BroadsideOptions, type ShotOutcome, type ShotTimingOptions } from './sequence'
import { useAudioSettings } from './settings'
import { DEFAULT_LISTENER, spatialize, type AudioListener, type SpatialOptions, type Vec3 } from './spatial'

export type { Sfx, SfxName, CanonicalSfx, LegacySfx, MusicTrack } from './manifest'
export { SFX_FILES, SFX_NAMES, LEGACY_SFX, LOOPING_SFX, MUSIC_FILES, AMBIENCE_FILES, ALL_AUDIO_FILES, audioUrls, resolveSfx } from './manifest'
export { useAudioSettings, AUDIO_SETTINGS_STORAGE_KEY, DEFAULT_AUDIO_SETTINGS, clamp01, mergeAudioSettings } from './settings'
export type { AudioSettingsState } from './settings'
export { spatialize, DEFAULT_LISTENER } from './spatial'
export type { AudioListener, SpatialOptions, Vec3 } from './spatial'
export { shotTimeline, broadsideTimeline, timelineLength, SHOT_FLIGHT_MS } from './sequence'
export type { AudioCue, ShotOutcome, ShotTimingOptions, BroadsideOptions } from './sequence'

const MUSIC_FADE_IN_MS = 1500
const MUSIC_FADE_OUT_MS = 900
const MUSIC_XFADE_MS = 2200
const INTRO_STING_LEAD_MS = 2600
const DUCK_LEVEL = 0.25
const PITCH_JITTER = 0.05

const hasDom = typeof window !== 'undefined'

// ------------------------------------------------------------------ runtime state (for React)

export interface AudioRuntimeState {
  /** True once a user gesture has resumed the AudioContext. */
  unlocked: boolean
  musicPlaying: boolean
  musicTrack: MusicTrack
  ambiencePlaying: boolean
  /** 0..1 storm layer level */
  storm: number
  ducked: boolean
}

let runtime: AudioRuntimeState = { unlocked: false, musicPlaying: false, musicTrack: 'menu', ambiencePlaying: false, storm: 0, ducked: false }
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

// ------------------------------------------------------------------ buses

function busLevels() {
  const s = useAudioSettings.getState()
  return { sfx: s.masterVolume * s.sfxVolume, music: s.masterVolume * s.musicVolume, ambience: s.masterVolume * s.ambienceVolume }
}

// ------------------------------------------------------------------ SFX

export interface SfxHandle {
  readonly name: CanonicalSfx
  readonly id: number
  /** Fade out over `fadeMs` (default 300) and stop. Safe to call twice. */
  stop(fadeMs?: number): void
  /** Re-aim a looping sound (fire on a drifting ship). */
  setPosition(world: Vec3): void
  setGain(gain: number): void
}

export interface PlayOptions {
  /** Extra gain multiplier under the SFX bus (default 1). */
  gain?: number
  /** Override the pitch jitter (`0` for exact pitch, e.g. the whistle). */
  pitchJitter?: number
  /** Force a specific variant (0-based) instead of cycling; used by the demo. */
  variant?: number
  /** Loop even if the sound isn't marked as a loop in the manifest. */
  loop?: boolean
  /** Skip the automatic music duck for this sound. */
  noDuck?: boolean
}

const NO_HANDLE: SfxHandle = { name: 'ui-click', id: -1, stop() {}, setPosition() {}, setGain() {} }

const sfxPool = new Map<CanonicalSfx, Howl[]>()
const lastVariant: Partial<Record<CanonicalSfx, number>> = {}
/** Live one-shots and loops, so bus changes apply to sounds already playing. */
const live = new Set<LiveSound>()

interface LiveSound {
  howl: Howl
  id: number
  name: CanonicalSfx
  gain: number
  spatialGain: number
  pan: number
  world?: Vec3
}

function sfxVariants(name: CanonicalSfx): Howl[] {
  let pool = sfxPool.get(name)
  if (!pool) {
    const loop = LOOPING_SFX.has(name)
    pool = SFX_FILES[name].map((file) => new Howl({ src: audioUrls(file), preload: true, loop }))
    sfxPool.set(name, pool)
  }
  return pool
}

function pickVariant(name: CanonicalSfx, forced?: number): Howl {
  const pool = sfxVariants(name)
  if (typeof forced === 'number') return pool[((forced % pool.length) + pool.length) % pool.length]
  if (pool.length === 1) return pool[0]
  let idx = Math.floor(Math.random() * pool.length)
  if (idx === lastVariant[name]) idx = (idx + 1) % pool.length
  lastVariant[name] = idx
  return pool[idx]
}

function applyLive(s: LiveSound): void {
  s.howl.volume(Math.min(1, busLevels().sfx * (SFX_GAIN[s.name] ?? 0.85) * s.gain * s.spatialGain), s.id)
  s.howl.stereo(s.pan, s.id)
}

function startSound(name: Sfx, world: Vec3 | undefined, options: PlayOptions): SfxHandle {
  if (!hasDom) return NO_HANDLE
  const sfx = resolveSfx(name)
  const { muted } = useAudioSettings.getState()
  if (muted || busLevels().sfx <= 0) return NO_HANDLE
  const howl = pickVariant(sfx, options.variant)
  const loop = options.loop ?? LOOPING_SFX.has(sfx)
  const id = howl.play()
  howl.loop(loop, id)
  const spatial = world ? spatialize(world, listener) : { pan: 0, gain: 1, distance: 0 }
  const sound: LiveSound = { howl, id, name: sfx, gain: options.gain ?? 1, spatialGain: spatial.gain, pan: spatial.pan, world }
  applyLive(sound)
  const jitter = options.pitchJitter ?? PITCH_JITTER
  if (jitter > 0) howl.rate(1 + (Math.random() * 2 - 1) * jitter, id)
  live.add(sound)
  if (!loop) howl.once('end', () => live.delete(sound), id)
  const duck = SFX_DUCK_MS[sfx]
  if (duck && !options.noDuck) duckMusic(duck)
  let stopped = false
  return {
    name: sfx,
    id,
    stop(fadeMs = 300) {
      if (stopped) return
      stopped = true
      live.delete(sound)
      if (fadeMs <= 0) {
        howl.stop(id)
        return
      }
      howl.fade(howl.volume(id) as number, 0, fadeMs, id)
      howl.once('fade', () => howl.stop(id), id)
    },
    setPosition(pos) {
      const s = spatialize(pos, listener)
      sound.world = pos
      sound.spatialGain = s.gain
      sound.pan = s.pan
      applyLive(sound)
    },
    setGain(g) {
      sound.gain = g
      applyLive(sound)
    },
  }
}

/** Play a sound (variants cycle, pitch jitters). Looping SFX keep going until you `stop()` the handle. */
export function playSfx(name: Sfx, options: PlayOptions = {}): SfxHandle {
  return startSound(name, undefined, options)
}

/** Like `playSfx` but panned and attenuated relative to the audio listener (camera). */
export function playSfxAt(name: Sfx, worldPosition: Vec3, options: PlayOptions = {}): SfxHandle {
  return startSound(name, worldPosition, options)
}

/** Stop every live SFX (loops included). */
export function stopAllSfx(fadeMs = 200): void {
  for (const s of [...live]) {
    live.delete(s)
    if (fadeMs <= 0) s.howl.stop(s.id)
    else {
      s.howl.fade(s.howl.volume(s.id) as number, 0, fadeMs, s.id)
      s.howl.once('fade', () => s.howl.stop(s.id), s.id)
    }
  }
}

/** Create every SFX Howl up front so the first shot isn't late. */
export function preloadSfx(): void {
  if (!hasDom) return
  for (const name of SFX_NAMES) sfxVariants(name)
}

// ------------------------------------------------------------------ listener (spatial)

let listener: AudioListener = DEFAULT_LISTENER

/** Tell the mixer where the camera is so `playSfxAt` pans/attenuates correctly. Cheap; call from useFrame. */
export function setAudioListener(position: Vec3, forward: Vec3 = listener.forward): void {
  listener = { position, forward }
  for (const s of live) if (s.world) {
    const sp = spatialize(s.world, listener)
    s.spatialGain = sp.gain
    s.pan = sp.pan
    applyLive(s)
  }
}

/** Convenience for three.js cameras (structurally typed so this module doesn't import three). */
export function setAudioListenerFromCamera(camera: {
  position: { x: number; y: number; z: number }
  getWorldDirection(target: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }): unknown
}): void {
  const dir = { x: 0, y: 0, z: -1, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this } }
  camera.getWorldDirection(dir)
  setAudioListener([camera.position.x, camera.position.y, camera.position.z], [dir.x, dir.y, dir.z])
}

export function getAudioListener(): AudioListener {
  return listener
}

/** Preview what `playSfxAt` would do for a position (used by the demo's spatial pad). */
export function previewSpatial(world: Vec3, options?: SpatialOptions) {
  return spatialize(world, listener, options)
}

// ------------------------------------------------------------------ music

interface Track {
  howl?: Howl
  file: string
  playing: boolean
  generation: number
}

const tracks: Record<MusicTrack, Track> = {
  menu: { file: MUSIC_FILES.menu, playing: false, generation: 0 },
  battle: { file: MUSIC_FILES.battle, playing: false, generation: 0 },
}
let currentTrack: MusicTrack = 'menu'
let musicOn = false
let introHowl: Howl | undefined
let duckTimer: ReturnType<typeof setTimeout> | undefined
let ducked = false
let pendingStart: ReturnType<typeof setTimeout> | undefined

function musicTarget(): number {
  return busLevels().music * (ducked ? DUCK_LEVEL : 1)
}

function trackHowl(track: Track): Howl {
  if (!track.howl) track.howl = new Howl({ src: audioUrls(track.file), loop: true, volume: 0, preload: true })
  return track.howl
}

function fadeInTrack(track: Track, fadeMs: number): void {
  const howl = trackHowl(track)
  track.generation++
  track.playing = true
  const from = howl.playing() ? (howl.volume() as number) : 0
  if (!howl.playing()) {
    howl.volume(0)
    howl.play()
  }
  howl.fade(from, musicTarget(), fadeMs)
}

function fadeOutTrack(track: Track, fadeMs: number): void {
  if (!track.howl || !track.playing) return
  const howl = track.howl
  const gen = ++track.generation
  track.playing = false
  howl.fade(howl.volume() as number, 0, fadeMs)
  howl.once('fade', () => {
    if (track.generation !== gen) return
    howl.stop()
  })
}

export interface StartMusicOptions {
  /** Play the drum-roll sting first and bring the loop in under its downbeat. */
  sting?: boolean
  fadeMs?: number
}

/**
 * Start (or switch to) a music variant. Switching while playing crossfades over ~2 s.
 * `startMusic()` with no args resumes the last track (menu by default) — the pre-pirate signature.
 */
export function startMusic(track: MusicTrack = currentTrack, options: StartMusicOptions = {}): void {
  if (!hasDom) return
  if (pendingStart) {
    clearTimeout(pendingStart)
    pendingStart = undefined
  }
  const switching = musicOn && track !== currentTrack
  const previous = currentTrack
  currentTrack = track
  musicOn = true
  setRuntime({ musicPlaying: true, musicTrack: track })
  if (options.sting) {
    playIntroSting()
    pendingStart = setTimeout(() => {
      pendingStart = undefined
      if (!musicOn || currentTrack !== track) return
      if (switching) fadeOutTrack(tracks[previous], MUSIC_XFADE_MS)
      fadeInTrack(tracks[track], options.fadeMs ?? MUSIC_XFADE_MS)
    }, INTRO_STING_LEAD_MS)
    return
  }
  if (switching) {
    fadeOutTrack(tracks[previous], MUSIC_XFADE_MS)
    fadeInTrack(tracks[track], options.fadeMs ?? MUSIC_XFADE_MS)
  } else if (!tracks[track].playing) {
    fadeInTrack(tracks[track], options.fadeMs ?? MUSIC_FADE_IN_MS)
  }
}

export function stopMusic(fadeMs = MUSIC_FADE_OUT_MS): void {
  if (!hasDom) return
  if (pendingStart) {
    clearTimeout(pendingStart)
    pendingStart = undefined
  }
  musicOn = false
  setRuntime({ musicPlaying: false })
  for (const t of Object.values(tracks)) fadeOutTrack(t, fadeMs)
}

/** Alias of `startMusic(track)` that reads better at call sites that only switch. */
export function setMusicTrack(track: MusicTrack): void {
  if (musicOn) startMusic(track)
  else {
    currentTrack = track
    setRuntime({ musicTrack: track })
  }
}

/** One-shot drum-roll + chord sting (also used on its own by the demo). */
export function playIntroSting(): void {
  if (!hasDom) return
  if (!introHowl) introHowl = new Howl({ src: audioUrls(MUSIC_FILES.intro), preload: true })
  const id = introHowl.play()
  introHowl.volume(busLevels().music, id)
}

export function isMusicPlaying(): boolean {
  return musicOn
}

export function currentMusicTrack(): MusicTrack {
  return currentTrack
}

/** Pull the music down for `ms` milliseconds so a big SFX or a cinematic reads clearly. */
export function duckMusic(ms: number): void {
  if (!hasDom) return
  ducked = true
  setRuntime({ ducked: true })
  for (const t of Object.values(tracks)) if (t.playing && t.howl) t.howl.fade(t.howl.volume() as number, musicTarget(), 150)
  if (duckTimer) clearTimeout(duckTimer)
  duckTimer = setTimeout(() => {
    ducked = false
    duckTimer = undefined
    setRuntime({ ducked: false })
    for (const t of Object.values(tracks)) if (t.playing && t.howl) t.howl.fade(t.howl.volume() as number, musicTarget(), 700)
  }, ms)
}

// ------------------------------------------------------------------ ambience

interface Bed {
  howl?: Howl
  file: string
  playing: boolean
  generation: number
  level: () => number
}

const sea: Bed = { file: AMBIENCE_FILES.sea, playing: false, generation: 0, level: () => busLevels().ambience }
const storm: Bed = { file: AMBIENCE_FILES.storm, playing: false, generation: 0, level: () => busLevels().ambience * stormLevel }
let stormLevel = 0
let ambienceOn = false

function bedHowl(bed: Bed): Howl {
  if (!bed.howl) bed.howl = new Howl({ src: audioUrls(bed.file), loop: true, volume: 0, preload: true })
  return bed.howl
}

function fadeBed(bed: Bed, on: boolean, fadeMs: number): void {
  const howl = bedHowl(bed)
  const gen = ++bed.generation
  if (on) {
    bed.playing = true
    const from = howl.playing() ? (howl.volume() as number) : 0
    if (!howl.playing()) {
      howl.volume(0)
      howl.play()
    }
    howl.fade(from, bed.level(), fadeMs)
  } else if (bed.playing) {
    bed.playing = false
    howl.fade(howl.volume() as number, 0, fadeMs)
    howl.once('fade', () => {
      if (bed.generation === gen) howl.stop()
    })
  }
}

export function startAmbience(): void {
  if (!hasDom || ambienceOn) return
  ambienceOn = true
  setRuntime({ ambiencePlaying: true })
  fadeBed(sea, true, 2500)
  if (stormLevel > 0) fadeBed(storm, true, 2500)
}

export function stopAmbience(): void {
  if (!hasDom || !ambienceOn) return
  ambienceOn = false
  setRuntime({ ambiencePlaying: false })
  fadeBed(sea, false, 1500)
  fadeBed(storm, false, 1500)
}

/** Fade the rain + howling-wind layer to `intensity` (0..1) on top of the sea bed. */
export function setStorm(intensity: number, fadeMs = 3000): void {
  stormLevel = Math.min(1, Math.max(0, intensity))
  setRuntime({ storm: stormLevel })
  if (!hasDom || !ambienceOn) return
  if (stormLevel > 0) {
    if (!storm.playing) fadeBed(storm, true, fadeMs)
    else storm.howl?.fade(storm.howl.volume() as number, storm.level(), fadeMs)
  } else fadeBed(storm, false, fadeMs)
}

export function isAmbiencePlaying(): boolean {
  return ambienceOn
}

// ------------------------------------------------------------------ settings bridge

export function setMasterVolume(volume: number): void {
  useAudioSettings.getState().setMasterVolume(volume)
}

export function setSfxVolume(volume: number): void {
  useAudioSettings.getState().setSfxVolume(volume)
}

export function setMusicVolume(volume: number): void {
  useAudioSettings.getState().setMusicVolume(volume)
}

export function setAmbienceVolume(volume: number): void {
  useAudioSettings.getState().setAmbienceVolume(volume)
}

export function setMuted(muted: boolean): void {
  useAudioSettings.getState().setMuted(muted)
}

function applySettings(): void {
  if (!hasDom) return
  Howler.mute(useAudioSettings.getState().muted)
  for (const t of Object.values(tracks)) if (t.playing && t.howl) t.howl.volume(musicTarget())
  for (const bed of [sea, storm]) if (bed.playing && bed.howl) bed.howl.volume(bed.level())
  for (const s of live) applyLive(s)
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
 * Browsers refuse to start an AudioContext until the user interacts with the page. Call this once at app
 * start; the first pointer/key/touch gesture resumes the context and warms up the SFX pool. Nothing is
 * played before that, so there are no autoplay warnings. Safe to call more than once.
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

// ------------------------------------------------------------------ timelines + cinematic hook

export interface TimelineHandle {
  /** Cancel cues that haven't fired yet (e.g. the player skipped the cinematic). */
  cancel(): void
  /** ms until the last cue */
  readonly length: number
}

/** Schedule a list of cues (see ./sequence.ts). Spatial cues use `playSfxAt`. */
export function playTimeline(cues: readonly AudioCue[], options: { speed?: number } = {}): TimelineHandle {
  const speed = options.speed ?? 1
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let length = 0
  const fire = (cue: AudioCue) => {
    const opts: PlayOptions = { gain: cue.gain, pitchJitter: cue.sfx === 'cannon-whistle' ? 0.02 : undefined }
    if (cue.at3d) playSfxAt(cue.sfx, cue.at3d, opts)
    else playSfx(cue.sfx, opts)
  }
  for (const cue of cues) {
    length = Math.max(length, cue.at / speed)
    if (cue.at <= 0) {
      fire(cue) // synchronous so the muzzle flash and the boom share a frame
      continue
    }
    const t = setTimeout(() => {
      timers.delete(t)
      fire(cue)
    }, cue.at / speed)
    timers.add(t)
  }
  return {
    length,
    cancel() {
      for (const t of timers) clearTimeout(t)
      timers.clear()
    },
  }
}

/** Fire a full shot sequence right now; returns the handle so a skipped cinematic can cancel the tail. */
export function playShot(outcome: ShotOutcome, options: ShotTimingOptions = {}): TimelineHandle {
  return playTimeline(shotTimeline(outcome, options))
}

/** The demo's "fire a broadside" button. */
export function playBroadside(options: BroadsideOptions = {}): TimelineHandle {
  return playTimeline(broadsideTimeline(options))
}

function fastCues(): boolean {
  const { settings } = useGameStore.getState()
  return settings.reducedMotion || settings.cinematics !== 'full'
}

function fleetGunPosition(by: 'human' | 'enemy'): Vec3 {
  return boardCenter(by === 'human' ? BOARD_LAYOUT.player : BOARD_LAYOUT.enemy)
}

function targetPosition(by: 'human' | 'enemy', coord: { x: number; y: number }): Vec3 {
  const board = by === 'human' ? BOARD_LAYOUT.enemy : BOARD_LAYOUT.player
  return cellToWorld(coord, board.origin, board.cellSize)
}

/**
 * Hook point for `src/cinematics`: call this when a cinematic starts so the audio lines up with the visuals
 * (the director owns timing; pass `flightMs` for the shot's actual ball flight). Until the director lands,
 * `bindGameAudio` drives the same cues from store events.
 */
export function playCinematicAudio(event: CinematicEvent, options: { flightMs?: number; fast?: boolean } = {}): TimelineHandle {
  const fast = options.fast ?? fastCues()
  switch (event.type) {
    case 'shot':
      duckMusic(fast ? 1200 : 3000)
      return playShot(event.result.outcome, {
        fast,
        flightMs: options.flightMs,
        from: fleetGunPosition(event.by),
        to: targetPosition(event.by, event.target),
        byPlayer: event.by === 'human',
      })
    case 'sink': {
      duckMusic(fast ? 2000 : 6000)
      const pos = fleetGunPosition(event.owner === 'human' ? 'enemy' : 'human')
      return playTimeline([
        { at: 0, sfx: 'mast-snap', at3d: pos },
        { at: 500, sfx: 'sinking-groan', at3d: pos },
        { at: 1200, sfx: 'bubbles', at3d: pos, gain: 0.7 },
        ...(event.owner === 'enemy' ? [{ at: 1600, sfx: 'crew-cheer' as CanonicalSfx }] : [{ at: 900, sfx: 'hull-creak' as CanonicalSfx, at3d: pos }]),
      ])
    }
    case 'battle-start':
      startMusic('battle', { sting: true })
      return playTimeline([
        { at: 300, sfx: 'sail-flap' },
        { at: 1200, sfx: 'crew-cheer', gain: 0.7 },
      ])
    case 'victory':
      duckMusic(fast ? 2500 : 8000)
      return playTimeline(
        event.winner === 'human'
          ? [{ at: 0, sfx: 'bell-victory' }, { at: 600, sfx: 'crew-cheer' }]
          : [{ at: 0, sfx: 'drum-defeat' }, { at: 400, sfx: 'sinking-groan', gain: 0.6 }],
      )
  }
}

// ------------------------------------------------------------------ game glue

/**
 * One-call wiring from `useGameStore` to the soundscape:
 *  - menu → placement: sea ambience + menu shanty; placing a ship → `place-ship`
 *  - placement → battle: intro sting, crossfade to the battle variant
 *  - every shot event: fire → whistle → splash / wood (+ mast snap → groan → bubbles → cheer on a sink), panned
 *    from the shooter's fleet to the target cell
 *  - gameover: bell + cheer or defeat drums, music back to the menu variant
 * Returns an unsubscribe function. Cue timing follows `settings.reducedMotion` / `settings.cinematics`.
 */
export function bindGameAudio(): () => void {
  if (!hasDom) return () => {}
  initAudio()
  let prev = useGameStore.getState()
  const timelines = new Set<TimelineHandle>()
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
        if (before.phase === 'menu') startMusic('menu')
        else setMusicTrack('menu')
      }
      if (state.phase === 'battle') timelines.add(playCinematicAudio({ type: 'battle-start' }))
      if (state.phase === 'gameover') {
        const winner = state.winner ?? 'enemy'
        later(fastCues() ? 900 : 2600, () => timelines.add(playCinematicAudio({ type: 'victory', winner })))
        later(fastCues() ? 4000 : 9000, () => startMusic('menu'))
      }
      if (state.phase === 'menu') {
        setMusicTrack('menu')
      }
    }
    if (state.phase === 'placement' && state.playerBoard.ships.length > before.playerBoard.ships.length) {
      playSfx('place-ship')
    }
    if (state.events.length > before.events.length) {
      const event = state.events[state.events.length - 1]
      timelines.add(
        playCinematicAudio({ type: 'shot', by: event.by, target: event.result.coord, result: event.result }),
      )
    }
  })
  return () => {
    unsub()
    for (const t of timers) clearTimeout(t)
    for (const tl of timelines) tl.cancel()
  }
}
