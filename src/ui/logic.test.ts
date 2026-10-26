// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBoard, FLEET_BY_ID, placeShip } from '../engine'
import { useGameStore } from '../store/gameStore'
import { footprintAt } from './placementUtils'
import { battleReport, captainRank, formatDuration } from './stats'
import { bindCinematics } from './cinematicsBinding'
import { activeDirector, aimDelay, createTurnFlow, fallbackDuration, getDirector, setDirector, Sleeper, TimerDirector } from './turnFlow'
import { resetInteraction, useUiStore } from './uiStore'

describe('footprintAt', () => {
  const sloop = FLEET_BY_ID.sloop
  const frigate = FLEET_BY_ID.frigate
  it('anchors the ship under the grabbed cell and clamps to the board', () => {
    const f = footprintAt(createBoard(), frigate, { x: 5, y: 2 }, 'horizontal', 2)
    expect(f.origin).toEqual({ x: 3, y: 2 })
    expect(f.valid).toBe(true)
    const edge = footprintAt(createBoard(), frigate, { x: 9, y: 9 }, 'vertical', 0)
    expect(edge.origin).toEqual({ x: 9, y: 7 })
    expect(edge.cells).toHaveLength(3)
    const low = footprintAt(createBoard(), frigate, { x: 0, y: 0 }, 'horizontal', 2)
    expect(low.origin).toEqual({ x: 0, y: 0 })
  })
  it('flags overlaps as invalid', () => {
    const board = placeShip(createBoard(), sloop, { x: 0, y: 0 }, 'horizontal')!
    expect(footprintAt(board, frigate, { x: 1, y: 0 }, 'horizontal').valid).toBe(false)
    expect(footprintAt(board, frigate, { x: 1, y: 1 }, 'horizontal').valid).toBe(true)
  })
})

describe('stats', () => {
  it('summarises shots, accuracy, streaks and time', () => {
    const s = useGameStore.getState()
    s.startGame('easy')
    s.autoPlacePlayerFleet()
    s.confirmPlacement()
    const target = useGameStore.getState().enemyBoard.ships.find((x) => x.spec.id === 'sloop')!
    for (const c of target.cells) {
      useGameStore.getState().fireAt(c)
      useGameStore.getState().enemyTurn()
    }
    const g = useGameStore.getState()
    const r = battleReport(g.events, g.playerBoard, g.enemyBoard, 1000, 66_000)
    expect(r.shots).toBe(2)
    expect(r.hits).toBe(2)
    expect(r.accuracy).toBe(100)
    expect(r.bestStreak).toBe(2)
    expect(r.shipsSunk).toBe(1)
    expect(r.enemyShots).toBe(2)
    expect(r.seconds).toBe(65)
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(3723)).toBe('1:02:03')
    expect(captainRank(r, true)).toBe('Terror of the Seas')
    expect(captainRank({ ...r, shipsSunk: 0 }, false)).toBe('Powder Monkey')
  })
})

describe('turnFlow', () => {
  beforeEach(() => {
    useGameStore.getState().reset()
    useGameStore.getState().updateSettings({ cinematics: 'full', reducedMotion: false })
    setDirector(null)
    resetInteraction()
  })

  it('scales timings and collapses them when cinematics are off / reduced motion', () => {
    expect(fallbackDuration({ type: 'shot', by: 'human', target: { x: 0, y: 0 }, result: { coord: { x: 0, y: 0 }, outcome: 'miss' } }, 'full')).toBe(675)
    expect(fallbackDuration({ type: 'sink', owner: 'enemy', shipId: 'sloop' }, 'fast')).toBe(300)
    expect(fallbackDuration({ type: 'battle-start' }, 'off')).toBe(30)
    expect(fallbackDuration({ type: 'victory', winner: 'human' }, 'full', true)).toBe(30)
    expect(aimDelay('hard', false, () => 0)).toBe(500)
    expect(aimDelay('easy', false, () => 1)).toBe(1700)
    expect(aimDelay('easy', true, () => 0.5)).toBe(90)
  })

  it('a Sleeper can be skipped', async () => {
    vi.useFakeTimers()
    const s = new Sleeper()
    let done = false
    void s.wait(5000).then(() => (done = true))
    s.skip()
    await Promise.resolve()
    expect(done).toBe(true)
    const d = new TimerDirector()
    const p = d.play({ type: 'battle-start' }, 'full')
    expect(d.busy).toBe(true)
    d.skip()
    await p
    expect(d.busy).toBe(false)
    vi.useRealTimers()
  })

  it('plays player shot → enemy aims → enemy shot through the store and a custom director', async () => {
    const g = useGameStore.getState()
    g.startGame('medium')
    g.autoPlacePlayerFleet()
    g.confirmPlacement()
    g.updateSettings({ cinematics: 'off' })
    const played: string[] = []
    setDirector({
      busy: false,
      play: async (e) => void played.push(e.type + (e.type === 'shot' ? `:${e.by}` : '')),
      skip: () => {},
    })
    const beats: string[] = []
    const flow = createTurnFlow({ onBeat: (b) => beats.push(b.phase), rng: () => 0 })
    const result = await flow.fire({ x: 0, y: 0 })
    expect(result?.coord).toEqual({ x: 0, y: 0 })
    expect(useGameStore.getState().events).toHaveLength(2)
    expect(played[0]).toBe('shot:human')
    expect(played).toContain('shot:enemy')
    expect(beats[0]).toBe('player-shot')
    expect(beats).toContain('enemy-aiming')
    expect(beats.at(-1)).toBe('done')
    expect(await flow.fire({ x: 0, y: 0 })).toBeUndefined() // already shot
    flow.dispose()
  })
})

describe('uiStore', () => {
  it('resets interaction state on phase change but keeps prefs', () => {
    const ui = useUiStore.getState()
    ui.setCarrying('sloop', 'vertical')
    ui.setPendingTarget({ x: 1, y: 1 })
    useGameStore.getState().startGame('easy')
    const after = useUiStore.getState()
    expect(after.carrying).toBeNull()
    expect(after.pendingTarget).toBeNull()
    expect(after.orientation).toBe('horizontal')
    after.rotate()
    expect(useUiStore.getState().orientation).toBe('vertical')
    after.dismissHint('battle')
    after.dismissHint('battle')
    expect(useUiStore.getState().hintsSeen).toEqual(['battle'])
  })
})

describe('turnFlow integration (director, volleys, victory)', () => {
  const startBattle = (modes?: { salvo?: boolean }) => {
    const g = useGameStore.getState()
    g.reset()
    g.updateSettings({ cinematics: 'fast', reducedMotion: false })
    if (modes) g.setModes(modes)
    g.startGame('easy', modes)
    g.autoPlacePlayerFleet()
    g.confirmPlacement()
  }
  const recordingDirector = (played: string[]) => ({
    busy: false,
    play: async (e: { type: string; by?: string }) => void played.push(e.type + (e.type === 'shot' ? `:${e.by}` : '')),
    skip: () => {},
  })
  beforeEach(() => {
    setDirector(null)
    resetInteraction()
  })

  it('uses the real director only when the 3D world is on screen', () => {
    const timers = new TimerDirector()
    expect(activeDirector(timers)).toBe(timers)
    const d = recordingDirector([])
    setDirector(d)
    expect(activeDirector(timers, false)).toBe(d)
    expect(activeDirector(timers, true)).toBe(timers)
  })

  it('plays the battle-start flyover with a director, and skips it when a shot comes in', async () => {
    startBattle()
    const played: string[] = []
    let skipped = 0
    let release: () => void = () => {}
    const d = {
      busy: false,
      play: (e: { type: string; by?: string }) => {
        played.push(e.type + (e.type === 'shot' ? `:${e.by}` : ''))
        return e.type === 'battle-start' ? new Promise<void>((r) => (release = r)) : Promise.resolve()
      },
      skip: () => {
        skipped++
        release()
      },
    }
    setDirector(d)
    const beats: string[] = []
    const flow = createTurnFlow({ onBeat: (b) => beats.push(b.phase), rng: () => 0 })
    void flow.intro()
    expect(beats).toEqual(['intro'])
    expect(flow.busy).toBe(true)
    const result = await flow.fire({ x: 0, y: 0 })
    expect(skipped).toBe(1)
    expect(result).toBeDefined()
    expect(played[0]).toBe('battle-start')
    expect(played[1]).toBe('shot:human')
    flow.dispose()
  })

  it('does not play an intro with the timer fallback (nothing to watch)', async () => {
    startBattle()
    const beats: string[] = []
    const flow = createTurnFlow({ onBeat: (b) => beats.push(b.phase) })
    await flow.intro()
    expect(beats).toEqual([])
    expect(flow.busy).toBe(false)
    flow.dispose()
  })

  it('plays every shot of a salvo volley, for both sides', async () => {
    startBattle({ salvo: true })
    const played: string[] = []
    setDirector(recordingDirector(played))
    const flow = createTurnFlow({ rng: () => 0 })
    const size = useGameStore.getState().salvo.size
    expect(size).toBe(5)
    for (let i = 0; i < size - 1; i++) expect(await flow.fire({ x: i, y: 0 })).toBeUndefined()
    expect(played).toEqual([])
    const result = await flow.fire({ x: size - 1, y: 0 })
    expect(result).toBeDefined()
    const human = played.filter((p) => p === 'shot:human').length
    const enemy = played.filter((p) => p === 'shot:enemy').length
    expect(human).toBe(size)
    expect(enemy).toBe(useGameStore.getState().events.filter((e) => e.by === 'enemy').length)
    expect(enemy).toBeGreaterThanOrEqual(1)
    flow.dispose()
  })

  it('plays the victory flyover when the shot ends the game and dispose() lets it finish', async () => {
    startBattle()
    const g = useGameStore.getState()
    // sink everything but one cell of the enemy fleet
    const cells = g.enemyBoard.ships.flatMap((s) => s.cells)
    for (const c of cells.slice(0, -1)) {
      g.fireAt(c)
      useGameStore.setState({ turn: 'human' })
    }
    const played: string[] = []
    let skipped = 0
    setDirector({ ...recordingDirector(played), skip: () => skipped++ })
    const beats: string[] = []
    const flow = createTurnFlow({ onBeat: (b) => beats.push(b.phase) })
    await flow.fire(cells[cells.length - 1])
    expect(useGameStore.getState().phase).toBe('gameover')
    expect(played).toEqual(['shot:human', 'sink', 'victory'])
    expect(beats).toEqual(['player-shot', 'player-sink', 'victory', 'done'])
    flow.dispose()
    expect(skipped).toBe(0)
  })
})

describe('bindCinematics', () => {
  it('registers the director and cuts it when the player leaves the battle', () => {
    let skipped = 0
    const d = { busy: true, skip: () => skipped++, play: () => Promise.resolve() }
    const unbind = bindCinematics(d as never)
    expect(getDirector()).toBe(d)
    const g = useGameStore.getState()
    g.startGame('easy')
    expect(skipped).toBe(1) // menu → placement
    g.autoPlacePlayerFleet()
    g.confirmPlacement()
    expect(skipped).toBe(1) // → battle does not cut
    g.reset()
    expect(skipped).toBe(2)
    unbind()
    expect(getDirector()).toBeNull()
  })
})
