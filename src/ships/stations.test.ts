import { describe, expect, it } from 'vitest'
import { FLEET } from '../engine'
import { resolveDeckAnchors, stationsOf, STATION_REACH } from '../deck/math'
import { SHIPS } from './index'

/**
 * Every on-deck gun station (the ones that get a ring + glow marker) must sit at an authored cannon of its class:
 * the breech on that cannon's barrel axis just behind the muzzle, on the deck level the gunner stands on, and the
 * stand within reach of the breech. A marker without a cannon beside it is a defect (BUG-7xx).
 */
const AXIS_TOLERANCE = 0.03
const BREECH_BEHIND_MUZZLE: [number, number] = [0.05, 0.6]
const BORE_OVER_STAND: [number, number] = [0.03, 0.25]

describe.each(FLEET.map((s) => s.id))('%s on-deck stations', (id) => {
  const a = SHIPS[id].anchors
  const stations = stationsOf(a, resolveDeckAnchors(a, id)).filter((s) => s.onDeck)

  it('has at least one on-deck station', () => {
    expect(stations.length).toBeGreaterThan(0)
  })

  it.each(stations.map((s) => [s.index, s] as const))('station %i sits at its authored cannon', (_i, s) => {
    const c = a.cannons[s.index]
    expect(c).toBeDefined()
    const h = Math.hypot(c.direction[0], c.direction[2]) || 1
    const fx = c.direction[0] / h
    const fz = c.direction[2] / h
    // breech on the barrel axis (xz), behind the muzzle
    const bx = s.breech[0] - c.muzzle[0]
    const bz = s.breech[2] - c.muzzle[2]
    const along = -(bx * fx + bz * fz)
    const across = Math.abs(bx * fz - bz * fx)
    expect(across).toBeLessThanOrEqual(AXIS_TOLERANCE)
    expect(along).toBeGreaterThanOrEqual(BREECH_BEHIND_MUZZLE[0])
    expect(along).toBeLessThanOrEqual(BREECH_BEHIND_MUZZLE[1])
    expect(Math.abs(s.breech[1] - c.muzzle[1])).toBeLessThanOrEqual(AXIS_TOLERANCE)
    // same deck level: the bore a little above the planks the gunner stands on
    const bore = s.breech[1] - s.stand[1]
    expect(bore).toBeGreaterThanOrEqual(BORE_OVER_STAND[0])
    expect(bore).toBeLessThanOrEqual(BORE_OVER_STAND[1])
    // stand within reach of the breech
    expect(Math.hypot(s.stand[0] - s.breech[0], s.stand[2] - s.breech[2])).toBeLessThanOrEqual(STATION_REACH)
  })
})
