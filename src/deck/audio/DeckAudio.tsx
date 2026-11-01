/**
 * Deck audio layer (only while the DeckController is active). Mounted inside <OceanScene> after <DeckController> so its
 * useFrame runs after the camera has been placed:
 *   - audio listener follows the deck camera every frame (restored to the overview listener on toggle off)
 *   - ambience: hull creaks (4–9 s), rigging strain on wave peaks (from the hull's wave height), water lapping, a wind
 *     loop whose gain follows the weather; all spatialised from the ship, ducked under cinematic cues
 *   - footsteps from the camera's horizontal travel (none while manning); landing thud if a jump state is exposed
 *   - crew voice lines (rate-limited): chatter, "Run out the gun!" on manning, "Fire!", cheer/groan on the result,
 *     "Brace!" when the enemy aims, panic on abandon-ship; underwater muffle during abandon / thrown-overboard beats
 * Nothing here touches the camera or the game state.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { DEFAULT_LISTENER, playSfx, playSfxAt, preloadDeckSfx, setAudioListener, setAudioListenerFromCamera, type SfxHandle, type Vec3 } from '../../audio'
import { director } from '../../cinematics'
import { BOARD_LAYOUT } from '../../scene/layout'
import { sampleWaveHeight } from '../../scene/waves'
import { shipWorldTransform } from '../../ships'
import { ownBoardKey, selectSkyWeather, useGameStore } from '../../store/gameStore'
import { useBattleController } from '../../ui/battleController'
import { deckBus } from '../contract'
import { useDeckStore } from '../deckStore'
import { RUN_SPEED, WALK_SPEED } from '../math'
import { DUCK_GAIN, createAmbience, windGainFor } from './ambience'
import { useDeckAudioStore } from './deckAudioStore'
import { createFootsteps } from './footsteps'
import { setUnderwater } from './muffle'
import { VOICE_SFX, crewVoice, type VoiceCue } from './voice'

const CHATTER_MIN_S = 14
const CHATTER_MAX_S = 26
/** Swim phase length used when a beat does not say (abandon-ship fade ≈ 2.4 s). */
const SWIM_MS = 2600
/** Cheer / groan this long after "Fire!" (≈ the ball's flight in the shot cinematic). */
const REACTION_MS = 1100

type Underwaterish = { type: string; seconds?: number; ms?: number }

export function DeckAudio() {
  const camera = useThree((s) => s.camera)
  const active = useDeckStore((s) => s.active)
  const shipUid = useGameStore((s) => s.deck.shipUid)
  const perspective = useGameStore((s) => s.perspective)

  const amb = useRef(createAmbience())
  const steps = useRef(createFootsteps())
  const wind = useRef<SfxHandle | null>(null)
  const lastCam = useRef<{ x: number; z: number } | null>(null)
  const chatterIn = useRef(CHATTER_MIN_S)
  const shipPos = useRef<Vec3>([0, 0, 0])
  const airborne = useRef(false)
  const underwaterTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const say = (cue: VoiceCue, detail?: string) => {
    if (!crewVoice.request(cue, performance.now())) return false
    useDeckAudioStore.getState().log(VOICE_SFX[cue], detail)
    playSfxAt(VOICE_SFX[cue], shipPos.current, { noDuck: true })
    return true
  }

  useEffect(() => {
    if (!active) return
    preloadDeckSfx()
    const store = useDeckAudioStore.getState()
    store.reset()
    amb.current.reset()
    steps.current.reset()
    crewVoice.reset()
    lastCam.current = null

    const g0 = useGameStore.getState()
    const ship0 = g0[ownBoardKey(g0.perspective)].ships.find((s) => s.uid === g0.deck.shipUid)
    if (ship0) shipPos.current = shipWorldTransform(ship0, BOARD_LAYOUT[g0.perspective === 'human' ? 'player' : 'enemy'].origin).position

    // wind loop: gain = weather × cinematic duck
    const applyWind = () => {
      const g = useGameStore.getState()
      const gain = windGainFor(selectSkyWeather(g)) * (director.store.getState().busy ? DUCK_GAIN : 1)
      wind.current?.setGain(gain)
      useDeckAudioStore.getState().setWind(gain)
    }
    store.log('wind-sails', `loop · ${selectSkyWeather(g0)}`)
    wind.current = playSfxAt('wind-sails', shipPos.current, { gain: windGainFor(selectSkyWeather(g0)), noDuck: true })
    applyWind()
    const unsubWeather = useGameStore.subscribe((s, prev) => {
      if (selectSkyWeather(s) !== selectSkyWeather(prev)) {
        store.log('wind-sails', `gain → ${selectSkyWeather(s)}`)
        applyWind()
      }
      // manning a gun: the gun captain calls the crew to run it out
      if (s.deck.station !== null && prev.deck.station !== s.deck.station) say('gun-call-run-out', 'manned')
    })
    const unsubDirector = director.store.subscribe((s, prev) => {
      if (s.busy !== prev.busy) applyWind()
    })
    // turn beats → gun crew calls
    const unsubBeat = useBattleController.subscribe((s, prev) => {
      if (s.beat === prev.beat) return
      const b = s.beat
      if (b.phase === 'player-shot' && b.result) {
        // the beat carries the result up front (turnFlow); the crew reacts once the ball has flown
        say('gun-call-fire', 'fire')
        const outcome = b.result.outcome
        clearTimeout(reactionTimer.current)
        reactionTimer.current = setTimeout(() => say(outcome === 'miss' || outcome === 'lost' ? 'crew-groan' : 'crew-cheer', outcome), REACTION_MS)
      } else if (b.phase === 'enemy-aiming') say('crew-brace', 'incoming')
      else if (b.phase === 'enemy-shot' && b.result?.outcome === 'sunk') say('crew-panic', 'sunk')
    })
    const underwaterFor = (ms: number) => {
      useDeckAudioStore.getState().log('underwater', `muffle ${ms} ms`)
      setUnderwater(true)
      useDeckAudioStore.getState().setUnderwater(true)
      clearTimeout(underwaterTimer.current)
      underwaterTimer.current = setTimeout(() => {
        setUnderwater(false)
        useDeckAudioStore.getState().setUnderwater(false)
      }, ms)
    }
    const unsubBus = deckBus.on((e) => {
      const ev = e as Underwaterish
      if (ev.type === 'abandon-ship') {
        say('crew-panic', 'abandon ship')
        underwaterFor(SWIM_MS)
      } else if (ev.type === 'thrown-overboard' || ev.type === 'overboard' || ev.type === 'swim') {
        // session B's beat (not on main yet): guard on the name, take its duration if it gives one
        underwaterFor(ev.ms ?? (ev.seconds ? ev.seconds * 1000 : SWIM_MS))
      }
    })
    return () => {
      unsubWeather()
      unsubDirector()
      unsubBeat()
      unsubBus()
      wind.current?.stop(400)
      wind.current = null
      clearTimeout(underwaterTimer.current)
      clearTimeout(reactionTimer.current)
      setUnderwater(false)
      useDeckAudioStore.getState().setUnderwater(false)
      setAudioListener(DEFAULT_LISTENER.position, DEFAULT_LISTENER.forward)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, shipUid, perspective])

  useFrame((state, delta) => {
    if (!active) return
    const dt = Math.min(delta, 0.25)
    const t = state.clock.elapsedTime
    const g = useGameStore.getState()
    const log = useDeckAudioStore.getState().log

    setAudioListenerFromCamera(camera)

    // ship position + wave height (same sampler the hull uses) drives the rigging-strain peaks
    const ship = g[ownBoardKey(g.perspective)].ships.find((s) => s.uid === g.deck.shipUid)
    if (ship) {
      const { position } = shipWorldTransform(ship, BOARD_LAYOUT[g.perspective === 'human' ? 'player' : 'enemy'].origin)
      const y = position[1] + sampleWaveHeight(position[0], position[2], t)
      shipPos.current = [position[0], y, position[2]]
      const duck = director.store.getState().busy ? DUCK_GAIN : 1
      for (const cue of amb.current.tick(dt, y)) {
        log(cue, duck < 1 ? 'ducked' : undefined)
        playSfxAt(cue, shipPos.current, { gain: duck, noDuck: true })
      }
      if ((t * 2) % 2 < dt * 2) wind.current?.setPosition(shipPos.current)
    }

    // footsteps from the camera's horizontal travel (the hull's wave motion is almost all vertical)
    const manning = g.deck.station !== null
    const cx = camera.position.x
    const cz = camera.position.z
    if (lastCam.current && !manning) {
      const dist = Math.hypot(cx - lastCam.current.x, cz - lastCam.current.z)
      const running = useDeckStore.getState().running || dist / dt > (WALK_SPEED + RUN_SPEED) / 2
      for (const s of steps.current.advance(dist, dt, running)) {
        log('footstep', running ? 'run' : 'walk')
        playSfx('footstep', { gain: s.gain, noDuck: true })
      }
    } else if (manning) steps.current.reset()
    lastCam.current = { x: cx, z: cz }
    // landing thud, if the third-person controller exposes an airborne flag on the deck runtime
    const air = Boolean((useDeckStore.getState() as { airborne?: boolean; jumping?: boolean }).airborne ?? (useDeckStore.getState() as { jumping?: boolean }).jumping)
    if (airborne.current && !air) {
      log('footstep-land', 'landed')
      playSfx('footstep-land', { noDuck: true })
    }
    airborne.current = air

    // occasional deck-hand chatter, never during a cinematic beat
    chatterIn.current -= dt
    if (chatterIn.current <= 0) {
      chatterIn.current = CHATTER_MIN_S + Math.random() * (CHATTER_MAX_S - CHATTER_MIN_S)
      if (!director.store.getState().busy) say('crew-call', 'chatter')
    }
  })
  return null
}
