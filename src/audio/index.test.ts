import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeHowl {
  opts: { src: string[]; loop?: boolean }
  play: ReturnType<typeof vi.fn>
  volume: ReturnType<typeof vi.fn>
  rate: ReturnType<typeof vi.fn>
  stereo: ReturnType<typeof vi.fn>
  loop: ReturnType<typeof vi.fn>
  fade: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  playing: ReturnType<typeof vi.fn>
}

const h = vi.hoisted(() => {
  const instances: FakeHowl[] = []
  const playLog: { howl: FakeHowl; id: number }[] = []
  return { instances, playLog, mute: vi.fn(), nextId: { v: 1 } }
})

vi.mock('howler', () => {
  class Howl {
    opts: FakeHowl['opts']
    private vol = 0
    private isPlaying = false
    private cbs: { ev: string; cb: () => void }[] = []
    play = vi.fn(() => {
      this.isPlaying = true
      const id = h.nextId.v++
      h.playLog.push({ howl: this as unknown as FakeHowl, id })
      return id
    })
    volume = vi.fn((v?: number) => {
      if (typeof v === 'number') this.vol = v
      return this.vol
    })
    rate = vi.fn()
    stereo = vi.fn()
    loop = vi.fn()
    fade = vi.fn((_from: number, to: number) => {
      this.vol = to
      queueMicrotask(() => {
        const fades = this.cbs.filter((c) => c.ev === 'fade')
        this.cbs = this.cbs.filter((c) => c.ev !== 'fade')
        for (const f of fades) f.cb()
      })
    })
    stop = vi.fn(() => {
      this.isPlaying = false
    })
    once = vi.fn((ev: string, cb: () => void) => {
      this.cbs.push({ ev, cb })
    })
    playing = vi.fn(() => this.isPlaying)
    constructor(opts: FakeHowl['opts']) {
      this.opts = opts
      h.instances.push(this as unknown as FakeHowl)
    }
  }
  return { Howl, Howler: { mute: h.mute, ctx: undefined, autoUnlock: true, usingWebAudio: true } }
})

vi.stubGlobal('window', Object.assign(Object.create(globalThis), { addEventListener: vi.fn(), removeEventListener: vi.fn() }))
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
})

const audio = await import('./index')
const { useAudioSettings } = audio

const srcOf = (howl: FakeHowl) => howl.opts.src[0]
const fileOf = (howl: FakeHowl) => srcOf(howl).replace(/.*\//, '').replace(/\.ogg$/, '')
const baseOf = (howl: FakeHowl) => fileOf(howl).replace(/-\d$/, '')
const findFile = (file: string) => h.instances.find((i) => srcOf(i).endsWith(`${file}.ogg`))!
const played = () => h.playLog.map((p) => baseOf(p.howl))
const flush = () => new Promise((r) => setTimeout(r, 0))
const resetSettings = () => useAudioSettings.setState({ masterVolume: 1, sfxVolume: 0.8, musicVolume: 0.5, ambienceVolume: 0.6, muted: false })

describe('playSfx', () => {
  beforeEach(() => {
    resetSettings()
    h.playLog.length = 0
  })
  afterEach(() => vi.restoreAllMocks())

  it('plays a variant at the SFX bus level with ±5% pitch and centre pan', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    audio.playSfx('cannon-fire')
    expect(h.playLog).toHaveLength(1)
    const { howl, id } = h.playLog[0]
    expect(srcOf(howl)).toMatch(/\/assets\/audio\/cannon-fire-[123]\.ogg$/)
    expect(howl.volume).toHaveBeenLastCalledWith(0.8, id)
    expect(howl.stereo).toHaveBeenLastCalledWith(0, id)
    const rate = howl.rate.mock.lastCall![0] as number
    expect(rate).toBeGreaterThanOrEqual(0.95)
    expect(rate).toBeLessThanOrEqual(1.05)
  })

  it('maps legacy names onto the pirate set', () => {
    audio.playSfx('fire')
    audio.playSfx('miss')
    audio.playSfx('place')
    expect(played()).toEqual(['cannon-fire', 'splash-miss', 'place-ship'])
  })

  it('never repeats the same variant twice in a row', () => {
    for (let i = 0; i < 20; i++) audio.playSfx('splash-miss')
    for (let i = 1; i < h.playLog.length; i++) expect(h.playLog[i].howl).not.toBe(h.playLog[i - 1].howl)
  })

  it('forces a variant when asked (demo buttons)', () => {
    audio.playSfx('impact-wood', { variant: 2 })
    expect(fileOf(h.playLog[0].howl)).toBe('impact-wood-3')
  })

  it('applies the per-sound base gain and the master bus', () => {
    audio.setMasterVolume(0.5)
    audio.playSfx('ui-hover')
    const { howl, id } = h.playLog[0]
    expect(howl.volume).toHaveBeenLastCalledWith(0.5 * 0.8 * 0.3, id)
  })

  it('stays silent while muted', () => {
    useAudioSettings.getState().setMuted(true)
    audio.playSfx('impact-wood')
    expect(h.playLog).toHaveLength(0)
    expect(h.mute).toHaveBeenLastCalledWith(true)
  })

  it('loops fire-loop until the handle is stopped, and follows live volume changes', async () => {
    const handle = audio.playSfx('fire-loop')
    const { howl, id } = h.playLog[0]
    expect(howl.opts.loop).toBe(true)
    expect(howl.loop).toHaveBeenCalledWith(true, id)
    audio.setSfxVolume(0.4)
    expect(howl.volume).toHaveBeenLastCalledWith(0.4 * 0.5, id)
    handle.stop(100)
    expect(howl.fade).toHaveBeenLastCalledWith(expect.any(Number), 0, 100, id)
    await flush()
    expect(howl.stop).toHaveBeenCalledWith(id)
    handle.stop() // idempotent
    expect(howl.stop).toHaveBeenCalledTimes(1)
  })
})

describe('playSfxAt (spatial)', () => {
  beforeEach(() => {
    resetSettings()
    h.playLog.length = 0
    audio.setAudioListener([0, 10, 15], [0, -0.5, -1])
  })

  it('pans left/right and attenuates with distance', () => {
    audio.playSfxAt('cannon-fire', [-9, 0.6, 2])
    audio.playSfxAt('cannon-fire', [9, 0.6, 2])
    audio.playSfxAt('splash-miss', [0, 0.2, -45])
    const [left, right, far] = h.playLog
    expect(left.howl.stereo.mock.lastCall![0]).toBeLessThan(-0.5)
    expect(right.howl.stereo.mock.lastCall![0]).toBeGreaterThan(0.5)
    expect(far.howl.volume.mock.lastCall![0]).toBeLessThan(0.8 * 0.8 * 0.5)
  })

  it('re-pans live loops when the listener moves', () => {
    const handle = audio.playSfxAt('bubbles', [-6, 0, 0])
    const { howl, id } = h.playLog[0]
    const before = howl.stereo.mock.lastCall![0] as number
    expect(before).toBeLessThan(0)
    audio.setAudioListener([0, 10, -15], [0, -0.5, 1])
    expect(howl.stereo).toHaveBeenLastCalledWith(expect.any(Number), id)
    expect(howl.stereo.mock.lastCall![0]).toBeGreaterThan(0)
    handle.setPosition([6, 0, 0])
    expect(howl.stereo.mock.lastCall![0]).toBeLessThan(0)
    handle.stop(0)
  })

  it('setAudioListenerFromCamera reads a three.js-like camera', () => {
    audio.setAudioListenerFromCamera({
      position: { x: 1, y: 2, z: 3 },
      getWorldDirection: (t) => t.set(0, 0, -1),
    })
    expect(audio.getAudioListener()).toEqual({ position: [1, 2, 3], forward: [0, 0, -1] })
  })
})

describe('music', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(async () => {
    resetSettings()
    audio.stopMusic()
    await flush()
    h.playLog.length = 0
  })

  it('fades the menu shanty in on startMusic() and out on stopMusic()', async () => {
    audio.startMusic()
    const menu = findFile('music-menu')
    expect(menu.opts.loop).toBe(true)
    expect(menu.play).toHaveBeenCalled()
    expect(menu.fade).toHaveBeenLastCalledWith(0, 0.5, expect.any(Number))
    expect(audio.isMusicPlaying()).toBe(true)
    expect(audio.getAudioRuntime()).toMatchObject({ musicPlaying: true, musicTrack: 'menu' })

    audio.stopMusic()
    expect(menu.fade).toHaveBeenLastCalledWith(0.5, 0, expect.any(Number))
    await flush()
    expect(menu.stop).toHaveBeenCalled()
    expect(audio.isMusicPlaying()).toBe(false)
  })

  it('crossfades between the menu and battle variants', () => {
    audio.startMusic('menu')
    const menu = findFile('music-menu')
    audio.startMusic('battle')
    const battle = findFile('music-battle')
    expect(menu.fade).toHaveBeenLastCalledWith(0.5, 0, 2200)
    expect(battle.fade).toHaveBeenLastCalledWith(0, 0.5, 2200)
    expect(audio.currentMusicTrack()).toBe('battle')
    audio.startMusic('battle') // no-op
    expect(battle.play).toHaveBeenCalledTimes(1)
  })

  it('plays the sting first and brings the loop in under its downbeat', () => {
    vi.useFakeTimers()
    audio.startMusic('battle', { sting: true })
    expect(played()).toEqual(['music-intro'])
    expect(findFile('music-battle').play).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2700)
    expect(findFile('music-battle').play).toHaveBeenCalled()
  })

  it('applies music + master volume changes live', () => {
    audio.startMusic('menu')
    const menu = findFile('music-menu')
    audio.setMusicVolume(1)
    expect(menu.volume).toHaveBeenLastCalledWith(1)
    audio.setMasterVolume(0.5)
    expect(menu.volume).toHaveBeenLastCalledWith(0.5)
  })

  it('ducks under a sinking groan and restores afterwards', () => {
    vi.useFakeTimers()
    audio.startMusic('menu')
    const menu = findFile('music-menu')
    audio.playSfx('sinking-groan')
    expect(menu.fade).toHaveBeenLastCalledWith(0.5, 0.125, 150)
    expect(audio.getAudioRuntime().ducked).toBe(true)
    vi.advanceTimersByTime(2500)
    expect(menu.fade).toHaveBeenLastCalledWith(0.125, 0.5, 700)
    expect(audio.getAudioRuntime().ducked).toBe(false)
  })
})

describe('ambience', () => {
  beforeEach(async () => {
    resetSettings()
    audio.stopAmbience()
    audio.setStorm(0, 0)
    await flush()
    h.playLog.length = 0
  })

  it('runs the sea bed on its own bus and layers the storm on demand', () => {
    audio.startAmbience()
    const sea = findFile('ambience-sea')
    expect(sea.fade).toHaveBeenLastCalledWith(0, 0.6, expect.any(Number))
    expect(h.instances.some((i) => srcOf(i).endsWith('ambience-storm.ogg'))).toBe(false)
    audio.setStorm(0.5, 100)
    const storm = findFile('ambience-storm')
    expect(storm.play).toHaveBeenCalled()
    expect(storm.fade).toHaveBeenLastCalledWith(0, 0.3, 100)
    audio.setAmbienceVolume(1)
    expect(sea.volume).toHaveBeenLastCalledWith(1)
    expect(storm.volume).toHaveBeenLastCalledWith(0.5)
    expect(audio.getAudioRuntime()).toMatchObject({ ambiencePlaying: true, storm: 0.5 })
    audio.setStorm(0, 100)
    expect(storm.fade).toHaveBeenLastCalledWith(0.5, 0, 100)
  })

  it('setMuted writes through to the settings store and Howler', () => {
    audio.setMuted(true)
    expect(useAudioSettings.getState().muted).toBe(true)
    expect(h.mute).toHaveBeenLastCalledWith(true)
    audio.setMuted(false)
  })
})

describe('timelines + cinematic hook', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    resetSettings()
    h.playLog.length = 0
    vi.useFakeTimers()
  })

  it('playShot schedules fire → whistle → impact → crew with spatial positions', () => {
    audio.playShot('hit', { flightMs: 1000, from: [-9, 0, 5], to: [0, 0, -8] })
    expect(played()).toEqual(['cannon-fire'])
    expect(h.playLog[0].howl.stereo.mock.lastCall![0]).toBeLessThan(0)
    vi.advanceTimersByTime(200)
    expect(played()).toEqual(['cannon-fire', 'cannon-whistle'])
    vi.advanceTimersByTime(800)
    expect(played()).toEqual(['cannon-fire', 'cannon-whistle', 'impact-wood'])
    vi.advanceTimersByTime(300)
    expect(played()).toContain('crew-shout-hit')
  })

  it('cancel() drops the unplayed tail', () => {
    const handle = audio.playShot('sunk', { flightMs: 500 })
    vi.advanceTimersByTime(600)
    handle.cancel()
    vi.advanceTimersByTime(5000)
    expect(played()).not.toContain('sinking-groan')
  })

  it('playCinematicAudio handles sink / battle-start / victory', () => {
    audio.playCinematicAudio({ type: 'sink', owner: 'enemy', shipId: 'frigate' as never })
    vi.advanceTimersByTime(2000)
    expect(played()).toEqual(['mast-snap', 'sinking-groan', 'bubbles', 'crew-cheer'])
    h.playLog.length = 0
    audio.playCinematicAudio({ type: 'victory', winner: 'enemy' })
    vi.advanceTimersByTime(500)
    expect(played()).toEqual(['drum-defeat', 'sinking-groan'])
    h.playLog.length = 0
    audio.playCinematicAudio({ type: 'battle-start' })
    expect(played()).toEqual(['music-intro'])
    expect(audio.currentMusicTrack()).toBe('battle')
    audio.stopMusic()
  })
})

describe('bindGameAudio', () => {
  afterEach(() => vi.useRealTimers())
  it('drives ambience, music variants and shot timelines from store changes', async () => {
    vi.useFakeTimers()
    const { useGameStore } = await import('../store/gameStore')
    const { FLEET } = await import('../engine')
    resetSettings()
    audio.stopMusic()
    audio.stopAmbience()
    useGameStore.getState().reset()
    h.playLog.length = 0
    const unbind = audio.bindGameAudio()

    useGameStore.getState().startGame('easy')
    expect(audio.isMusicPlaying()).toBe(true)
    expect(audio.currentMusicTrack()).toBe('menu')
    expect(audio.isAmbiencePlaying()).toBe(true)

    useGameStore.getState().placePlayerShip(FLEET[0], { x: 0, y: 0 }, 'horizontal')
    expect(played()).toContain('place-ship')

    useGameStore.getState().autoPlacePlayerFleet()
    useGameStore.getState().confirmPlacement()
    expect(played()).toContain('music-intro')
    vi.advanceTimersByTime(3000)
    expect(audio.currentMusicTrack()).toBe('battle')
    expect(findFile('music-battle').play).toHaveBeenCalled()

    h.playLog.length = 0
    const enemyShip = useGameStore.getState().enemyBoard.ships[0]
    useGameStore.getState().fireAt(enemyShip.cells[0])
    expect(played()[0]).toBe('cannon-fire')
    vi.advanceTimersByTime(2500)
    expect(played()).toContain('cannon-whistle')
    expect(played()).toContain('impact-wood')
    expect(played()).toContain('crew-shout-hit')

    unbind()
    vi.useRealTimers()
    useGameStore.getState().reset()
    audio.stopMusic()
    audio.stopAmbience()
  })
})
