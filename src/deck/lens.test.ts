import { describe, expect, it } from 'vitest'
import { DECK_FAR, DECK_FOV, DECK_NEAR, OVERVIEW_FAR, OVERVIEW_NEAR } from './contract'
import { applyDeckLens, applyOverviewLens, depthResolution, hasDeckLens, type Lens } from './lens'
import { EYE_CLEARANCE, PLAYER_RADIUS } from './math'

const lens = (near: number, far: number, fov: number) => {
  const l = { near, far, fov, updates: 0, updateProjectionMatrix: () => void l.updates++ }
  return l as Lens & { updates: number }
}

describe('deck lens (BUG-7xx depth precision)', () => {
  it('the deck lens is near 0.03 / far 300: the far/near ratio drops from 75 000 to 10 000 and the collision radius keeps the near plane out of the geometry', () => {
    expect(DECK_NEAR).toBe(0.03)
    expect(DECK_FAR).toBe(300)
    expect(OVERVIEW_FAR / 0.02).toBe(75_000)
    expect(DECK_FAR / DECK_NEAR).toBe(10_000)
    expect(PLAYER_RADIUS).toBeGreaterThanOrEqual(DECK_NEAR + EYE_CLEARANCE)
  })
  it('depth resolution: 1/near is what buys precision on a 24-bit buffer — the far plane barely matters', () => {
    const before = depthResolution(2, 0.02, 1500)
    const farOnly = depthResolution(2, 0.02, 300)
    const after = depthResolution(2, DECK_NEAR, DECK_FAR)
    expect(farOnly / before).toBeGreaterThan(0.99)
    expect(before / after).toBeGreaterThan(1.45)
    expect(after).toBeLessThan(1e-5)
  })
  it('applyDeckLens sets near/far/fov once and reports no change afterwards; applyOverviewLens restores the Canvas values exactly', () => {
    const c = lens(OVERVIEW_NEAR, OVERVIEW_FAR, 42)
    expect(hasDeckLens(c)).toBe(false)
    expect(applyDeckLens(c)).toBe(true)
    expect([c.near, c.far, c.fov, c.updates]).toEqual([DECK_NEAR, DECK_FAR, DECK_FOV, 1])
    expect(applyDeckLens(c)).toBe(false)
    expect(c.updates).toBe(1)
    c.fov = 63.6 // a follow-cam left its lens behind
    expect(hasDeckLens(c)).toBe(true)
    expect(applyDeckLens(c)).toBe(true)
    expect(c.fov).toBe(DECK_FOV)
    expect(applyOverviewLens(c)).toBe(true)
    expect([c.near, c.far]).toEqual([OVERVIEW_NEAR, OVERVIEW_FAR])
    expect(applyOverviewLens(c)).toBe(false)
    expect(c.fov).toBe(DECK_FOV) // the rig owns the fov
  })
})
