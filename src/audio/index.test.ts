import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeHowl {
  opts: { src: string[]; loop?: boolean }
  play: ReturnType<typeof vi.fn>
  volume: ReturnType<typeof vi.fn>
  rate: ReturnType<typeof vi.fn>
  fade: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  playing: ReturnType<typeof vi.fn>
}

const h = vi.hoisted(() => {
  const instances: FakeHowl[] = []
  const playLog: FakeHowl[] = []
  return { instances, playLog, mute: vi.fn() }
})

vi.mock('howler', () => {
  class Howl {
    opts: FakeHowl['opts']
    private vol = 0
    private isPlaying = false
    private fadeCb?: () => void
    play = vi.fn(() => {
      this.isPlaying = true
      h.playLog.push(this as unknown as FakeHowl)
      return 1
    })
    volume = vi.fn((v?: number) => {
      if (typeof v === 'number') this.vol = v
      return this.vol
    })
    rate = vi.fn()
    fade = vi.fn((_from: number, to: number) => {
      this.vol = to
      queueMicrotask(() => this.fadeCb?.())
    })
    stop = vi.fn(() => {
      this.isPlaying = false
    })
    once = vi.fn((_ev: string, cb: () => void) => {
      this.fadeCb = cb
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
const nameOf = (howl: FakeHowl) => srcOf(howl).replace(/.*\/|-\d\.ogg$|\.ogg$/g, '')
const findLoop = (file: string) => h.instances.find((i) => srcOf(i).endsWith(`${file}.ogg`))!
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('playSfx', () => {
  beforeEach(() => {
    useAudioSettings.setState({ sfxVolume: 0.8, musicVolume: 0.5, muted: false })
    h.playLog.length = 0
  })
  afterEach(() => vi.restoreAllMocks())

  it('plays a variant of the requested sound at the SFX volume with ±5% pitch', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    audio.playSfx('fire')
    expect(h.playLog).toHaveLength(1)
    const played = h.playLog[0]
    expect(srcOf(played)).toMatch(/\/assets\/audio\/fire-[123]\.ogg$/)
    expect(played.volume).toHaveBeenLastCalledWith(0.8, 1)
    const rate = played.rate.mock.lastCall![0] as number
    expect(rate).toBeGreaterThanOrEqual(0.95)
    expect(rate).toBeLessThanOrEqual(1.05)
  })

  it('does not alternate to the same variant twice in a row', () => {
    for (let i = 0; i < 20; i++) audio.playSfx('miss')
    expect(h.playLog).toHaveLength(20)
    for (let i = 1; i < h.playLog.length; i++) expect(h.playLog[i]).not.toBe(h.playLog[i - 1])
  })

  it('stays silent while muted', () => {
    useAudioSettings.getState().setMuted(true)
    audio.playSfx('hit')
    expect(h.playLog).toHaveLength(0)
    expect(h.mute).toHaveBeenLastCalledWith(true)
  })
})

describe('music + ambience', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(async () => {
    useAudioSettings.setState({ sfxVolume: 0.8, musicVolume: 0.5, muted: false })
    audio.stopMusic()
    audio.stopAmbience()
    await flush()
    h.playLog.length = 0
  })

  it('fades music in on startMusic and out on stopMusic', async () => {
    audio.startMusic()
    const music = findLoop('music')
    expect(music.opts.loop).toBe(true)
    expect(music.play).toHaveBeenCalled()
    expect(music.fade).toHaveBeenLastCalledWith(0, 0.5, expect.any(Number))
    expect(audio.isMusicPlaying()).toBe(true)
    expect(audio.getAudioRuntime().musicPlaying).toBe(true)

    audio.stopMusic()
    expect(music.fade).toHaveBeenLastCalledWith(0.5, 0, expect.any(Number))
    await flush()
    expect(music.stop).toHaveBeenCalled()
    expect(audio.isMusicPlaying()).toBe(false)
  })

  it('applies music volume changes live and ambience follows the music slider', () => {
    audio.startMusic()
    audio.startAmbience()
    const music = findLoop('music')
    const amb = findLoop('ambience')
    audio.setMusicVolume(1)
    expect(music.volume).toHaveBeenLastCalledWith(1)
    expect(amb.volume).toHaveBeenLastCalledWith(0.6)
  })

  it('ducks the music on sunk and restores it afterwards', () => {
    vi.useFakeTimers()
    audio.startMusic()
    const music = findLoop('music')
    audio.playSfx('sunk')
    expect(music.fade).toHaveBeenLastCalledWith(0.5, 0.125, 150)
    vi.advanceTimersByTime(2000)
    expect(music.fade).toHaveBeenLastCalledWith(0.125, 0.5, 700)
    vi.useRealTimers()
  })

  it('setSfxVolume / setMuted write through to the settings store', () => {
    audio.setSfxVolume(2)
    expect(useAudioSettings.getState().sfxVolume).toBe(1)
    audio.setMuted(true)
    expect(useAudioSettings.getState().muted).toBe(true)
    expect(h.mute).toHaveBeenLastCalledWith(true)
    audio.setMuted(false)
  })
})

describe('bindGameAudio', () => {
  afterEach(() => vi.useRealTimers())
  it('plays place / fire / result / victory sounds from store changes', async () => {
    vi.useFakeTimers()
    const { useGameStore } = await import('../store/gameStore')
    const { FLEET } = await import('../engine')
    useAudioSettings.setState({ sfxVolume: 0.8, musicVolume: 0.5, muted: false })
    useGameStore.getState().reset()
    h.playLog.length = 0
    const unbind = audio.bindGameAudio()

    useGameStore.getState().startGame('easy')
    expect(audio.isMusicPlaying()).toBe(true)
    expect(audio.isAmbiencePlaying()).toBe(true)

    useGameStore.getState().placePlayerShip(FLEET[0], { x: 0, y: 0 }, 'horizontal')
    const playedNames = () => h.playLog.map(nameOf)
    expect(playedNames()).toContain('place')

    useGameStore.getState().autoPlacePlayerFleet()
    useGameStore.getState().confirmPlacement()
    const otterShip = useGameStore.getState().otterBoard.ships[0]
    useGameStore.getState().fireAt(otterShip.cells[0])
    expect(playedNames()).toContain('fire')
    vi.advanceTimersByTime(400)
    expect(playedNames()).toContain('hit')

    unbind()
    vi.useRealTimers()
    useGameStore.getState().reset()
  })
})
