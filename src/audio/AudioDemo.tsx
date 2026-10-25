import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { BOARD_LAYOUT, boardCenter } from '../scene/layout'
import { AudioSettings } from './AudioSettings'
import './audio.css'
import {
  AUDIO_SETTINGS_STORAGE_KEY,
  LOOPING_SFX,
  SFX_FILES,
  SFX_NAMES,
  broadsideTimeline,
  duckMusic,
  initAudio,
  playIntroSting,
  playSfx,
  playSfxAt,
  playTimeline,
  previewSpatial,
  setStorm,
  shotTimeline,
  startAmbience,
  startMusic,
  stopAllSfx,
  stopAmbience,
  stopMusic,
  useAudioRuntime,
  useAudioSettings,
  type AudioCue,
  type CanonicalSfx,
  type SfxHandle,
  type ShotOutcome,
  type TimelineHandle,
  type Vec3,
} from './index'

const DESCRIPTIONS: Record<CanonicalSfx, string> = {
  'cannon-fire': 'deep boom + crack, 3 guns',
  'cannon-whistle': 'ball in flight, pitch falls',
  'splash-miss': 'plunge + spray, 3 variants',
  'impact-wood': 'splinter crack + thud, 3 variants',
  'fire-loop': 'seamless deck fire (loop)',
  'hull-creak': 'timbers under strain',
  'mast-snap': 'crack, canvas tearing, spar in water',
  'sinking-groan': 'hull groan, water rushing in',
  bubbles: 'air escaping the wreck (loop)',
  'crew-shout-hit': '"Hit!" from the gun deck',
  'crew-cheer': '"Huzzah!" chorus',
  'bell-victory': 'ship\u2019s bell peal + fanfare',
  'drum-defeat': 'funeral drums + low horn',
  'ui-click': 'wooden tick',
  'ui-hover': 'soft tick',
  'place-ship': 'ship set on the water',
  'rotate-ship': 'rope + wood turn',
  'sail-flap': 'canvas snapping in the wind',
  thunder: 'storm weather',
  gull: 'passing gull, 2 variants',
}

// top-down pad: x -8..8 (world x), y maps to world z -16..6 (enemy fleet at the top, player at the bottom)
const PAD = { xMin: -9, xMax: 9, zMin: -17, zMax: 6 }
const PLAYER = boardCenter(BOARD_LAYOUT.player)
const ENEMY = boardCenter(BOARD_LAYOUT.enemy)
const GUNS: Vec3[] = [-4, -2, 0, 2, 4].map((x) => [PLAYER[0] + x, 0.6, PLAYER[2] - 3])
const TARGETS: Vec3[] = [-3.5, -1, 1.5, 3, 0].map((x) => [ENEMY[0] + x, 0.2, ENEMY[2] + (x % 2 ? 2 : -1)])
const ENEMY_GUNS: Vec3[] = [3, 1, -1, -3].map((x) => [ENEMY[0] + x, 0.6, ENEMY[2] + 3])
const PLAYER_TARGETS: Vec3[] = [2, -2, 3.5, -0.5].map((x) => [PLAYER[0] + x, 0.2, PLAYER[2] + 1])

interface LogEntry {
  id: number
  at: number
  text: string
}

/**
 * Review page for the pirate soundscape (`?audio-demo`): every SFX + variant, music variants with crossfade and
 * sting, sea/storm ambience, a spatial pad, the full mixer, and a "fire a broadside" sequence.
 */
export function AudioDemo() {
  useEffect(() => initAudio(), [])
  const runtime = useAudioRuntime()
  const settings = useAudioSettings()
  const [persisted, setPersisted] = useState('')
  const [fast, setFast] = useState(false)
  const [log, setLog] = useState<LogEntry[]>([])
  const [pad, setPad] = useState<{ world: Vec3; pan: number; gain: number } | null>(null)
  const loops = useRef(new Map<CanonicalSfx, SfxHandle>())
  const [loopState, setLoopState] = useState<Record<string, boolean>>({})
  const timeline = useRef<TimelineHandle | null>(null)
  const logTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const logId = useRef(0)

  useEffect(() => {
    const read = () => setPersisted(localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY) ?? '(nothing saved yet)')
    read()
    return useAudioSettings.subscribe(() => setTimeout(read, 0))
  }, [])

  useEffect(
    () => () => {
      timeline.current?.cancel()
      for (const t of logTimers.current) clearTimeout(t)
    },
    [],
  )

  const toggleLoop = (name: CanonicalSfx) => {
    const current = loops.current.get(name)
    if (current) {
      current.stop(400)
      loops.current.delete(name)
    } else {
      loops.current.set(name, playSfx(name))
    }
    setLoopState((s) => ({ ...s, [name]: !current }))
  }

  const runCues = (title: string, cues: AudioCue[]) => {
    timeline.current?.cancel()
    for (const t of logTimers.current) clearTimeout(t)
    logTimers.current = []
    setLog([{ id: ++logId.current, at: 0, text: `▶ ${title}` }])
    timeline.current = playTimeline(cues)
    for (const cue of cues) {
      const t = setTimeout(() => {
        const where = cue.at3d ? ` @ x${cue.at3d[0].toFixed(1)} z${cue.at3d[2].toFixed(1)}` : ''
        setLog((l) => [...l.slice(-13), { id: ++logId.current, at: cue.at, text: `${cue.sfx}${where}` }])
      }, cue.at)
      logTimers.current.push(t)
    }
  }

  const broadside = () =>
    runCues('Broadside: 5 guns, player → enemy fleet', broadsideTimeline({ guns: 5, fast, byPlayer: true, gunPositions: GUNS, targetPositions: TARGETS }))
  const returnFire = () =>
    runCues('Enemy returns fire: 4 guns', broadsideTimeline({ guns: 4, spacingMs: 260, fast, outcomes: ['hit', 'miss', 'hit', 'miss'], gunPositions: ENEMY_GUNS, targetPositions: PLAYER_TARGETS }))
  const singleShot = (outcome: ShotOutcome) => runCues(`Single shot: ${outcome}`, shotTimeline(outcome, { fast, from: GUNS[2], to: TARGETS[1], byPlayer: true }))

  const onPad = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const u = (e.clientX - rect.left) / rect.width
    const v = (e.clientY - rect.top) / rect.height
    const world: Vec3 = [PAD.xMin + u * (PAD.xMax - PAD.xMin), 0.2, PAD.zMin + v * (PAD.zMax - PAD.zMin)]
    const s = previewSpatial(world)
    setPad({ world, pan: s.pan, gain: s.gain })
    playSfxAt('splash-miss', world)
  }

  const padDot = (w: Vec3) => ({ left: `${((w[0] - PAD.xMin) / (PAD.xMax - PAD.xMin)) * 100}%`, top: `${((w[2] - PAD.zMin) / (PAD.zMax - PAD.zMin)) * 100}%` })

  return (
    <main className="audio-demo" data-testid="audio-demo">
      <header>
        <div>
          <h1>Pirate Battleship — audio review</h1>
          <p className="audio-demo__sub">
            All {SFX_NAMES.length} sounds, music variants and ambience are generated by <code>scripts/generate-audio.mjs</code> (no samples).
          </p>
        </div>
      </header>

      {!runtime.unlocked && (
        <div className="audio-demo__banner" data-testid="audio-demo-locked">
          Audio is locked until you click or press a key (browser autoplay policy).
        </div>
      )}

      <section className="audio-demo__section">
        <h2>Mixer</h2>
        <div className="audio-demo__mixer">
          <AudioSettings showAllBuses testSfx="cannon-fire" />
          <div>
            <p className="audio-demo__hint">
              Persisted to <code>localStorage['{AUDIO_SETTINGS_STORAGE_KEY}']</code>:
            </p>
            <pre data-testid="audio-demo-persisted">{persisted}</pre>
            <p className="audio-demo__hint" data-testid="audio-demo-runtime">
              unlocked: {String(runtime.unlocked)} · music: {runtime.musicPlaying ? runtime.musicTrack : 'off'}
              {runtime.ducked ? ' (ducked)' : ''} · ambience: {runtime.ambiencePlaying ? `on, storm ${Math.round(runtime.storm * 100)}%` : 'off'} ·
              muted: {String(settings.muted)}
            </p>
          </div>
        </div>
      </section>

      <section className="audio-demo__section">
        <h2>Music — sea shanty, 104 BPM, D dorian</h2>
        <div className="audio-demo__loops">
          <button type="button" data-testid="audio-demo-music-menu" aria-pressed={runtime.musicPlaying && runtime.musicTrack === 'menu'} onClick={() => startMusic('menu')}>
            Menu shanty
          </button>
          <button type="button" data-testid="audio-demo-music-battle" aria-pressed={runtime.musicPlaying && runtime.musicTrack === 'battle'} onClick={() => startMusic('battle')}>
            Battle variant
          </button>
          <button type="button" data-testid="audio-demo-music-sting" onClick={() => startMusic('battle', { sting: true })}>
            Sting → battle
          </button>
          <button type="button" onClick={() => playIntroSting()}>
            Sting only
          </button>
          <button type="button" onClick={() => duckMusic(3000)}>
            Duck 3 s
          </button>
          <button type="button" data-testid="audio-demo-music-stop" onClick={() => stopMusic()}>
            Stop music
          </button>
        </div>
        <p className="audio-demo__hint">Switching variants while playing crossfades over ~2 s; the sting leads into the battle loop on its downbeat.</p>
      </section>

      <section className="audio-demo__section">
        <h2>Ambience — sea bed + storm layer</h2>
        <div className="audio-demo__loops">
          <button type="button" data-testid="audio-demo-ambience" aria-pressed={runtime.ambiencePlaying} onClick={() => (runtime.ambiencePlaying ? stopAmbience() : startAmbience())}>
            {runtime.ambiencePlaying ? 'Stop sea ambience' : 'Start sea ambience'}
          </button>
          <label className="audio-demo__storm">
            Storm
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={runtime.storm}
              data-testid="audio-demo-storm"
              aria-label="Storm intensity"
              onChange={(e) => setStorm(e.target.valueAsNumber, 800)}
            />
            <output>{Math.round(runtime.storm * 100)}%</output>
          </label>
          <button type="button" onClick={() => playSfxAt('thunder', [8 - Math.random() * 16, 20, -30])}>
            Thunder
          </button>
          <button type="button" onClick={() => playSfxAt('gull', [Math.random() * 12 - 6, 6, -4])}>
            Gull
          </button>
        </div>
        <p className="audio-demo__hint">Waves, wind in the rigging, creaking timbers, far gulls and a distant bell; the storm layer adds rain, howling wind and heavy seas.</p>
      </section>

      <section className="audio-demo__section">
        <h2>Fire a broadside</h2>
        <div className="audio-demo__loops">
          <button type="button" className="primary" data-testid="audio-demo-broadside" onClick={broadside}>
            Fire a broadside
          </button>
          <button type="button" data-testid="audio-demo-return-fire" onClick={returnFire}>
            Enemy returns fire
          </button>
          <button type="button" onClick={() => singleShot('miss')}>
            Shot: miss
          </button>
          <button type="button" onClick={() => singleShot('hit')}>
            Shot: hit
          </button>
          <button type="button" data-testid="audio-demo-shot-sunk" onClick={() => singleShot('sunk')}>
            Shot: sunk
          </button>
          <label className="audio-demo__check">
            <input type="checkbox" checked={fast} onChange={(e) => setFast(e.target.checked)} /> fast / reduced motion
          </label>
          <button
            type="button"
            onClick={() => {
              timeline.current?.cancel()
              stopAllSfx()
              for (const [, h] of loops.current) h.stop(0)
              loops.current.clear()
              setLoopState({})
            }}
          >
            Stop all SFX
          </button>
        </div>
        <ol className="audio-demo__log" data-testid="audio-demo-log">
          {log.map((e) => (
            <li key={e.id}>
              <span>{(e.at / 1000).toFixed(2)} s</span> {e.text}
            </li>
          ))}
        </ol>
        <p className="audio-demo__hint">fire → whistle → splash / wood → crew; a sink adds mast snap → groan → bubbles → cheer. Same cues `bindGameAudio` plays from store events.</p>
      </section>

      <section className="audio-demo__section">
        <h2>Spatial — click the water</h2>
        <div className="audio-demo__spatial">
          <div className="audio-demo__pad" data-testid="audio-demo-pad" onPointerDown={onPad} role="presentation">
            <div className="audio-demo__fleet audio-demo__fleet--enemy" style={padDot(ENEMY)}>enemy fleet</div>
            <div className="audio-demo__fleet audio-demo__fleet--player" style={padDot(PLAYER)}>your fleet</div>
            {pad && <div className="audio-demo__dot" style={padDot(pad.world)} />}
          </div>
          <div>
            <p className="audio-demo__hint">
              <code>playSfxAt('splash-miss', world)</code> pans from the camera's point of view and attenuates with distance.
            </p>
            <pre data-testid="audio-demo-spatial">
              {pad ? `world: [${pad.world.map((v) => v.toFixed(1)).join(', ')}]\npan:   ${pad.pan.toFixed(2)}\ngain:  ${pad.gain.toFixed(2)}` : 'click the pad…'}
            </pre>
            <div className="audio-demo__loops">
              <button type="button" onClick={() => playSfxAt('cannon-fire', [-8, 0.6, 2])}>
                Cannon far left
              </button>
              <button type="button" onClick={() => playSfxAt('cannon-fire', [8, 0.6, 2])}>
                Cannon far right
              </button>
              <button type="button" onClick={() => playSfxAt('splash-miss', [0, 0.2, -40])}>
                Splash far away
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="audio-demo__section">
        <h2>Every sound</h2>
        <ul className="audio-demo__sfx">
          {SFX_NAMES.map((name) => {
            const variants = SFX_FILES[name]
            const loop = LOOPING_SFX.has(name)
            return (
              <li key={name} data-testid={`audio-demo-sfx-${name}`}>
                <div>
                  <strong>{name}</strong>
                  <small>{DESCRIPTIONS[name]}</small>
                </div>
                <div className="audio-demo__variants">
                  {loop ? (
                    <button type="button" aria-pressed={Boolean(loopState[name])} onClick={() => toggleLoop(name)}>
                      {loopState[name] ? 'Stop' : 'Loop'}
                    </button>
                  ) : variants.length > 1 ? (
                    variants.map((_, i) => (
                      <button type="button" key={i} aria-label={`Play ${name} variant ${i + 1}`} onClick={() => playSfx(name, { variant: i })}>
                        {i + 1}
                      </button>
                    ))
                  ) : (
                    <button type="button" aria-label={`Play ${name}`} onClick={() => playSfx(name)}>
                      Play
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>
    </main>
  )
}

export default AudioDemo
