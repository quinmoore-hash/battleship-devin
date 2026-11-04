import { afterEach, describe, expect, it } from 'vitest'
import { setPlayerDeck } from '../crew/playerPose'
import { DEFAULT_DECK, deckBus, deckCameraLease, type DeckBusEvent, type DeckState } from '../deck/contract'
import { FLEET, type PlacedShip } from '../engine'
import { SHIPS, damageOf, shipWorldTransform } from '../ships'
import { lastHitIndex, placedShipSeed, sectionSurfaceY, sinkPose } from '../vfx/sinking/pose'
import { sinkProgressAt } from '../vfx/sinking/timeline'
import { resolveDeckAnchors, stationsOf } from '../deck/math'
import { createDirector } from './director'
import { POV, abandonAtFor, nextAfloatUid, povFor, sinkViewFor, stationBattery } from './pov'
import { beatEnd, beatStart, buildSequence } from './sequence'
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
afterEach(() => {
  unsub?.()
  setPlayerDeck(null)
  deckCameraLease.owner = 'deck'
})

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

  it('outgoing shot from a manned gun: that cannon fires, shake 0.3 on fire, no look-at (camera borrowed), no camera shake', () => {
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
    // the director borrowed the camera for this shot (follow-cam shows the impact): no look-at nudge, only the far shake
    expect(events.find((e) => e.type === 'look-at')).toBeUndefined()
    expect(events[1]).toMatchObject({ type: 'shake', intensity: POV.farShake })
  })

  it('station null (walking) fires one usable gun of the standing ship; an explicit battery (Broadside) wins', () => {
    const d = make()
    void d.play(outgoing, 'full')
    expect(d.active?.plan?.battery?.shipId).toBe('frigate')
    expect(d.active?.plan?.battery?.cells).toHaveLength(1)
    expect(d.active?.plan?.muzzles.length).toBe(1)
    d.skip()
    const battery = { shipId: 'sloop' as const, uid: 'sloop', side: 'port' as const, cells: [0] }
    const d2 = make({ ...onDeck, station: 0 })
    void d2.play({ ...outgoing, battery }, 'full')
    expect(d2.active?.plan?.battery).toBe(battery)
    expect(stationBattery(null)).toBeNull()
  })

  it('incoming hit on the standing ship: shake 1.0 for 0.6 s, no look-at (camera borrowed); on another own ship a smaller shake; miss a nudge', () => {
    const { events, off } = record()
    unsub = off
    const d = make()
    void d.play(incomingHit, 'full')
    expect(d.active?.pov).toMatchObject({ outgoing: false, ownSide: true, standingHit: true })
    run(d, 2.6)
    expect(events.find((e) => e.type === 'shake')).toEqual({ type: 'shake', intensity: POV.hitShake, seconds: POV.hitShakeSeconds })
    expect(events.find((e) => e.type === 'look-at')).toBeUndefined()
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

  it('sinking the standing ship emits abandon-ship (once) when the deck under the player goes awash, never before 1.5 s; skip / off emit it at once', () => {
    const { events, off } = record()
    unsub = off
    setPlayerDeck('frigate', 0.3, 0.1)
    const d = make()
    void d.play(sinkStanding, 'full')
    const seq = d.active!.seq
    const at = d.active!.pov!.abandonAt!
    expect(at).toBeCloseTo(abandonAtFor(d.active!.pov!, seq))
    expect(at).toBeGreaterThanOrEqual(POV.abandonAt)
    expect(at).toBeLessThanOrEqual(beatEnd(seq, 'sink'))
    // the cue: the deck at the player's feet (the pose the controller follows) is awash at `at`, still dry a moment before
    const ship = fleets.human[0]
    const anchors = SHIPS.frigate.anchors
    const input = { seed: placedShipSeed(ship), hull: anchors.hull, damage: damageOf(ship), lastHit: lastHitIndex(ship) }
    const deckAt = (t: number) => sectionSurfaceY(sinkPose(sinkProgressAt(t, seq.sink!), input), 0.3, anchors.deckY, 0.1)
    expect(deckAt(at + 0.1)).toBeLessThanOrEqual(POV.awashY + 0.05)
    expect(deckAt(at - 0.6)).toBeGreaterThan(POV.awashY)
    expect(deckAt(POV.abandonAt)).toBeGreaterThan(0.1)
    run(d, at - 0.1)
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
    // fast (2 s, no slow-mo): the deck is awash early, the floor keeps the beat readable
    const d4 = make()
    void d4.play(sinkStanding, 'fast')
    expect(d4.active!.pov!.abandonAt).toBeGreaterThanOrEqual(POV.abandonAt)
    expect(d4.active!.pov!.abandonAt).toBeLessThanOrEqual(beatEnd(d4.active!.seq, 'sink'))
    // no sink timeline (not a sink sequence): the floor
    expect(abandonAtFor(d4.active!.pov!, buildSequence(incomingHit, 'full'))).toBe(POV.abandonAt)
  })

  it('sinking another own ship in view: the look swings to it and holds for the whole sink beat, frees on return, camera stays with the deck', () => {
    const { events, off } = record()
    unsub = off
    const camera: DeckBusEvent[] = []
    const offCam = deckBus.on((e) => (e.type === 'camera' ? camera.push(e) : undefined))
    const d = make()
    void d.play(sinkOther, 'full')
    const seq = d.active!.seq
    expect(d.active!.pov).toMatchObject({ sinkView: 'look' })
    expect(d.active!.pov!.cameraBorrowed).toBeFalsy()
    expect(d.store.getState().letterbox).toBe(false)
    expect(deckCameraLease.owner).toBe('deck')
    const sinkEnd = beatEnd(seq, 'sink')
    run(d, sinkEnd - 0.2)
    const looks = events.filter((e) => e.type === 'look-at')
    expect(looks.length).toBeGreaterThan(20)
    expect(events.length).toBe(looks.length)
    expect(new Set(looks.map((e) => JSON.stringify(e))).size).toBe(1)
    expect(looks[0]).toMatchObject({ seconds: POV.sinkLookSeconds })
    expect(events.find((e) => e.type === 'abandon-ship')).toBeUndefined()
    // the last look-at comes with the end of the sink beat: the return beat emits nothing, the player may look away
    run(d, 0.4)
    const n = events.length
    expect(d.active?.beat).toBe('return')
    while (d.active) d.tick(0.1)
    expect(events.length).toBe(n)
    expect(camera).toEqual([])
    offCam()
  })

  it('sinking another own ship hidden fore / aft behind the standing ship: the director borrows the camera for the sink and hands it back; no look-at (BUG-716)', () => {
    const astern = { ...fleets, human: [...fleets.human, mk('brigantine', 7, 1)] }
    const sinkAstern: CinematicEvent = { type: 'sink', owner: 'human', shipId: 'brigantine' }
    setPlayerDeck('frigate', 0, 0)
    const { events, off } = record()
    unsub = off
    const camera: DeckBusEvent[] = []
    const offCam = deckBus.on((e) => (e.type === 'camera' ? camera.push(e) : undefined))
    const d = createDirector({ autoTick: false, audio: false, fleets: () => astern, deck: () => onDeck })
    void d.play(sinkAstern, 'full')
    expect(d.active!.pov).toMatchObject({ sinkView: 'borrow', cameraBorrowed: true, standingHit: false })
    expect(camera).toEqual([{ type: 'camera', owner: 'director' }])
    expect(deckCameraLease.owner).toBe('director')
    expect(d.store.getState().letterbox).toBe(true)
    while (d.active) d.tick(0.1)
    expect(events.find((e) => e.type === 'look-at')).toBeUndefined()
    expect(events.find((e) => e.type === 'abandon-ship')).toBeUndefined()
    expect(camera.at(-1)).toEqual({ type: 'camera', owner: 'deck' })
    expect(deckCameraLease.owner).toBe('deck')
    // skip hands the camera back too
    camera.length = 0
    void d.play(sinkAstern, 'full')
    d.skip()
    expect(camera).toEqual([{ type: 'camera', owner: 'director' }, { type: 'camera', owner: 'deck' }])
    offCam()
  })

  it('sinkViewFor: abeam → look; along the standing ship\'s axis → borrow; a manned gun pointing the other way → borrow; unknown eye → look', () => {
    const astern = { ...fleets, human: [...fleets.human, mk('brigantine', 7, 1)] }
    const pov = povFor(sinkOther, onDeck, astern, 'human')!
    const eye: [number, number, number] = [0, 0, 0]
    const frigate = astern.human[0]
    const pose = shipWorldTransform(frigate)
    eye[0] = pose.position[0]
    eye[1] = pose.position[1] + 0.5
    eye[2] = pose.position[2]
    const sloopAt = shipWorldTransform(astern.human[1]).position
    const brigAt = shipWorldTransform(astern.human[2]).position
    expect(sinkViewFor(pov, sloopAt, eye)).toBe('look')
    expect(sinkViewFor(pov, brigAt, eye)).toBe('borrow')
    expect(sinkViewFor(pov, brigAt, null)).toBe('look')
    // manning: the frigate's guns face port or starboard; the sloop lies to one side, so a gun on the other side cannot glance at it
    const anchors = SHIPS.frigate.anchors
    const stations = stationsOf(anchors, resolveDeckAnchors(anchors, 'frigate'))
    const sideOf = Math.sign(sloopAt[2] - pose.position[2])
    const towards = stations.findIndex((st) => st.onDeck && Math.sign(st.direction[2]) === sideOf)
    const away = stations.findIndex((st) => st.onDeck && Math.sign(st.direction[2]) === -sideOf)
    expect(towards).toBeGreaterThanOrEqual(0)
    expect(away).toBeGreaterThanOrEqual(0)
    expect(sinkViewFor({ ...pov, deck: { ...onDeck, station: away } }, sloopAt, eye)).toBe('borrow')
    expect(sinkViewFor({ ...pov, deck: { ...onDeck, station: towards } }, sloopAt, eye)).toBe('look')
  })

  it('reduced motion: an own ship sinking in view emits no look-at at all; an enemy sink keeps its single nudge', () => {
    const { events, off } = record()
    unsub = off
    const d = make(onDeck, true)
    void d.play(sinkOther, 'full')
    while (d.active) d.tick(0.1)
    expect(events).toEqual([])
    const d2 = make()
    void d2.play({ type: 'sink', owner: 'enemy', shipId: 'galleon' }, 'full')
    while (d2.active) d2.tick(0.1)
    expect(events.map((e) => e.type)).toEqual(['look-at'])
    expect(events[0]).toMatchObject({ seconds: POV.sinkLookSeconds })
    expect(beatStart(buildSequence(sinkOther, 'full'), 'sink')).toBe(0)
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
    run(d, d.active!.pov!.abandonAt! + 0.1)
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
