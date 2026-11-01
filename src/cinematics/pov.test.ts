import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_DECK, deckBus, type DeckBusEvent, type DeckState } from '../deck/contract'
import { FLEET, type PlacedShip } from '../engine'
import { SHIPS } from '../ships'
import { createDirector } from './director'
import { POV, nextAfloatUid, povFor, stationBattery } from './pov'
import { buildSequence } from './sequence'
import type { CinematicEvent } from './types'

const mk = (id: PlacedShip['spec']['id'], x: number, y: number, hits: { x: number; y: number }[] = [], uid: string = id): PlacedShip => {
  const spec = FLEET.find((s) => s.id === id)!
  return { spec, uid, origin: { x, y }, orientation: 'horizontal', cells: Array.from({ length: spec.length }, (_, i) => ({ x: x + i, y })), hits }
}
const fleets = { human: [mk('frigate', 2, 1), mk('sloop', 2, 5)], enemy: [mk('galleon', 4, 4)] }
const onDeck: DeckState = { on: true, shipUid: 'frigate', station: null }
const make = (deck = onDeck, reducedMotion = false) => createDirector({ autoTick: false, audio: false, fleets: () => fleets, reducedMotion: () => reducedMotion, deck: () => deck })

const outgoing: CinematicEvent = { type: 'shot', by: 'human', target: { x: 5, y: 4 }, result: { coord: { x: 5, y: 4 }, outcome: 'hit', shipId: 'galleon', shipUid: 'galleon' } }
const incomingHit: CinematicEvent = { type: 'shot', by: 'enemy', target: { x: 3, y: 1 }, result: { coord: { x: 3, y: 1 }, outcome: 'hit', shipId: 'frigate', shipUid: 'frigate' } }
const incomingOther: CinematicEvent = { type: 'shot', by: 'enemy', target: { x: 2, y: 5 }, result: { coord: { x: 2, y: 5 }, outcome: 'hit', shipId: 'sloop', shipUid: 'sloop' } }
const incomingMiss: CinematicEvent = { type: 'shot', by: 'enemy', target: { x: 0, y: 0 }, result: { coord: { x: 0, y: 0 }, outcome: 'miss' } }
const sinkStanding: CinematicEvent = { type: 'sink', owner: 'human', shipId: 'frigate' }
const sinkOther: CinematicEvent = { type: 'sink', owner: 'human', shipId: 'sloop' }

const record = () => {
  const events: DeckBusEvent[] = []
  // the camera lease events (follow-cam) are covered in overboard.test.ts
  const off = deckBus.on((e) => {
    if (e.type !== 'camera') events.push(e)
  })
  return { events, off }
}
const run = (d: ReturnType<typeof make>, seconds: number) => {
  for (let t = 0; t < seconds; t += 0.05) d.tick(0.05)
}
let unsub: (() => void) | null = null
afterEach(() => unsub?.())

describe('on-deck POV branch', () => {
  it('is off by default: no pov on the sequence, no deck-bus traffic, camera shake as today', () => {
    const { events, off } = record()
    unsub = off
    const d = createDirector({ autoTick: false, audio: false, fleets: () => fleets })
    void d.play(incomingHit, 'full')
    expect(d.active?.pov).toBeNull()
    expect(d.active?.seq.pov).toBeUndefined()
    run(d, 2.6)
    expect(d.store.getState().shake).toBeGreaterThan(0)
    expect(events).toEqual([])
    expect(povFor(incomingHit, DEFAULT_DECK, fleets, 'human')).toBeNull()
  })

  it('buildSequence keeps beats and durations identical with pov on', () => {
    for (const ev of [outgoing, sinkStanding, { type: 'battle-start' } as const, { type: 'victory', winner: 'human' } as const]) {
      for (const level of ['full', 'fast', 'off'] as const) {
        const a = buildSequence(ev, level)
        const b = buildSequence(ev, level, false, 'high', true)
        expect(b.beats).toEqual(a.beats)
        expect(b.duration).toBe(a.duration)
        expect(a.pov).toBeUndefined()
        expect(level === 'off' || b.pov).toBeTruthy()
      }
    }
  })

  it('outgoing shot from a manned gun: that cannon fires, shake 0.3 on fire, look-at the impact, no camera shake', () => {
    const { events, off } = record()
    unsub = off
    const d = make({ ...onDeck, station: 2 })
    void d.play(outgoing, 'full')
    const cannon = SHIPS.frigate.anchors.cannons[2]
    expect(d.active?.plan?.battery).toEqual({ shipId: 'frigate', uid: 'frigate', side: cannon.side, cells: [cannon.cell] })
    expect(d.active?.plan?.muzzles).toHaveLength(1)
    run(d, 1.0)
    expect(d.active?.beat).toBe('fire')
    expect(events).toEqual([{ type: 'shake', intensity: POV.fireShake, seconds: 0.3 }])
    run(d, 1.6)
    expect(d.active?.beat).toBe('impact')
    expect(d.store.getState().shake).toBe(0)
    expect(events[1]).toEqual({ type: 'look-at', point: d.active!.plan!.impact, seconds: POV.lookSeconds })
    expect(events[2]).toMatchObject({ type: 'shake', intensity: POV.farShake })
  })

  it('station null falls back to the director battery pick; an explicit battery (Broadside) wins', () => {
    const d = make()
    void d.play(outgoing, 'full')
    expect(d.active?.plan?.battery?.shipId).toBe('frigate')
    expect(d.active?.plan?.muzzles.length).toBeGreaterThan(1)
    d.skip()
    const battery = { shipId: 'sloop' as const, uid: 'sloop', side: 'port' as const, cells: [0] }
    const d2 = make({ ...onDeck, station: 0 })
    void d2.play({ ...outgoing, battery }, 'full')
    expect(d2.active?.plan?.battery).toBe(battery)
    expect(stationBattery(null)).toBeNull()
  })

  it('incoming hit on the standing ship: shake 1.0 for 0.6 s + look-at; on another own ship a smaller shake; miss a nudge', () => {
    const { events, off } = record()
    unsub = off
    const d = make()
    void d.play(incomingHit, 'full')
    expect(d.active?.pov).toMatchObject({ outgoing: false, ownSide: true, standingHit: true })
    run(d, 2.6)
    expect(events.find((e) => e.type === 'shake')).toEqual({ type: 'shake', intensity: POV.hitShake, seconds: POV.hitShakeSeconds })
    expect(events.find((e) => e.type === 'look-at')).toMatchObject({ point: d.active!.plan!.impact })
    d.skip()
    events.length = 0
    void d.play(incomingOther, 'full')
    expect(d.active?.pov?.standingHit).toBe(false)
    run(d, 2.6)
    expect(events.find((e) => e.type === 'shake')).toMatchObject({ intensity: POV.nearShake })
    d.skip()
    events.length = 0
    void d.play(incomingMiss, 'full')
    run(d, 2.6)
    expect(events.find((e) => e.type === 'shake')).toMatchObject({ intensity: POV.nearMissShake })
  })

  it('reduced motion: shakes are 0 and there is no look-at', () => {
    const { events, off } = record()
    unsub = off
    const d = make(onDeck, true)
    void d.play(incomingHit, 'full')
    run(d, 2.6)
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((e) => e.type === 'shake' && e.intensity === 0)).toBe(true)
  })

  it('sinking the standing ship emits abandon-ship with the next afloat own ship at 1.5 s (once), skip emits it too', () => {
    const { events, off } = record()
    unsub = off
    const d = make()
    void d.play(sinkStanding, 'full')
    run(d, 1.4)
    expect(events).toEqual([])
    run(d, 0.2)
    expect(events).toEqual([{ type: 'abandon-ship', nextUid: 'sloop' }])
    while (d.active) d.tick(0.1)
    expect(events).toHaveLength(1)
    events.length = 0
    const d2 = make()
    void d2.play(sinkStanding, 'full')
    d2.skip()
    expect(events).toEqual([{ type: 'abandon-ship', nextUid: 'sloop' }])
    events.length = 0
    const d3 = make()
    void d3.play(sinkStanding, 'off')
    expect(events).toEqual([{ type: 'abandon-ship', nextUid: 'sloop' }])
  })

  it('sinking another ship: look-at it, no abandon-ship', () => {
    const { events, off } = record()
    unsub = off
    const d = make()
    void d.play(sinkOther, 'full')
    while (d.active) d.tick(0.1)
    expect(events.map((e) => e.type)).toEqual(['look-at'])
  })

  it('nextAfloatUid walks the fleet in order, skipping sunk ships, null when none left', () => {
    const own = [mk('frigate', 0, 0), mk('sloop', 0, 2, [{ x: 0, y: 2 }, { x: 1, y: 2 }]), mk('galleon', 0, 4, [], 'galleon#2')]
    expect(nextAfloatUid(own, 'frigate')).toBe('galleon#2')
    expect(nextAfloatUid(own, 'galleon#2')).toBe('frigate')
    expect(nextAfloatUid([own[0]], 'frigate')).toBeNull()
  })

  it('the sinking shot / sink event of the standing ship still counts as standing (the snapshot already marks it sunk) and no letterbox on deck', () => {
    const sunkFrigate = { ...fleets, human: [mk('frigate', 2, 1, Array.from({ length: 4 }, (_, i) => ({ x: 2 + i, y: 1 }))), fleets.human[1]] }
    const sinkingShot: CinematicEvent = { ...incomingHit, result: { ...incomingHit.result, outcome: 'sunk' } }
    expect(povFor(sinkingShot, onDeck, sunkFrigate, 'human')).toMatchObject({ standingHit: true, standing: { uid: 'frigate' } })
    expect(povFor(sinkStanding, onDeck, sunkFrigate, 'human')).toMatchObject({ standingHit: true, standing: { uid: 'frigate' } })
    const { events, off } = record()
    unsub = off
    const d = createDirector({ autoTick: false, audio: false, fleets: () => sunkFrigate, deck: () => onDeck })
    void d.play(sinkStanding, 'full')
    expect(d.store.getState().letterbox).toBe(false)
    run(d, 1.6)
    expect(events).toEqual([{ type: 'abandon-ship', nextUid: 'sloop' }])
    const overview = createDirector({ autoTick: false, audio: false, fleets: () => fleets })
    void overview.play(sinkStanding, 'full')
    expect(overview.store.getState().letterbox).toBe(true)
  })

  it('standing ship: the deck uid while afloat, else the first afloat own ship', () => {
    const sunkFrigate = { ...fleets, human: [mk('frigate', 2, 1, Array.from({ length: 4 }, (_, i) => ({ x: 2 + i, y: 1 }))), fleets.human[1]] }
    expect(povFor(incomingOther, onDeck, sunkFrigate, 'human')?.standing?.uid).toBe('sloop')
    expect(povFor(incomingOther, onDeck, sunkFrigate, 'human')?.standingHit).toBe(true)
  })
})
