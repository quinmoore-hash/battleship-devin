import { describe, expect, it } from 'vitest'
import { enemyView, isFleetSunk, type Board } from '../engine'
import { clampOrbit, DEFAULT_PHOTO_ORBIT, dollyOrbit, flyOrbit, orbitFromLookAt, orbitPosition, panOrbit, PHOTO_LIMITS, rotateOrbit } from './camera'
import { simulateGame } from './demoGame'
import { battlefieldLod, boardsAt, buildFrames, clampStep, describeEvent, pristine, shotCounts, snapshotFromState, stepIntervalMs } from './replayModel'

describe('demoGame.simulateGame', () => {
  it('is deterministic for a seed and ends with exactly one fleet sunk', () => {
    const a = simulateGame(7)
    const b = simulateGame(7)
    expect(a).toEqual(b)
    expect(a.winner).toBeDefined()
    expect(isFleetSunk(a.winner === 'human' ? a.enemyBoard : a.playerBoard)).toBe(true)
    expect(isFleetSunk(a.winner === 'human' ? a.playerBoard : a.enemyBoard)).toBe(false)
    expect(a.events.length).toBeGreaterThan(30)
    expect(a.events.map((e) => e.by).slice(0, 4)).toEqual(['human', 'enemy', 'human', 'enemy'])
    expect(simulateGame(8).events).not.toEqual(a.events)
  })

  it('can stop mid-battle', () => {
    const s = simulateGame(3, { maxEvents: 20 })
    expect(s.events).toHaveLength(20)
    expect(s.winner).toBeUndefined()
  })
})

describe('replayModel', () => {
  const game = simulateGame(11)

  it('pristine keeps the placement and forgets the shots', () => {
    const p = pristine(game.enemyBoard)
    expect(p.shots).toEqual([])
    expect(p.ships.map((s) => s.cells)).toEqual(game.enemyBoard.ships.map((s) => s.cells))
    expect(p.ships.every((s) => s.hits.length === 0)).toBe(true)
  })

  it('rebuilds the boards step by step and lands exactly on the final state', () => {
    const frames = buildFrames(game)
    expect(frames).toHaveLength(game.events.length + 1)
    const last = frames[frames.length - 1]
    const shotsOf = (b: Board) => b.shots.map((s) => [s.coord.x, s.coord.y, s.outcome])
    expect(shotsOf(last.enemyBoard)).toEqual(shotsOf(game.enemyBoard))
    expect(shotsOf(last.playerBoard)).toEqual(shotsOf(game.playerBoard))
    expect(last.playerBoard.ships.map((s) => s.hits.length)).toEqual(game.playerBoard.ships.map((s) => s.hits.length))
    // a middle frame has exactly the first k shots, with the same outcomes the store recorded
    const k = 25
    const mid = frames[k]
    const human = game.events.slice(0, k).filter((e) => e.by === 'human')
    expect(mid.enemyBoard.shots.map((s) => s.outcome)).toEqual(human.map((e) => e.result.outcome))
    expect(enemyView(mid.enemyBoard).shots).toHaveLength(human.length)
    // frames share structure where nothing changed
    expect(frames[1].playerBoard).toBe(frames[0].playerBoard)
    expect(frames[2].enemyBoard).toBe(frames[1].enemyBoard)
  })

  it('boardsAt clamps the step and matches the frame list', () => {
    expect(boardsAt(game, -5)).toEqual(buildFrames(game)[0])
    expect(boardsAt(game, 10_000)).toEqual(buildFrames(game)[game.events.length])
    expect(clampStep(3.6, 10)).toBe(4)
    expect(clampStep(-1, 10)).toBe(0)
    expect(clampStep(99, 10)).toBe(10)
  })

  it('snapshotFromState copies the events and modes', () => {
    const snap = snapshotFromState({ ...game, modes: { salvo: true, storm: false, blackFlag: false }, winner: 'human' })
    expect(snap.events).toEqual(game.events)
    expect(snap.events).not.toBe(game.events)
    expect(snap.modes).toEqual({ salvo: true, storm: false, blackFlag: false })
  })

  it('captions and counters', () => {
    expect(describeEvent({ id: 1, by: 'human', kind: 'shot', result: { coord: { x: 1, y: 3 }, outcome: 'miss' } })).toBe('You fire at B4 — splash')
    expect(describeEvent({ id: 1, by: 'enemy', kind: 'shot', result: { coord: { x: 0, y: 0 }, outcome: 'hit', shipId: 'sloop' } })).toMatch(/^Devin fires at A1 — hit the /)
    expect(describeEvent({ id: 1, by: 'enemy', kind: 'shot', result: { coord: { x: 0, y: 0 }, outcome: 'sunk', shipId: 'sloop' } })).toMatch(/sunk the .*!$/)
    expect(shotCounts(game.events, 5)).toEqual({ human: 3, enemy: 2 })
    expect(stepIntervalMs(1)).toBe(900)
    expect(stepIntervalMs(4)).toBe(225)
    expect(stepIntervalMs(1000)).toBe(40)
  })
})

describe('camera', () => {
  it('orbitPosition is `distance` away from the target', () => {
    const p = orbitPosition(DEFAULT_PHOTO_ORBIT)
    const t = DEFAULT_PHOTO_ORBIT.target
    expect(Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2])).toBeCloseTo(DEFAULT_PHOTO_ORBIT.distance)
  })

  it('clamps distance, polar angle and keeps the lens above the water', () => {
    const far = dollyOrbit(DEFAULT_PHOTO_ORBIT, 1000)
    expect(far.distance).toBe(PHOTO_LIMITS.maxDistance)
    const near = dollyOrbit(DEFAULT_PHOTO_ORBIT, 0)
    expect(near.distance).toBe(PHOTO_LIMITS.minDistance)
    const low = rotateOrbit({ ...DEFAULT_PHOTO_ORBIT, target: [0, -2, 0] }, 0, 10)
    expect(low.polar).toBeLessThanOrEqual(PHOTO_LIMITS.maxPolar)
    expect(orbitPosition(low)[1]).toBeGreaterThanOrEqual(PHOTO_LIMITS.minCameraY - 1e-6)
    const top = rotateOrbit(DEFAULT_PHOTO_ORBIT, 0, -10)
    expect(top.polar).toBe(PHOTO_LIMITS.minPolar)
  })

  it('pan moves the target in the camera frame and stays within the bay', () => {
    const s = { ...DEFAULT_PHOTO_ORBIT, azimuth: 0 }
    const fwd = panOrbit(s, 0, 5)
    expect(fwd.target[2]).toBeCloseTo(s.target[2] - 5)
    expect(fwd.target[0]).toBeCloseTo(s.target[0])
    const right = panOrbit(s, 5, 0)
    expect(right.target[0]).toBeCloseTo(s.target[0] + 5)
    const away = panOrbit(s, 1e6, 0)
    expect(away.target[0]).toBe(PHOTO_LIMITS.targetRange)
  })

  it('fly is a no-op without input and scales with dt', () => {
    expect(flyOrbit(DEFAULT_PHOTO_ORBIT, { forward: 0, right: 0, up: 0 }, 1)).toBe(DEFAULT_PHOTO_ORBIT)
    const a = flyOrbit(DEFAULT_PHOTO_ORBIT, { forward: 1, right: 0, up: 0 }, 0.1)
    const b = flyOrbit(DEFAULT_PHOTO_ORBIT, { forward: 1, right: 0, up: 0, boost: true }, 0.1)
    const moved = (s: typeof a) => Math.hypot(s.target[0] - DEFAULT_PHOTO_ORBIT.target[0], s.target[2] - DEFAULT_PHOTO_ORBIT.target[2])
    expect(moved(a)).toBeGreaterThan(0)
    expect(moved(b)).toBeCloseTo(moved(a) * 2.5)
  })

  it('orbitFromLookAt round-trips a camera position', () => {
    const s = orbitFromLookAt([-21, 6, 9], [2, 1.2, -7])
    const p = orbitPosition(s)
    expect(p[0]).toBeCloseTo(-21, 4)
    expect(p[1]).toBeCloseTo(6, 4)
    expect(p[2]).toBeCloseTo(9, 4)
    expect(clampOrbit(s)).toEqual(s)
  })
})

describe('battlefieldLod (BUG-317: replay / photo follow the perf tier)', () => {
  it('uses the tier lod but never the live lod 0', () => {
    for (const mode of ['replay', 'photo'] as const) {
      expect(battlefieldLod(mode, 0, 'high')).toBe(1)
      expect(battlefieldLod(mode, 1, 'high')).toBe(1)
      expect(battlefieldLod(mode, 2, 'high')).toBe(2)
    }
  })
  it('low quality is always the lod-2 silhouette', () => {
    expect(battlefieldLod('replay', 0, 'low')).toBe(2)
    expect(battlefieldLod('photo', 0, 'low')).toBe(2)
  })
})
