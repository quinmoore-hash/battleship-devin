import { describe, expect, it } from 'vitest'
import { FLEET, type PlacedShip } from '../engine'
import { createDirector } from './director'
import { CINEMATIC_TIMING, type CinematicEvent } from './types'

const mk = (id: PlacedShip['spec']['id'], x: number, y: number): PlacedShip => {
  const spec = FLEET.find((s) => s.id === id)!
  return { spec, origin: { x, y }, orientation: 'horizontal', cells: Array.from({ length: spec.length }, (_, i) => ({ x: x + i, y })), hits: [] }
}
const fleets = { human: [mk('frigate', 2, 1)], enemy: [mk('galleon', 4, 4)] }
const make = (reducedMotion = false) => createDirector({ autoTick: false, audio: false, fleets: () => fleets, reducedMotion: () => reducedMotion })
const hit: CinematicEvent = { type: 'shot', by: 'human', target: { x: 5, y: 4 }, result: { coord: { x: 5, y: 4 }, outcome: 'hit' } }

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('director', () => {
  it('plays a shot through its beats and resolves at the end', async () => {
    const d = make()
    let resolved = false
    const p = d.play(hit, 'full').then(() => (resolved = true))
    const s = d.store.getState()
    expect(s.busy).toBe(true)
    expect(s.letterbox).toBe(true)
    expect(d.active?.plan?.battery?.shipId).toBe('frigate')
    expect(d.active?.beat).toBe('approach')
    let t = 0
    while (t < 1.0) {
      d.tick(0.05)
      t += 0.05
    }
    expect(d.active?.beat).toBe('fire')
    expect(d.store.getState().firing.frigate?.length).toBeGreaterThan(0)
    expect(d.store.getState().impacted).toBe(false)
    while (t < 2.6) {
      d.tick(0.05)
      t += 0.05
    }
    expect(d.active?.beat).toBe('impact')
    expect(d.store.getState().impacted).toBe(true)
    expect(d.store.getState().shake).toBeGreaterThan(0)
    while (d.active) d.tick(0.05)
    await settle()
    expect(resolved).toBe(true)
    expect(d.store.getState()).toMatchObject({ busy: false, letterbox: false, firing: {}, impacted: false, completed: 1 })
    await p
  })
  it('fast finishes in CINEMATIC_TIMING.fast seconds', () => {
    const d = make()
    void d.play(hit, 'fast')
    let t = 0
    while (d.active) {
      d.tick(0.1)
      t += 0.1
    }
    expect(t).toBeCloseTo(CINEMATIC_TIMING.shot.fast, 0)
  })
  it('off resolves immediately with the end state applied', async () => {
    const d = make()
    let resolved = false
    void d.play(hit, 'off').then(() => (resolved = true))
    expect(d.busy).toBe(false)
    expect(d.store.getState().completed).toBe(1)
    await settle()
    expect(resolved).toBe(true)
  })
  it('skip ends the sequence on the next tick and still resolves the promise', async () => {
    const d = make()
    let resolved = false
    void d.play({ type: 'battle-start' }, 'full').then(() => (resolved = true))
    d.tick(0.3)
    d.skip()
    await settle()
    expect(resolved).toBe(true)
    expect(d.busy).toBe(false)
  })
  it('sink drives sinkProgress 0→1 with 0.4× slow motion in the middle', () => {
    const d = make()
    void d.play({ type: 'sink', owner: 'enemy', shipId: 'galleon' }, 'full')
    expect(d.store.getState().sinkProgress.galleon).toBe(0)
    let slow = false
    let last = 0
    while (d.active) {
      d.tick(0.05)
      const s = d.store.getState()
      if (s.timeScale === 0.4) slow = true
      expect(s.sinkProgress.galleon ?? 1).toBeGreaterThanOrEqual(last - 1e-9)
      last = s.sinkProgress.galleon ?? 1
    }
    expect(slow).toBe(true)
    expect(d.store.getState().sinkProgress.galleon).toBe(1)
    expect(d.store.getState().timeScale).toBe(1)
  })
  it('reduced motion: no shake and no slow motion', () => {
    const d = make(true)
    void d.play(hit, 'full')
    while (d.active) d.tick(0.05)
    expect(d.store.getState().shake).toBe(0)
    void d.play({ type: 'sink', owner: 'enemy', shipId: 'galleon' }, 'full')
    while (d.active) {
      d.tick(0.05)
      expect(d.store.getState().timeScale).toBe(1)
    }
  })
  it('a new play() while busy skips the running sequence', async () => {
    const d = make()
    let first = false
    void d.play(hit, 'full').then(() => (first = true))
    d.tick(0.5)
    void d.play({ type: 'victory', winner: 'human' }, 'fast')
    await settle()
    expect(first).toBe(true)
    expect(d.active?.event.type).toBe('victory')
  })
})

describe('budgets', () => {
  it('fast fires a single ball; full fires a broadside', () => {
    const d = make()
    void d.play(hit, 'fast')
    expect(d.active?.plan?.muzzles).toHaveLength(1)
    d.skip()
    void d.play(hit, 'full')
    expect(d.active?.plan?.muzzles.length).toBeGreaterThan(1)
    expect(d.active?.plan?.muzzles.length).toBeLessThanOrEqual(3)
  })
  it('low tier: one ball, no shake, no slow motion', () => {
    const d = createDirector({ autoTick: false, audio: false, fleets: () => fleets, reducedMotion: () => false, budget: () => 'low' })
    void d.play(hit, 'full')
    expect(d.active?.plan?.muzzles).toHaveLength(1)
    while (d.active) d.tick(0.05)
    expect(d.store.getState().shake).toBe(0)
    void d.play({ type: 'sink', owner: 'enemy', shipId: 'galleon' }, 'full')
    while (d.active) {
      d.tick(0.05)
      expect(d.store.getState().timeScale).toBe(1)
    }
  })
})
