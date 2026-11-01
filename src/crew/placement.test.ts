import { describe, expect, it } from 'vitest'
import { SHIPS } from '../ships'
import type { ShipId } from '../engine'
import { resolveDeckAnchors, stationsOf, dist } from '../deck/math'
import { CREW_COUNT, CREW_SPACING, PLAYER_CLEARANCE, placeCrew, reactionFor, cellOfX, rng } from './placement'
import { samplePose, CLIPS, makePose, clipDone, REST } from './anim'

const ids = Object.keys(SHIPS) as ShipId[]

describe('crew placement', () => {
  it('is deterministic for a seed and fills the class count', () => {
    for (const id of ids) {
      const a = SHIPS[id].anchors
      const one = placeCrew(a, 12345, CREW_COUNT[id])
      const two = placeCrew(a, 12345, CREW_COUNT[id])
      expect(two).toEqual(one)
      expect(one.length).toBe(CREW_COUNT[id])
      const other = placeCrew(a, 999, CREW_COUNT[id])
      expect(other.map((s) => [s.x, s.z, s.variant])).not.toEqual(one.map((s) => [s.x, s.z, s.variant]))
    }
  })

  it('keeps clear of the spawn, each other and the hull edges; gunners stand on real stations', () => {
    for (const id of ids) {
      const a = SHIPS[id].anchors
      const deck = resolveDeckAnchors(a)
      const stations = stationsOf(a, deck)
      const crew = placeCrew(a, 7, CREW_COUNT[id])
      const spawn: [number, number] = [deck.spawn[0], deck.spawn[2]]
      for (let i = 0; i < crew.length; i++) {
        const c = crew[i]
        expect(dist([c.x, c.z], spawn)).toBeGreaterThanOrEqual(PLAYER_CLEARANCE - 1e-9)
        for (let j = i + 1; j < crew.length; j++) expect(dist([c.x, c.z], [crew[j].x, crew[j].z])).toBeGreaterThanOrEqual(CREW_SPACING - 1e-9)
        expect(Math.abs(c.x)).toBeLessThanOrEqual(a.hull.length / 2)
        expect(Math.abs(c.z)).toBeLessThanOrEqual(a.hull.beam / 2 + 1e-9)
        expect(c.y).toBeGreaterThanOrEqual(a.deckY - 1e-9)
        expect(c.cell).toBe(cellOfX(c.x, a.hull.length))
        if (c.role === 'gunner') {
          const s = stations[c.station]
          expect(s).toBeDefined()
          expect(s.onDeck).toBe(true)
        } else expect(c.station).toBe(-1)
      }
      expect(crew.filter((c) => c.role === 'gunner').length).toBeGreaterThanOrEqual(1)
      expect(crew.filter((c) => c.role === 'lookout').length).toBe(1)
      // No two gunners share a station.
      const st = crew.filter((c) => c.role === 'gunner').map((c) => c.station)
      expect(new Set(st).size).toBe(st.length)
    }
  })

  it('respects the low-tier count and a moving player position', () => {
    const a = SHIPS.frigate.anchors
    expect(placeCrew(a, 1, 2).length).toBe(2)
    const crew = placeCrew(a, 1, 5, [0.2, 0.1])
    for (const c of crew) expect(dist([c.x, c.z], [0.2, 0.1])).toBeGreaterThanOrEqual(PLAYER_CLEARANCE - 1e-9)
  })

  it('rng is deterministic and uniform-ish', () => {
    const a = rng(42)
    const b = rng(42)
    const xs = Array.from({ length: 200 }, () => a())
    expect(Array.from({ length: 200 }, () => b())).toEqual(xs)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...xs)).toBeLessThan(1)
  })
})

describe('hit reactions', () => {
  it('throws the nearest figure to the hit cell and stumbles the rest within a cell', () => {
    const a = SHIPS['man-o-war'].anchors
    const crew = placeCrew(a, 3, 8)
    for (let cell = 0; cell < a.hull.length; cell++) {
      const r = reactionFor(crew, cell, a.hull.length)
      if (r.thrown >= 0) {
        expect(Math.abs(crew[r.thrown].cell - cell)).toBeLessThanOrEqual(1)
        expect(r.stumble).not.toContain(r.thrown)
        for (const i of r.stumble) expect(Math.abs(crew[i].cell - cell)).toBeLessThanOrEqual(2)
      }
    }
    // Someone always reacts somewhere on a fully crewed ship.
    const total = Array.from({ length: a.hull.length }, (_, c) => reactionFor(crew, c, a.hull.length).thrown).filter((t) => t >= 0)
    expect(total.length).toBeGreaterThan(0)
  })

  it('skips figures already overboard and reports nobody when the deck is empty', () => {
    const a = SHIPS.sloop.anchors
    const crew = placeCrew(a, 3, 3)
    const gone = crew.map(() => true)
    expect(reactionFor(crew, 0, a.hull.length, gone)).toEqual({ thrown: -1, stumble: [] })
    const first = reactionFor(crew, 1, a.hull.length)
    if (first.thrown >= 0) {
      const g = crew.map((_, i) => i === first.thrown)
      expect(reactionFor(crew, 1, a.hull.length, g).thrown).not.toBe(first.thrown)
    }
  })
})

describe('keyframe sampler', () => {
  it('interpolates between frames, wraps loops and holds one-shots', () => {
    const out = makePose()
    samplePose(CLIPS.haul, 0, out)
    expect(out.armL).toBeCloseTo(1.3)
    samplePose(CLIPS.haul, 0.35, out)
    expect(out.armL).toBeCloseTo(0.9, 5)
    samplePose(CLIPS.haul, CLIPS.haul.duration + 0.35, out)
    expect(out.armL).toBeCloseTo(0.9, 5)
    samplePose(CLIPS.stumble, 99, out)
    expect(out.crouch).toBeCloseTo(0)
    expect(clipDone(CLIPS.stumble, 1.5)).toBe(true)
    expect(clipDone(CLIPS.stumble, 1.4)).toBe(false)
    expect(clipDone(CLIPS.idle, 1e6)).toBe(false)
  })

  it('fills omitted keys with the rest pose and never NaNs', () => {
    const out = makePose()
    for (const clip of Object.values(CLIPS)) {
      for (let t = -1; t < clip.duration + 1; t += 0.07) {
        samplePose(clip, t, out)
        for (const v of Object.values(out)) expect(Number.isFinite(v)).toBe(true)
      }
    }
    samplePose(CLIPS.lookout, 0, out)
    expect(out.legL).toBe(REST.legL)
  })
})
