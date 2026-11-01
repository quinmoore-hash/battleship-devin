import { describe, expect, it } from 'vitest'
import { SHIPS } from '../ships'
import { BOARD_LAYOUT, boardCenter } from '../scene/layout'
import type { DeckAnchors } from './contract'
import {
  afloatUids,
  clampToPolygon,
  cycleShip,
  deckHeightAt,
  eyeFor,
  fallbackDeckAnchors,
  isFallbackDeck,
  gunnerPose,
  lookForward,
  nearestStation,
  pointInPolygon,
  pushOutOfObstacles,
  rayToCell,
  rectPolygon,
  resolveDeckAnchors,
  spawnPose,
  stationsOf,
  stationUsable,
  stepOnDeck,
  yawToward,
} from './math'

const rect = rectPolygon(4, 1, 0)

describe('deck fallback rectangle', () => {
  it('shrinks the hull by 0.06 and puts masts in as obstacles at deckY', () => {
    const a = SHIPS['man-o-war'].anchors
    const d = fallbackDeckAnchors(a)
    expect(d.walk).toHaveLength(1)
    expect(d.walk[0].y).toBe(a.deckY)
    const xs = d.walk[0].points.map((p) => p[0])
    const zs = d.walk[0].points.map((p) => p[1])
    expect(Math.max(...xs)).toBeCloseTo(a.hull.length / 2 - 0.06)
    expect(Math.max(...zs)).toBeCloseTo(a.hull.beam / 2 - 0.06)
    expect(d.obstacles).toHaveLength(a.masts.length)
    expect(d.obstacles[0].radius).toBe(0.05)
    expect(d.stations).toHaveLength(a.cannons.length)
    expect(pointInPolygon([d.spawn[0], d.spawn[2]], d.walk[0].points)).toBe(true)
  })

  it('every class resolves to a walkable deck (authored or fallback) whose spawn is inside it', () => {
    for (const id of Object.keys(SHIPS) as (keyof typeof SHIPS)[]) {
      const d = resolveDeckAnchors(SHIPS[id].anchors)
      const pose = spawnPose(d)
      expect(pointInPolygon([pose.x, pose.z], d.walk[pose.level].points)).toBe(true)
    }
  })

  it('prefers authored deck anchors when present', () => {
    const authored: DeckAnchors = { spawn: [0, 1, 0], walk: [{ points: rect, y: 1 }], ramps: [], obstacles: [], stations: [] }
    expect(resolveDeckAnchors({ ...SHIPS.sloop.anchors, deck: authored })).toBe(authored)
  })
})

describe('polygon clamp', () => {
  it('keeps inside points and snaps outside points to the edge, either winding', () => {
    expect(pointInPolygon([0, 0], rect)).toBe(true)
    expect(pointInPolygon([2.1, 0], rect)).toBe(false)
    expect(clampToPolygon([0.3, 0.2], rect)).toEqual([0.3, 0.2])
    const edge = clampToPolygon([3, 0.2], rect)
    expect(edge[0]).toBeCloseTo(2)
    expect(edge[1]).toBeCloseTo(0.2)
    expect(clampToPolygon([-3, -3], rect)).toEqual([-2, -0.5])
    const cw = [...rect].reverse()
    expect(pointInPolygon([0, 0], cw)).toBe(true)
    expect(clampToPolygon([0, 4], cw)).toEqual([0, 0.5])
  })

  it('pushes the player out of obstacles', () => {
    const [x, z] = pushOutOfObstacles([0.01, 0], [{ center: [0, 0], radius: 0.05 }], 0.03)
    expect(Math.hypot(x, z)).toBeCloseTo(0.08)
    expect(pushOutOfObstacles([0.5, 0], [{ center: [0, 0], radius: 0.05 }])).toEqual([0.5, 0])
  })
})

describe('stepOnDeck', () => {
  const deck: DeckAnchors = {
    spawn: [-1.5, 0.5, 0],
    walk: [
      { points: rectPolygon(4, 1), y: 0.5 },
      { points: [[2, -0.5], [3, -0.5], [3, 0.5], [2, 0.5]], y: 0.8 },
    ],
    ramps: [{ from: 0, to: 1, a: [2, -0.2], b: [2, 0.2] }],
    obstacles: [{ center: [0, 0], radius: 0.05 }],
    stations: [],
  }

  it('cannot walk off the ship', () => {
    const p = stepOnDeck({ x: 0, z: 0.45, y: 0.5, level: 0 }, 0, 1, deck)
    expect(p.z).toBeCloseTo(0.5)
    expect(p.level).toBe(0)
  })

  it('cannot walk through a mast', () => {
    const p = stepOnDeck({ x: -0.1, z: 0, y: 0.5, level: 0 }, 0.09, 0, deck)
    expect(Math.hypot(p.x, p.z)).toBeGreaterThanOrEqual(0.08 - 1e-9)
  })

  it('crosses onto the next level only over the ramp and blends the height there', () => {
    const over = stepOnDeck({ x: 1.95, z: 0, y: 0.5, level: 0 }, 0.1, 0, deck)
    expect(over.level).toBe(1)
    expect(over.x).toBeCloseTo(2.05)
    const blocked = stepOnDeck({ x: 1.95, z: 0.4, y: 0.5, level: 0 }, 0.1, 0, deck)
    expect(blocked.level).toBe(0)
    expect(blocked.x).toBeCloseTo(2)
    expect(deckHeightAt([2, 0], 0, deck)).toBeCloseTo(0.65)
    expect(deckHeightAt([2, 0], 1, deck)).toBeCloseTo(0.65)
    expect(deckHeightAt([0, 0], 0, deck)).toBe(0.5)
    expect(deckHeightAt([2.9, 0], 1, deck)).toBe(0.8)
  })
})

describe('stations', () => {
  const manOWar = SHIPS['man-o-war'].anchors
  const deck = fallbackDeckAnchors(manOWar)
  const stations = stationsOf(manOWar, deck)
  const enemy = boardCenter(BOARD_LAYOUT.enemy)

  it('only main-deck guns are reachable; the stand sits 0.12 u inboard of the muzzle at deckY', () => {
    const upper = stations.filter((s) => s.onDeck)
    const lower = stations.filter((s) => !s.onDeck)
    expect(upper.length).toBeGreaterThan(0)
    expect(lower.length).toBeGreaterThan(0)
    const s = upper[0]
    expect(s.stand[1]).toBe(manOWar.deckY)
    expect(Math.abs(s.stand[2])).toBeCloseTo(Math.abs(s.muzzle[2]) - 0.12 * Math.abs(s.direction[2]), 5)
  })

  it('a horizontal ship on the near board: only the port (−z) battery bears on the enemy waters', () => {
    const shipPos: [number, number, number] = [0, 0, 6]
    const port = stations.find((s) => s.side === 'port')!
    const starboard = stations.find((s) => s.side === 'starboard')!
    expect(stationUsable(port, 0, shipPos, enemy)).toBe(true)
    expect(stationUsable(starboard, 0, shipPos, enemy)).toBe(false)
    // turned 180° the other side bears
    expect(stationUsable(port, Math.PI, shipPos, enemy)).toBe(false)
    expect(stationUsable(starboard, Math.PI, shipPos, enemy)).toBe(true)
  })

  it('a vertical ship (bow +z) has its starboard side facing −x: neither battery bears straight across, the one toward the board wins', () => {
    const shipPos: [number, number, number] = [-2, 0, 6]
    const port = stations.find((s) => s.side === 'port')!
    // -π/2 rotation: ship +z (starboard) maps to world +x? check that exactly one side bears
    const a = stationUsable(port, -Math.PI / 2, shipPos, [0, 0, 6])
    const b = stationUsable({ direction: [0, 0, 1] }, -Math.PI / 2, shipPos, [0, 0, 6])
    expect(a).not.toBe(b)
  })

  it('nearestStation finds a stand within reach and ignores below-deck guns', () => {
    const s = stations.find((x) => x.onDeck)!
    expect(nearestStation(stations, s.stand[0] + 0.05, s.stand[2])?.index).toBe(s.index)
    expect(nearestStation(stations, s.stand[0] + 0.5, s.stand[2] + 0.5)).toBeNull()
    const below = stations.find((x) => !x.onDeck)!
    expect(nearestStation(stations, below.stand[0], below.stand[2], 0.01)).toBeNull()
  })

  it('gunnerPose sights along the barrel from just above the muzzle (outside the planking)', () => {
    const s = stations.find((x) => x.onDeck && x.side === 'port')!
    const pose = gunnerPose(s)
    expect(pose.position[2]).toBeGreaterThan(s.muzzle[2]) // port muzzle is at −z; the eye is a hair inboard of it
    expect(pose.position[2] - s.muzzle[2]).toBeLessThan(0.1)
    expect(pose.position[1]).toBeGreaterThan(s.muzzle[1])
    const f = lookForward(pose.yaw, 0)
    expect(f[2]).toBeLessThan(-0.99)
  })

  it('the fallback deck is marked and raises the eye over the bulwark; authored decks keep the contract eye height', () => {
    const fb = resolveDeckAnchors(SHIPS.sloop.anchors)
    expect(isFallbackDeck(fb)).toBe(true)
    expect(eyeFor(fb)).toBe(0.3)
    const authored: DeckAnchors = { spawn: [0, 1, 0], walk: [{ points: rect, y: 1 }], ramps: [], obstacles: [], stations: [] }
    expect(isFallbackDeck(resolveDeckAnchors({ ...SHIPS.sloop.anchors, deck: authored }))).toBe(false)
    expect(eyeFor(authored)).toBe(0.17)
  })
})

describe('look math', () => {
  it('yawToward / lookForward round-trip', () => {
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0], [0.6, -0.8]] as const) {
      const f = lookForward(yawToward(dx, dz), 0)
      expect(f[0]).toBeCloseTo(dx)
      expect(f[2]).toBeCloseTo(dz)
    }
  })

  it('rayToCell hits the enemy board from eye height and misses when looking up', () => {
    const origin: [number, number, number] = [0, 0.72, 6]
    const target = BOARD_LAYOUT.enemy
    const cell = { x: 4, y: 5 }
    const cx = target.origin[0] + cell.x + 0.5
    const cz = target.origin[2] + cell.y + 0.5
    const d = Math.hypot(cx - origin[0], BOARD_LAYOUT.surfaceY - origin[1], cz - origin[2])
    const dir: [number, number, number] = [(cx - origin[0]) / d, (BOARD_LAYOUT.surfaceY - origin[1]) / d, (cz - origin[2]) / d]
    expect(rayToCell(origin, dir, BOARD_LAYOUT.surfaceY, target.origin)).toEqual(cell)
    expect(rayToCell(origin, [0, 0.5, -0.8], BOARD_LAYOUT.surfaceY, target.origin)).toBeNull()
    expect(rayToCell(origin, [0, -0.01, -1], BOARD_LAYOUT.surfaceY, target.origin)).toBeNull()
  })

  it('cycleShip walks the afloat list and wraps', () => {
    const ships = [
      { uid: 'a', hits: [1, 1], spec: { length: 2 } },
      { uid: 'b', hits: [], spec: { length: 3 } },
      { uid: 'c', hits: [1], spec: { length: 3 } },
    ]
    const afloat = afloatUids(ships)
    expect(afloat).toEqual(['b', 'c'])
    expect(cycleShip(afloat, null)).toBe('b')
    expect(cycleShip(afloat, 'b')).toBe('c')
    expect(cycleShip(afloat, 'c')).toBe('b')
    expect(cycleShip(afloat, 'a')).toBe('b')
    expect(cycleShip([], 'a')).toBeNull()
  })
})
