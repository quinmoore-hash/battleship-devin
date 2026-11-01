import { afterEach, describe, expect, it } from 'vitest'
import { deckBus, deckCameraLease, type DeckBusEvent, type DeckState } from '../deck/contract'
import { FLEET, type PlacedShip } from '../engine'
import { BOARD_LAYOUT } from '../scene/layout'
import { SHIPS, shipWorldTransform } from '../ships'
import { createDirector } from './director'
import { cellAtLocalX, deckEye, overboardFor, overboardNextUid, povFor, standingCell, standingCellFor, worldToLocal } from './pov'
import { OVERBOARD_SECONDS, buildSequence } from './sequence'
import type { CinematicEvent } from './types'
import { localToWorld } from '../vfx/cannon/anchors'

const mk = (id: PlacedShip['spec']['id'], x: number, y: number, orientation: PlacedShip['orientation'] = 'horizontal', hits: { x: number; y: number }[] = []): PlacedShip => {
  const spec = FLEET.find((s) => s.id === id)!
  const cells = Array.from({ length: spec.length }, (_, i) => (orientation === 'horizontal' ? { x: x + i, y } : { x, y: y + i }))
  return { spec, uid: id, origin: { x, y }, orientation, cells, hits }
}
const frigate = mk('frigate', 2, 1)
const fleets = { human: [frigate, mk('sloop', 2, 5)], enemy: [mk('galleon', 4, 4)] }
const onDeck: DeckState = { on: true, shipUid: 'frigate', station: null }
const pose = shipWorldTransform(frigate, BOARD_LAYOUT.player.origin)
const deckY = SHIPS.frigate.anchors.deckY
const hitAt = (i: number): CinematicEvent => ({ type: 'shot', by: 'enemy', target: frigate.cells[i], result: { coord: frigate.cells[i], outcome: 'hit', shipId: 'frigate', shipUid: 'frigate' } })
const record = () => {
  const events: DeckBusEvent[] = []
  const off = deckBus.on((e) => events.push(e))
  return { events, off }
}
let unsub: (() => void) | null = null
afterEach(() => {
  unsub?.()
  deckEye.position = null
  deckCameraLease.owner = 'deck'
})

describe('which hull section am I standing on', () => {
  it('cellAtLocalX: bow (+x) is cell 0, stern is the last cell, clamped past the ends', () => {
    expect(cellAtLocalX(1.5, 4)).toBe(0)
    expect(cellAtLocalX(0.5, 4)).toBe(1)
    expect(cellAtLocalX(-0.5, 4)).toBe(2)
    expect(cellAtLocalX(-1.5, 4)).toBe(3)
    expect(cellAtLocalX(9, 4)).toBe(0)
    expect(cellAtLocalX(-9, 4)).toBe(3)
  })

  it('worldToLocal inverts localToWorld for a rotated ship', () => {
    const p = { position: [3, 0, -2] as [number, number, number], rotationY: 1.1 }
    const w = localToWorld([0.7, 0.4, -0.3], p)
    const [x, z] = worldToLocal(w, p)
    expect(x).toBeCloseTo(0.7, 6)
    expect(z).toBeCloseTo(-0.3, 6)
  })

  it('standingCell maps the eye over each cell centre to that cell, horizontal and vertical ships alike', () => {
    for (const ship of [frigate, mk('frigate', 7, 2, 'vertical')]) {
      const sp = shipWorldTransform(ship, BOARD_LAYOUT.player.origin)
      for (let i = 0; i < ship.spec.length; i++) {
        const eye = localToWorld([ship.spec.length / 2 - (i + 0.5), deckY + 0.17, 0.1], sp)
        expect(standingCell(ship, sp, eye)).toBe(i)
      }
    }
  })

  it('standingCellFor: the manned gun decides, else the eye; unknown without either', () => {
    const pov = povFor(hitAt(1), onDeck, fleets, 'human')!
    expect(standingCellFor(pov, null)).toBeNull()
    expect(standingCellFor(pov, localToWorld([-1.2, deckY, 0], pose))).toBe(frigate.spec.length - 1)
    const manned = povFor(hitAt(1), { ...onDeck, station: 0 }, fleets, 'human')!
    expect(standingCellFor(manned, null)).toBe(SHIPS.frigate.anchors.cannons[0].cell)
  })

  it('overboardFor: only an incoming hit on the very section the player is on; never a miss, never outgoing', () => {
    const eye = localToWorld([0.5, deckY + 0.17, -0.2], pose) // over cell 1, port side
    const pov = povFor(hitAt(1), onDeck, fleets, 'human')!
    const ob = overboardFor(pov, hitAt(1), fleets.human, eye)!
    expect(ob).toMatchObject({ cell: 1, nextUid: 'sloop', boarded: false })
    expect(ob.point).toEqual(eye)
    expect(ob.splashAt[1]).toBe(BOARD_LAYOUT.surfaceY)
    expect(worldToLocal(ob.splashAt, pose)[1]).toBeLessThan(-SHIPS.frigate.anchors.hull.beam / 2) // over the port rail
    expect(overboardFor(pov, hitAt(2), fleets.human, eye)).toBeNull()
    const miss: CinematicEvent = { type: 'shot', by: 'enemy', target: { x: 0, y: 0 }, result: { coord: { x: 0, y: 0 }, outcome: 'miss' } }
    expect(overboardFor(povFor(miss, onDeck, fleets, 'human')!, miss, fleets.human, eye)).toBeNull()
    const outgoing: CinematicEvent = { type: 'shot', by: 'human', target: { x: 4, y: 4 }, result: { coord: { x: 4, y: 4 }, outcome: 'hit', shipId: 'galleon', shipUid: 'galleon' } }
    expect(overboardFor(povFor(outgoing, onDeck, fleets, 'human')!, outgoing, fleets.human, eye)).toBeNull()
  })

  it('overboardNextUid skips the hit ship, wraps, and falls back to the same ship when it is the last afloat', () => {
    expect(overboardNextUid(fleets.human, 'frigate')).toBe('sloop')
    const sunkSloop = mk('sloop', 2, 5, 'horizontal', [{ x: 2, y: 5 }, { x: 3, y: 5 }])
    expect(overboardNextUid([frigate, sunkSloop], 'frigate')).toBe('frigate')
  })

  it('the sequence gains an overboard beat between impact and return, by OVERBOARD_SECONDS (quick under reduced motion)', () => {
    const plain = buildSequence(hitAt(1), 'full', false, 'high', true)
    const ob = buildSequence(hitAt(1), 'full', false, 'high', true, true)
    expect(ob.beats.map((b) => b.name)).toEqual(['approach', 'fire', 'flight', 'impact', 'overboard', 'return'])
    expect(ob.duration).toBeCloseTo(plain.duration + OVERBOARD_SECONDS.full, 6)
    const o = ob.beats.find((b) => b.name === 'overboard')!
    expect(o.duration).toBeCloseTo(OVERBOARD_SECONDS.full, 6)
    expect(ob.beats.at(-1)!.start).toBeCloseTo(o.start + o.duration, 6)
    expect(buildSequence(hitAt(1), 'fast', true, 'high', true, true).beats.find((b) => b.name === 'overboard')!.duration).toBe(OVERBOARD_SECONDS.reduced)
    // overview sequences never carry it
    expect(buildSequence(hitAt(1), 'full', false, 'high', false, true).beats.map((b) => b.name)).toEqual(plain.beats.map((b) => b.name))
  })
})

describe('director: camera lease and the thrown-overboard beat', () => {
  const make = (deck = onDeck) => createDirector({ autoTick: false, audio: false, fleets: () => fleets, reducedMotion: () => false, deck: () => deck })
  const run = (d: ReturnType<typeof make>, seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) d.tick(0.05)
  }

  it('a shot on deck borrows the camera (lease + event) and hands it back when the sequence ends; sinks do not', () => {
    const { events, off } = record()
    unsub = off
    const d = make()
    void d.play(hitAt(2), 'fast')
    expect(deckCameraLease.owner).toBe('director')
    expect(events[0]).toEqual({ type: 'camera', owner: 'director' })
    expect(d.store.getState().letterbox).toBe(true)
    while (d.active) d.tick(0.1)
    expect(deckCameraLease.owner).toBe('deck')
    expect(events.at(-1)).toEqual({ type: 'camera', owner: 'deck' })
    events.length = 0
    void d.play({ type: 'sink', owner: 'human', shipId: 'sloop' }, 'fast')
    expect(deckCameraLease.owner).toBe('deck')
    expect(events.some((e) => e.type === 'camera')).toBe(false)
    while (d.active) d.tick(0.1)
  })

  it('the ball on my section: thrown-overboard is emitted at the overboard beat (once), with the next ship', () => {
    const { events, off } = record()
    unsub = off
    deckEye.position = localToWorld([0.5, deckY + 0.17, 0.2], pose) // cell 1
    const d = make()
    void d.play(hitAt(1), 'full')
    expect(d.active?.pov?.overboard).toMatchObject({ cell: 1, nextUid: 'sloop' })
    const seq = d.active!.seq
    const ob = seq.beats.find((b) => b.name === 'overboard')!
    run(d, ob.start - 0.1)
    expect(events.filter((e) => e.type === 'thrown-overboard')).toHaveLength(0)
    run(d, 0.2)
    expect(events.filter((e) => e.type === 'thrown-overboard')).toEqual([{ type: 'thrown-overboard', nextUid: 'sloop', cell: 1, point: deckEye.position }])
    while (d.active) d.tick(0.1)
    expect(events.filter((e) => e.type === 'thrown-overboard')).toHaveLength(1)
    expect(deckCameraLease.owner).toBe('deck')
  })

  it('the ball on another section, or with the eye unknown: a plain shot (no overboard beat)', () => {
    deckEye.position = localToWorld([0.5, deckY + 0.17, 0.2], pose) // cell 1
    const d = make()
    void d.play(hitAt(2), 'fast')
    expect(d.active?.pov?.overboard).toBeUndefined()
    expect(d.active?.seq.beats.some((b) => b.name === 'overboard')).toBe(false)
    while (d.active) d.tick(0.1)
    deckEye.position = null
    void d.play(hitAt(1), 'fast')
    expect(d.store.getState().active?.pov?.overboard).toBeUndefined()
    while (d.store.getState().active) d.tick(0.1)
  })

  it('cinematics off: the event still fires synchronously', () => {
    const { events, off } = record()
    unsub = off
    deckEye.position = localToWorld([0.5, deckY + 0.17, 0.2], pose)
    const d = make()
    void d.play(hitAt(1), 'off')
    expect(events.filter((e) => e.type === 'thrown-overboard')).toHaveLength(1)
    expect(d.active).toBeNull()
    expect(deckCameraLease.owner).toBe('deck')
  })
})
