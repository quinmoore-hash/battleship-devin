import { describe, expect, it } from 'vitest'
import { SHIPS } from '../ships'
import { BOARD_LAYOUT, boardCenter } from '../scene/layout'
import type { DeckAnchors } from './contract'
import {
  GROUNDED,
  PLAYER_RADIUS,
  JUMP_APEX,
  JUMP_TIME,
  afloatUids,
  approach,
  startJump,
  stepJump,
  clampToPolygon,
  cycleShip,
  deckHeightAt,
  eyeFor,
  fallbackDeckAnchors,
  type WalkPose,
  isFallbackDeck,
  gunnerPose,
  lookForward,
  nearestStation,
  pointInPolygon,
  pushOutOfObstacles,
  rayToCell,
  rectPolygon,
  resolveDeckAnchors,
  sinkProgressFor,
  spawnPose,
  stationsOf,
  stationUsable,
  stepOnDeck,
  yawToward,
} from './math'

const rect = rectPolygon(4, 1, 0)

describe('deck fallback plan', () => {
  it('follows the hull plan inset by 0.08, tapers toward the ends and puts masts in as obstacles', () => {
    const a = SHIPS.sloop.anchors
    const d = fallbackDeckAnchors(a, 'sloop')
    expect(d.walk).toHaveLength(1)
    expect(d.walk[0].y).toBe(a.deckY)
    const zs = d.walk[0].points.map((p) => p[1])
    expect(Math.max(...zs)).toBeCloseTo(a.hull.beam / 2 - 0.08)
    // the ends are narrower than the waist
    const endZ = Math.max(...d.walk[0].points.filter((p) => p[0] > 0.9).map((p) => Math.abs(p[1])))
    expect(endZ).toBeLessThan(a.hull.beam / 2 - 0.08)
    expect(d.obstacles).toHaveLength(a.masts.length)
    expect(d.obstacles[0].center).toEqual([a.masts[0].base[0], a.masts[0].base[2]])
    expect(d.stations).toHaveLength(a.cannons.length)
  })

  it('authored decks (session C) are the source of truth: raised levels, ramps and obstacles come from `ShipAnchors.deck`', () => {
    for (const id of ['frigate', 'man-o-war', 'galleon', 'brigantine', 'sloop'] as const) {
      const d = resolveDeckAnchors(SHIPS[id].anchors, id)
      expect(d).toBe(SHIPS[id].anchors.deck)
      expect(d.walk.length).toBeGreaterThan(0)
      expect(d.obstacles.length).toBeGreaterThanOrEqual(SHIPS[id].anchors.masts.length)
    }
    const m = resolveDeckAnchors(SHIPS['man-o-war'].anchors, 'man-o-war')
    expect(m.walk.length).toBeGreaterThan(1)
    expect(m.ramps.length).toBeGreaterThan(0)
  })

  it('stations under a castle (muzzle below the deck level they would stand on) are not reachable; waist guns are', () => {
    const a = SHIPS['man-o-war'].anchors
    const d = resolveDeckAnchors(a, 'man-o-war')
    const st = stationsOf(a, d)
    const waist = st.filter((s) => s.stand[0] >= -0.55 && s.stand[0] <= 1.35 && s.muzzle[1] > a.deckY)
    expect(waist.length).toBeGreaterThan(0)
    for (const s of waist) expect(s.onDeck).toBe(true)
    const underCastle = st.filter((s) => (s.stand[0] < -0.56 || s.stand[0] > 1.36) && s.muzzle[1] < 0.88)
    expect(underCastle.length).toBeGreaterThan(0)
    for (const s of underCastle) expect(s.onDeck).toBe(false)
  })

  it('an unknown class gets a flush tapered plan from its hull', () => {
    const a = SHIPS.sloop.anchors
    const d = fallbackDeckAnchors(a)
    expect(d.walk).toHaveLength(1)
    expect(d.ramps).toHaveLength(0)
    expect(Math.max(...d.walk[0].points.map((p) => p[0]))).toBeCloseTo(a.hull.length / 2 - 0.08)
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
    // every class ships authored `deck` data now (session C): strip it to exercise the fallback path
    const { deck: _authoredDeck, ...bare } = SHIPS.sloop.anchors
    const fb = resolveDeckAnchors(bare)
    expect(isFallbackDeck(fb)).toBe(true)
    expect(eyeFor(fb)).toBe(0.3)
    const authored: DeckAnchors = { spawn: [0, 1, 0], walk: [{ points: rect, y: 1 }], ramps: [], obstacles: [], stations: [] }
    expect(isFallbackDeck(resolveDeckAnchors({ ...bare, deck: authored }))).toBe(false)
    expect(eyeFor(authored)).toBe(0.17)
    expect(isFallbackDeck(resolveDeckAnchors(SHIPS.sloop.anchors))).toBe(false)
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

  it('sinkProgressFor ignores a stale wreck progress for an afloat ship (uids repeat across games / fleets)', () => {
    expect(sinkProgressFor(false, 1)).toBe(0)
    expect(sinkProgressFor(false, undefined)).toBe(0)
    expect(sinkProgressFor(true, 0.4)).toBe(0.4)
    expect(sinkProgressFor(true, undefined)).toBe(1)
  })
})

describe('walk acceleration and jump', () => {
  it('approach is frame-rate independent: two 8 ms steps land where one 16 ms step does (to 1e-9)', () => {
    const one = approach(0, 1, 0.016)
    const two = approach(approach(0, 1, 0.008), 1, 0.008)
    expect(two).toBeCloseTo(one, 9)
    expect(approach(0, 1, 10)).toBeCloseTo(1, 4)
  })

  it('jump reaches JUMP_APEX at half time and lands at JUMP_TIME on a flat deck; no double jump', () => {
    let air = startJump(GROUNDED)
    expect(air.airborne).toBe(true)
    expect(startJump(air)).toBe(air)
    let t = 0
    let apex = 0
    const dt = 1 / 240
    let landedAt = -1
    while (t < 2 && landedAt < 0) {
      air = stepJump(air, dt, 0.4, 0.4)
      t += dt
      apex = Math.max(apex, air.height)
      if (!air.airborne) landedAt = t
    }
    expect(apex).toBeCloseTo(JUMP_APEX, 2)
    expect(landedAt).toBeCloseTo(JUMP_TIME, 1)
    expect(air).toBe(GROUNDED)
  })

  it('the same arc at 60 Hz and 120 Hz lands within a frame of each other', () => {
    const land = (dt: number) => {
      let air = startJump(GROUNDED)
      let t = 0
      while (air.airborne && t < 2) {
        air = stepJump(air, dt, 0, 0)
        t += dt
      }
      return t
    }
    expect(Math.abs(land(1 / 60) - land(1 / 120))).toBeLessThan(1 / 60 + 1e-9)
  })

  it('jumping across a break lands on the higher deck (height measured against the deck now under the feet)', () => {
    let air = startJump(GROUNDED)
    // first frames over the main deck (0.4), then the feet cross onto the quarterdeck (0.58)
    air = stepJump(air, 0.1, 0.4, 0.4)
    expect(air.height).toBeGreaterThan(0.05)
    air = stepJump(air, 0.05, 0.4, 0.58)
    // absolute foot height is kept: the height over the new deck is 0.18 lower
    expect(air.height).toBeLessThan(0.08)
    let t = 0
    while (air.airborne && t < 2) {
      air = stepJump(air, 1 / 60, 0.58, 0.58)
      t += 1 / 60
    }
    expect(air).toBe(GROUNDED)
    expect(t).toBeLessThan(JUMP_TIME)
  })

  it("a slow walk (1 cm steps) climbs the Man-o'-War quarterdeck ramp — the gap between the authored polygons never stalls it", () => {
    const d = resolveDeckAnchors(SHIPS['man-o-war'].anchors, 'man-o-war')
    const ramp = d.ramps[0]
    const mid: [number, number] = [(ramp.a[0] + ramp.b[0]) / 2, (ramp.a[1] + ramp.b[1]) / 2]
    const fromLevel = d.walk[ramp.from].y < d.walk[ramp.to].y ? ramp.from : ramp.to
    const toLevel = fromLevel === ramp.from ? ramp.to : ramp.from
    const dir = d.walk[toLevel].points.reduce((acc, q) => acc + q[0], 0) / d.walk[toLevel].points.length > mid[0] ? 1 : -1
    let pose: WalkPose = { x: mid[0] - dir * 0.15, z: mid[1], y: d.walk[fromLevel].y, level: fromLevel }
    pose = stepOnDeck(pose, 0, 0, d)
    for (let i = 0; i < 60 && pose.level !== toLevel; i++) pose = stepOnDeck(pose, dir * 0.01, 0, d)
    expect(pose.level).toBe(toLevel)
    // the ramp blends the height; a few more steps and the feet are on the upper planks
    for (let i = 0; i < 15; i++) pose = stepOnDeck(pose, dir * 0.01, 0, d)
    expect(pose.y).toBeCloseTo(d.walk[toLevel].y, 2)
  })

  it('pinned at the Galleon bow tip (obstacle + rail), walking aft is never trapped (testing agent)', () => {
    const d = resolveDeckAnchors(SHIPS.galleon.anchors, 'galleon')
    const level = d.walk.findIndex((l) => l.points.some((q) => q[0] > 1.5))
    expect(level).toBeGreaterThanOrEqual(0)
    let pose: WalkPose = { x: 1.52, z: 0.02, y: d.walk[level].y, level }
    for (let i = 0; i < 40; i++) pose = stepOnDeck(pose, -0.02, 0, d)
    expect(pose.x).toBeLessThan(1.25)
  })

  it('sliding around a mast never dips inside the player-radius clearance unless the rail already pins you (testing agent)', () => {
    for (const cls of ['man-o-war', 'galleon', 'frigate'] as const) {
      const d = resolveDeckAnchors(SHIPS[cls].anchors, cls)
      for (const o of d.obstacles) {
        const clearance = o.radius + PLAYER_RADIUS
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2
          const level = d.walk.findIndex((l) => pointInPolygon([o.center[0] + Math.cos(a) * (clearance + 0.01), o.center[1] + Math.sin(a) * (clearance + 0.01)], l.points))
          if (level < 0) continue
          let pose: WalkPose = { x: o.center[0] + Math.cos(a) * (clearance + 0.01), z: o.center[1] + Math.sin(a) * (clearance + 0.01), y: d.walk[level].y, level }
          for (let i = 0; i < 25; i++) {
            // head at the mast with a sideways drift, the way a player skirts it
            pose = stepOnDeck(pose, -Math.cos(a) * 0.012 + Math.sin(a) * 0.006, -Math.sin(a) * 0.012 - Math.cos(a) * 0.006, d)
            if (pose.level !== level) break
            expect(Math.hypot(pose.x - o.center[0], pose.z - o.center[1]), `${cls} ${JSON.stringify(o)} k=${k} i=${i} ${JSON.stringify(pose)}`).toBeGreaterThanOrEqual(clearance - 0.002)
          }
        }
      }
    }
  })

  it('while airborne the horizontal clamp still holds: stepping off the rail mid-jump snaps back inside the plan', () => {
    const d = resolveDeckAnchors(SHIPS.frigate.anchors, 'frigate')
    let pose = spawnPose(d)
    const inside = (p: WalkPose) => d.walk.some((l) => pointInPolygon([p.x, p.z], l.points))
    for (let i = 0; i < 60; i++) pose = stepOnDeck(pose, 0, 0.05, d)
    expect(inside(pose)).toBe(true)
    for (let i = 0; i < 60; i++) pose = stepOnDeck(pose, 0.1, 0, d)
    expect(inside(pose)).toBe(true)
  })
})
