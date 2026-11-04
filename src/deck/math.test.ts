import { describe, expect, it } from 'vitest'
import { SHIPS } from '../ships'
import { BOARD_LAYOUT, boardCenter, cellToWorld } from '../scene/layout'
import { shipRotationY, shipWorldTransform } from '../ships'
import { FLEET_BY_ID, type PlacedShip } from '../engine'
import { DECK_FOV, DECK_NEAR, EYE_HEIGHT, type DeckAnchors } from './contract'
import {
  EYE_CLEARANCE,
  FALLBACK_EYE,
  GROUNDED,
  MARKER_FADE_FAR,
  MARKER_FADE_NEAR,
  NO_PICK,
  PICK_MIN_INTERVAL,
  PLAYER_RADIUS,
  STATION_REACH,
  WALK_EYE_MAX,
  WALK_EYE_OVER_RAIL,
  WALK_SPEED,
  glowScaleCap,
  markerFade,
  pickStation,
  spawnPose,
  stationsOf,
  stepOnDeck,
  walkEyeHeight,
  type Station,
  JUMP_APEX,
  JUMP_TIME,
  afloatUids,
  blockedBands,
  clearAhead,
  clearLookYaw,
  SPAWN_CLEAR_AHEAD,
  SPAWN_OPEN_VIEW,
  spawnLookYaw,
  gunnerEyeXZ,
  viewConeBlocked,
  GUN_EYE_BACK,
  GUN_EYE_BEHIND_BREECH,
  GUN_RAY_OVER_RAIL,
  RAIL_INSET,
  railAhead,
  rayToPolygonEdge,
  spawnStand,
  spawnYawFallbacks,
  hitSections,
  inBand,
  sectionAtX,
  sectionX,
  spawnPoseAvoiding,
  withBlocked,
  type WalkableDeck,
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
  GUN_EYE_OVER_RAIL,
  lookForward,
  nearestStation,
  pointInPolygon,
  pushOutOfObstacles,
  rayToCell,
  rectPolygon,
  resolveDeckAnchors,
  sinkProgressFor,
  stationUsable,
  yawToward,
  levelAt,
  angleDelta,
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

  it('gunnerPose on the fallback deck (no authored rail) sights along the barrel from just above the muzzle (outside the planking)', () => {
    const s = stations.find((x) => x.onDeck && x.side === 'port')!
    expect(s.rail).toBeUndefined()
    const pose = gunnerPose(s)
    expect(pose.position[2]).toBeGreaterThan(s.muzzle[2]) // port muzzle is at −z; the eye is a hair inboard of it
    expect(pose.position[2] - s.muzzle[2]).toBeLessThan(0.1)
    expect(pose.position[1]).toBeGreaterThan(s.muzzle[1])
    const f = lookForward(pose.yaw, 0)
    expect(f[2]).toBeLessThan(-0.99)
  })

  it('gunnerPose on the authored deck sights from just inside the planking, above the rail', () => {
    const s = stationsOf(manOWar, resolveDeckAnchors(manOWar)).find((x) => x.onDeck && x.side === 'port')!
    const pose = gunnerPose(s)
    expect(pose.position[2]).toBeCloseTo(s.breech[2] + GUN_EYE_BEHIND_BREECH) // port breech is at −z; the eye stands inboard of it
    expect(pose.position[1]).toBeGreaterThan(s.rail!)
    expect(lookForward(pose.yaw, 0)[2]).toBeLessThan(-0.99)
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

describe('manned gun eye looks out of the boat (BUG-770)', () => {
  const halfFov = (DECK_FOV / 2) * (Math.PI / 180)
  const classes = Object.entries(SHIPS).map(([id, def]) => {
    const a = def.anchors
    return [id, stationsOf(a, resolveDeckAnchors(a))] as const
  })

  it.each(classes)('%s: the eye clears the rail / netting at every on-deck gun, just inside the planking, and the forward ray clears the hull', (_id, sts) => {
    const onDeck = sts.filter((s) => s.onDeck)
    expect(onDeck.length).toBeGreaterThan(0)
    for (const s of onDeck) {
      expect(s.rail, `station ${s.index} has an authored rail top`).toBeDefined()
      const rail = s.rail!
      const p = gunnerPose(s)
      const h = Math.hypot(s.direction[0], s.direction[2])
      const fx = s.direction[0] / h
      const fz = s.direction[2] / h
      const along = (v: readonly number[]) => v[0] * fx + v[2] * fz
      // above whatever the gunner must see over
      expect(p.position[1], `station ${s.index} eye over rail`).toBeGreaterThanOrEqual(rail + GUN_EYE_OVER_RAIL - 1e-9)
      // inboard: GUN_EYE_BEHIND_BREECH behind the breech (BUG-800), well behind the muzzle
      expect(along(s.breech) - along(p.position)).toBeCloseTo(GUN_EYE_BEHIND_BREECH)
      expect(along(s.muzzle) - along(p.position)).toBeGreaterThan(GUN_EYE_BACK)
      // the forward ray is still above the rail where it crosses the bulwark (the muzzle plane): it clears the hull
      const look = lookForward(p.yaw, p.pitch)
      const flat = Math.hypot(look[0], look[2])
      expect(p.position[1] + (look[1] / flat) * GUN_EYE_BACK, `station ${s.index} forward ray over the rail`).toBeGreaterThan(rail)
      // looking along the barrel, slightly down, horizon inside the view
      expect(look[0] * fx + look[2] * fz).toBeGreaterThan(0.99 * flat)
      expect(p.pitch).toBeLessThan(0)
      expect(p.pitch).toBeGreaterThan(-halfFov + 0.1)
    }
  })

  it('the old muzzle-relative eye (0.11 over the bore) sat below the rail / in the netting on every class but the sloop', () => {
    const blocked = classes.filter(([, sts]) => sts.some((s) => s.onDeck && s.muzzle[1] + 0.11 < s.rail! + 0.04)).map(([id]) => id)
    expect(blocked.sort()).toEqual(['brigantine', 'frigate', 'galleon', 'man-o-war'])
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
            // where the ring reaches past the rail the deck is narrower than the clearance: the player may squeeze by
            if (!pointInPolygon(pushOutOfObstacles([pose.x, pose.z], [o]), d.walk[level].points)) break
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

describe('station pick hysteresis + marker fade (BUG-7xx)', () => {
  const st = (index: number, x: number, z: number, onDeck = true): Station => ({ index, cell: 0, side: 'port', muzzle: [x, 0, z - 0.1], direction: [0, 0, -1], stand: [x, 0, z], yaw: 0, breech: [x, 0, z - 0.05], onDeck })
  const two = [st(0, 0, 0), st(1, 0.2, 0)]
  it('between two equidistant stands the pick stays put (the hot marker used to flip every frame)', () => {
    let p = pickStation(two, 0.0, 0, NO_PICK, 0)
    expect(p.index).toBe(0)
    // walk to the midpoint and a hair past it, frame by frame: still station 0
    for (let i = 1; i <= 20; i++) p = pickStation(two, 0.09 + i * 0.001, 0, p, i / 60)
    expect(p.index).toBe(0)
    // jitter around the midpoint at 60 Hz: never flips
    for (let i = 0; i < 120; i++) p = pickStation(two, 0.1 + (i % 2 ? 0.01 : -0.01), 0, p, 1 + i / 60)
    expect(p.index).toBe(0)
  })
  it('switches once the other stand is clearly closer (15 % / 0.05 u) and never more than 4 times a second', () => {
    let p = pickStation(two, 0.0, 0, NO_PICK, 0)
    p = pickStation(two, 0.14, 0, p, 1) // 0.14 vs 0.06: 0.06 < 0.14 - 0.05 → switch
    expect(p).toEqual({ index: 1, since: 1 })
    p = pickStation(two, 0.05, 0, p, 1.1) // clearly station 0 again, but only 0.1 s later
    expect(p.index).toBe(1)
    p = pickStation(two, 0.05, 0, p, 1.25)
    expect(p).toEqual({ index: 0, since: 1.25 })
    expect(PICK_MIN_INTERVAL).toBe(0.25)
  })
  it('leaving is sticky too: the pick is held until `reach` + 0.03 and dropped at most 4×/s; a fresh pick is immediate', () => {
    let p = pickStation(two, 0, 0, NO_PICK, 0)
    p = pickStation(two, 0, STATION_REACH + 0.02, p, 1)
    expect(p.index).toBe(0)
    p = pickStation(two, 0, STATION_REACH + 0.04, p, 1.1)
    expect(p).toEqual({ index: -1, since: 1.1 }) // beyond the margin: dropped
    p = pickStation(two, 0, 0, p, 1.2)
    expect(p.index).toBe(-1) // back within reach 0.1 s later: not yet (4×/s)
    p = pickStation(two, 0, 0, p, 1.35)
    expect(p).toEqual({ index: 0, since: 1.35 })
    expect(pickStation(two, 0.2, 0, NO_PICK, 0)).toEqual({ index: 1, since: 0 }) // a fresh pick is immediate
    // below-deck guns are never picked, and a stale pick of one is dropped
    expect(pickStation([st(0, 0, 0, false)], 0, 0, NO_PICK, 0).index).toBe(-1)
    expect(pickStation([st(0, 0, 0, false)], 0, 0, { index: 0, since: -1 }, 0).index).toBe(-1)
  })
  it('the real decks: walking the length of every ship at 60 Hz changes the pick at most 4 times a second', () => {
    for (const id of Object.keys(SHIPS) as (keyof typeof SHIPS)[]) {
      const a = SHIPS[id].anchors
      const deck = resolveDeckAnchors(a, id)
      const stations = stationsOf(a, deck)
      const level = deck.walk[0]
      const xs = level.points.map((p) => p[0])
      const z = Math.max(...level.points.map((p) => Math.abs(p[1]))) * 0.7
      let p = NO_PICK
      const changes: number[] = []
      let pose: WalkPose = stepOnDeck({ x: Math.min(...xs) + 0.05, z, y: level.y, level: 0 }, 0, 0, deck)
      for (let f = 0; f < 600; f++) {
        pose = stepOnDeck(pose, (WALK_SPEED * 0.6) / 60, 0, deck)
        const next = pickStation(stations, pose.x, pose.z, p, f / 60)
        if (next.index !== p.index) changes.push(f / 60)
        p = next
      }
      for (let i = 1; i < changes.length; i++) expect(changes[i] - changes[i - 1], `${id}: pick changes too fast`).toBeGreaterThanOrEqual(PICK_MIN_INTERVAL - 1e-9)
    }
  })
  it('markerFade: 1 beyond 0.6 u, 0 inside 0.25 u, smooth and monotonic between', () => {
    expect(markerFade(1)).toBe(1)
    expect(markerFade(MARKER_FADE_FAR)).toBe(1)
    expect(markerFade(MARKER_FADE_NEAR)).toBe(0)
    expect(markerFade(0.1)).toBe(0)
    expect(markerFade(0.425)).toBeCloseTo(0.5, 6)
    let last = 0
    for (let d = 0.25; d <= 0.6; d += 0.01) {
      const f = markerFade(d)
      expect(f).toBeGreaterThanOrEqual(last)
      last = f
    }
  })
  it('glowScaleCap keeps the glow under 3° of view: 1.45× at 1 u, 0.73× at 0.5 u, 0 at the eye', () => {
    expect(glowScaleCap(1)).toBeCloseTo(1.455, 2)
    expect(glowScaleCap(0.5)).toBeCloseTo(0.727, 2)
    expect(glowScaleCap(0)).toBe(0)
    // the hot pulse peaks at 1.65×: capped from 1.13 u inward
    expect(glowScaleCap(1.13)).toBeLessThan(1.65)
    expect(glowScaleCap(1.14)).toBeGreaterThan(1.65)
  })
})

describe('eye outside the geometry (BUG-7xx, owner clips a + b)', () => {
  it('the walking eye sees over the lowest reachable cap rail on every class (0.17 u was under the bulwark on three of five)', () => {
    const want: Record<string, number> = { 'man-o-war': 0.31, galleon: 0.31, frigate: 0.275, brigantine: 0.183, sloop: 0.18 }
    for (const id of Object.keys(SHIPS) as (keyof typeof SHIPS)[]) {
      const a = SHIPS[id].anchors
      const deck = resolveDeckAnchors(a, id)
      const stations = stationsOf(a, deck)
      const eye = walkEyeHeight(deck, stations)
      expect(eye, id).toBeGreaterThanOrEqual(EYE_HEIGHT)
      expect(eye, id).toBeLessThanOrEqual(WALK_EYE_MAX)
      expect(eye, id).toBeCloseTo(want[id], 2)
      // the lowest rail of the main deck (level 0) is cleared; a higher castle gun's rail (man-o'-war 0.40) is not chased
      const lowest = Math.min(...stations.filter((s) => s.onDeck && s.rail !== undefined && Math.abs(s.stand[1] - deck.walk[0].y) < 1e-3).map((s) => s.rail! - s.stand[1]))
      expect(eye - lowest, id).toBeGreaterThanOrEqual(WALK_EYE_OVER_RAIL - 1e-9)
    }
    // no authored rails → the deck's own eye height (contract 0.17; the marked fallback rectangle keeps its 0.3)
    expect(walkEyeHeight(fallbackDeckAnchors(SHIPS.sloop.anchors), [])).toBe(EYE_HEIGHT)
    const fallback = resolveDeckAnchors({ ...SHIPS.sloop.anchors, deck: undefined }, 'sloop')
    expect(isFallbackDeck(fallback) ? walkEyeHeight(fallback, []) : FALLBACK_EYE).toBe(FALLBACK_EYE)
  })
  it('after spawn (either side, as the controller mirrors it) and after any step the feet keep PLAYER_RADIUS from every obstacle and stay inside the plan — on every class', () => {
    expect(PLAYER_RADIUS).toBeGreaterThanOrEqual(DECK_NEAR + EYE_CLEARANCE)
    for (const id of Object.keys(SHIPS) as (keyof typeof SHIPS)[]) {
      const a = SHIPS[id].anchors
      const deck = resolveDeckAnchors(a, id)
      for (const side of [1, -1]) {
        const p0 = spawnPose(deck)
        const p = stepOnDeck({ ...p0, z: side * Math.abs(p0.z) }, 0, 0, deck)
        expect(pointInPolygon([p.x, p.z], deck.walk[p.level].points), `${id} spawn side ${side} inside the plan`).toBe(true)
        for (const o of deck.obstacles) expect(Math.hypot(p.x - o.center[0], p.z - o.center[1]), `${id} spawn side ${side} clear of obstacle at ${o.center}`).toBeGreaterThanOrEqual(o.radius + PLAYER_RADIUS - 1e-6)
        // walk a figure-eight across the deck: never inside an obstacle unless the rail already pins you there
        let q = p
        for (let f = 0; f < 400; f++) {
          const ang = f * 0.11
          q = stepOnDeck(q, Math.cos(ang) * 0.02, Math.sin(ang * 0.5) * 0.02, deck)
          expect(pointInPolygon([q.x, q.z], deck.walk[q.level].points), `${id} step ${f} inside the plan`).toBe(true)
        }
      }
    }
  })
})

describe('damage-aware spawn and no-walk bands (BUG-7xx: Tab onto a burning ship)', () => {
  const ids = Object.keys(SHIPS) as (keyof typeof SHIPS)[]
  /** Every 1–2 hit-section combination that leaves the ship afloat (all sections hit = sunk, never boarded). */
  const combos = (n: number): number[][] => {
    const out: number[][] = []
    for (let i = 0; i < n; i++) {
      out.push([i])
      for (let j = i + 1; j < n; j++) if (n > 2) out.push([i, j])
    }
    return out
  }
  const inObstacle = (d: DeckAnchors, p: WalkPose) => d.obstacles.some((o) => Math.hypot(p.x - o.center[0], p.z - o.center[1]) < o.radius + PLAYER_RADIUS - 1e-6)
  const placed = (id: string, orientation: PlacedShip['orientation'], hitIdx: number[]): PlacedShip => {
    const spec = FLEET_BY_ID[id]
    const cells = Array.from({ length: spec.length }, (_, i) => (orientation === 'horizontal' ? { x: 2 + i, y: 4 } : { x: 4, y: 2 + i }))
    return { spec, uid: id, origin: cells[0], orientation, cells, hits: hitIdx.map((i) => cells[i]) }
  }

  it('sectionX is where the ship transform puts the cell: the origin cell is the stern (−x), both orientations', () => {
    for (const orientation of ['horizontal', 'vertical'] as const) {
      const ship = placed('galleon', orientation, [])
      const { position, rotationY } = shipWorldTransform(ship)
      expect(rotationY).toBe(shipRotationY(orientation))
      ship.cells.forEach((c, i) => {
        const w = cellToWorld(c, BOARD_LAYOUT.player.origin)
        const dx = w[0] - position[0]
        const dz = w[2] - position[2]
        // world → ship space (inverse rotation about y)
        const localX = dx * Math.cos(rotationY) - dz * Math.sin(rotationY)
        expect(localX).toBeCloseTo(sectionX(i, ship.cells.length), 6)
        expect(sectionAtX(localX, ship.cells.length)).toBe(i)
      })
    }
  })

  it('hitSections / blockedBands: one hull-cell band per hit, in cell order', () => {
    const ship = placed('frigate', 'horizontal', [2, 0])
    expect(hitSections(ship)).toEqual([0, 2])
    expect(blockedBands([0, 2], 3)).toEqual([
      { x0: -1.5, x1: -0.5 },
      { x0: 0.5, x1: 1.5 },
    ])
    expect(blockedBands([], 3)).toEqual([])
    expect(inBand(-0.5 + PLAYER_RADIUS, { x0: -1.5, x1: -0.5 })).toBe(false)
    expect(inBand(-0.5 + PLAYER_RADIUS / 2, { x0: -1.5, x1: -0.5 })).toBe(true)
  })

  it('withBlocked keeps the deck identity when nothing is hit (fallback-deck flag survives either way)', () => {
    const d = resolveDeckAnchors(SHIPS.frigate.anchors, 'frigate')
    expect(withBlocked(d, [])).toBe(d)
    const fb = resolveDeckAnchors({ ...SHIPS.frigate.anchors, deck: undefined })
    expect(isFallbackDeck(withBlocked(fb, blockedBands([0], 3)))).toBe(true)
    expect(isFallbackDeck(withBlocked(d, blockedBands([0], 3)))).toBe(false)
  })

  it('every ship, every 1–2 hit sections: the spawn is on an intact section, on the deck, outside every obstacle', () => {
    for (const id of ids) {
      const n = FLEET_BY_ID[id].length
      const deck = resolveDeckAnchors(SHIPS[id].anchors, id)
      for (const hit of combos(n)) {
        const d = withBlocked(deck, blockedBands(hit, n))
        const p = spawnPoseAvoiding(d, hit, n)
        const label = `${id} hit ${hit.join(',')}`
        expect(hit, label).not.toContain(sectionAtX(p.x, n))
        expect(d.blocked!.some((b) => inBand(p.x, b)), label).toBe(false)
        expect(pointInPolygon([p.x, p.z], d.walk[p.level].points), label).toBe(true)
        expect(inObstacle(d, p), label).toBe(false)
        // the authored spawn itself was the problem on these decks: it sits on the stern section
        if (hit.includes(sectionAtX(deck.spawn[0], n))) expect(sectionAtX(p.x, n), label).not.toBe(sectionAtX(deck.spawn[0], n))
      }
    }
  })

  it('picks the intact section farthest from the fire, and the authored spawn when it is intact', () => {
    const frigate = resolveDeckAnchors(SHIPS.frigate.anchors, 'frigate')
    expect(sectionAtX(spawnPoseAvoiding(frigate, [0, 1], 3).x, 3)).toBe(2)
    expect(sectionAtX(spawnPoseAvoiding(frigate, [1, 2], 3).x, 3)).toBe(0)
    const mow = resolveDeckAnchors(SHIPS['man-o-war'].anchors, 'man-o-war')
    expect(sectionAtX(spawnPoseAvoiding(mow, [0], 5).x, 5)).toBe(4)
    expect(sectionAtX(spawnPoseAvoiding(mow, [4], 5).x, 5)).toBe(0)
    // nothing hit → exactly the old spawn
    for (const id of ids) {
      const d = resolveDeckAnchors(SHIPS[id].anchors, id)
      expect(spawnPoseAvoiding(d, [], FLEET_BY_ID[id].length)).toEqual(spawnPose(d))
    }
  })

  it('the controller mirror step (same z side as the enemy) stays off the hit section', () => {
    for (const id of ids) {
      const n = FLEET_BY_ID[id].length
      const deck = resolveDeckAnchors(SHIPS[id].anchors, id)
      for (const hit of combos(n)) {
        const d = withBlocked(deck, blockedBands(hit, n))
        const p = spawnPoseAvoiding(d, hit, n)
        for (const side of [1, -1]) {
          const q = stepOnDeck({ ...p, z: side * Math.abs(p.z) }, 0, 0, d)
          expect(hit, `${id} hit ${hit.join(',')} side ${side}`).not.toContain(sectionAtX(q.x, n))
          expect(inObstacle(d, q)).toBe(false)
        }
      }
    }
  })

  describe('stepOnDeck with blocked bands', () => {
    // a 4-section rectangular deck (x ∈ [-2, 2]), section 2 (x ∈ [0, 1]) hit
    const d: WalkableDeck = withBlocked({ spawn: [-1, 0, 0], walk: [{ points: rect, y: 0 }], ramps: [], obstacles: [], stations: [] }, blockedBands([2], 4))
    expect(d.blocked).toEqual([{ x0: 0, x1: 1 }])
    const at = (x: number, z = 0): WalkPose => ({ x, z, y: 0, level: 0 })

    it('a walk toward the breach stops at its edge and never enters it', () => {
      let p = at(-0.5)
      for (let i = 0; i < 40; i++) p = stepOnDeck(p, 0.05, 0, d)
      expect(p.x).toBeCloseTo(-PLAYER_RADIUS, 6)
      expect(inBand(p.x, d.blocked![0])).toBe(false)
      // and from the bow side it stops on the far edge
      p = at(1.9)
      for (let i = 0; i < 40; i++) p = stepOnDeck(p, -0.05, 0, d)
      expect(p.x).toBeCloseTo(1 + PLAYER_RADIUS, 6)
    })

    it('sliding along the breach edge (z) is free', () => {
      const p = stepOnDeck(at(-PLAYER_RADIUS, 0), 0, 0.1, d)
      expect(p.z).toBeCloseTo(0.1, 6)
      expect(p.x).toBeCloseTo(-PLAYER_RADIUS, 6)
    })

    it('a player standing where the ball struck is pushed out, not pinned', () => {
      const p = stepOnDeck(at(0.7), 0.02, 0, d)
      expect(inBand(p.x, d.blocked![0])).toBe(false)
      expect(p.x).toBeCloseTo(1 + PLAYER_RADIUS, 6)
      const q = stepOnDeck(at(0.3), -0.02, 0, d)
      expect(q.x).toBeCloseTo(-PLAYER_RADIUS, 6)
    })

    it('a level the breach swallows whole never traps a player already on it (they keep walking)', () => {
      const dd: WalkableDeck = withBlocked({ spawn: [-1, 0, 0], walk: [{ points: rectPolygon(1, 1, 0), y: 0 }], ramps: [], obstacles: [], stations: [] }, [{ x0: -1, x1: 1 }])
      expect(stepOnDeck(at(-0.4), 0.1, 0, dd).x).toBeCloseTo(-0.3, 6)
      expect(stepOnDeck(at(0.1), 0.1, 0, dd).x).toBeCloseTo(0.2, 6)
    })

    it('spawnPose itself lands clear of the bands', () => {
      const p = spawnPose(withBlocked({ spawn: [0.5, 0, 0], walk: [{ points: rect, y: 0 }], ramps: [], obstacles: [], stations: [] }, blockedBands([2], 4)))
      expect(inBand(p.x, { x0: 0, x1: 1 })).toBe(false)
    })
  })
})

describe('spawn facing is clear of obstacles (vertical man-o-war looked into the mizzen)', () => {
  const ids = Object.keys(SHIPS) as (keyof typeof SHIPS)[]
  const foe = boardCenter(BOARD_LAYOUT.enemy)
  /** What `spawn()` in DeckController does for a whole ship placed `orientation` on the player board. */
  const controllerSpawn = (id: keyof typeof SHIPS, orientation: PlacedShip['orientation']) => {
    const n = FLEET_BY_ID[id].length
    const cells = Array.from({ length: n }, (_, i) => (orientation === 'horizontal' ? { x: 2 + i, y: 4 } : { x: 4, y: 2 + i }))
    const ship: PlacedShip = { spec: FLEET_BY_ID[id], uid: id, origin: cells[0], orientation, cells, hits: [] }
    const deck = resolveDeckAnchors(SHIPS[id].anchors, id)
    const { rotationY, position } = shipWorldTransform(ship)
    const localYaw = Math.atan2(-(foe[0] - position[0]), -(foe[2] - position[2])) - rotationY
    let p = spawnPoseAvoiding(deck, [], n)
    const side: 1 | -1 = lookForward(localYaw, 0)[2] >= 0 ? 1 : -1
    p = spawnStand(deck, p, side, localYaw)
    return { deck, p, localYaw, side, yaw: spawnLookYaw(deck, p, localYaw, side) }
  }

  it('clearAhead: ray–circle distance, player radius wide', () => {
    const d: DeckAnchors = { spawn: [0, 0, 0], walk: [{ points: rect, y: 0 }], ramps: [], obstacles: [{ center: [0.5, 0], radius: 0.1 }], stations: [] }
    expect(clearAhead(d, [0, 0], yawToward(1, 0))).toBeCloseTo(0.5 - 0.1 - PLAYER_RADIUS, 6) // looking +x into it
    expect(clearAhead(d, [0, 0], yawToward(-1, 0))).toBe(SPAWN_CLEAR_AHEAD) // away from it
    expect(clearAhead(d, [0, 0], yawToward(0, 1))).toBe(SPAWN_CLEAR_AHEAD) // across
    expect(clearAhead(d, [0.45, 0], yawToward(1, 0))).toBe(0) // standing inside it, looking into it
    expect(clearAhead(d, [0.5 - 0.1 - PLAYER_RADIUS, 0], yawToward(-1, 0))).toBe(SPAWN_CLEAR_AHEAD) // on its clearance ring, looking away
    expect(clearAhead(d, [0, 0], yawToward(1, 0), 0.3)).toBe(0.3) // shorter reach: clear
  })

  it('clearAhead: the front of a higher level is a wall, a break down to a lower deck or a rail is not', () => {
    const quarter = rectPolygon(1, 1, 0).map(([x, z]): [number, number] => [x + 0.5, z]) // x ∈ [0, 1]
    const waist = rectPolygon(1, 1, 0).map(([x, z]): [number, number] => [x - 0.5, z]) // x ∈ [-1, 0]
    const d: DeckAnchors = { spawn: [0, 0, 0], walk: [{ points: waist, y: 0 }, { points: quarter, y: 0.1 }], ramps: [], obstacles: [], stations: [] }
    expect(clearAhead(d, [-0.3, 0], yawToward(1, 0), undefined, undefined, 0)).toBeCloseTo(0.3, 9) // waist → quarterdeck front: wall
    expect(clearAhead(d, [0.3, 0], yawToward(-1, 0), undefined, undefined, 1)).toBe(SPAWN_CLEAR_AHEAD) // quarterdeck → down to the waist: clear
    expect(clearAhead(d, [-0.3, 0], yawToward(-1, 0), undefined, undefined, 0)).toBe(SPAWN_CLEAR_AHEAD) // over the stern rail: clear
    expect(clearAhead(d, [-0.3, 0.3], yawToward(0, 1), undefined, undefined, 0)).toBe(SPAWN_CLEAR_AHEAD) // over the beam rail: clear
  })

  it('clearLookYaw keeps the enemy facing when clear, else the first clear fallback, else the farthest view', () => {
    const d: DeckAnchors = { spawn: [0, 0, 0], walk: [{ points: rect, y: 0 }], ramps: [], obstacles: [{ center: [0.3, 0], radius: 0.1 }], stations: [] }
    const ahead = yawToward(1, 0)
    expect(clearLookYaw(d, [0, 0], yawToward(0, 1), spawnYawFallbacks(1))).toBe(yawToward(0, 1))
    expect(clearLookYaw(d, [0, 0], ahead, spawnYawFallbacks(-1))).toBe(yawToward(0, -1))
    const boxed: DeckAnchors = { ...d, obstacles: [{ center: [0.3, 0], radius: 0.1 }, { center: [0, 0.2], radius: 0.1 }, { center: [0, -0.4], radius: 0.1 }, { center: [-0.5, 0], radius: 0.1 }] }
    const pick = clearLookYaw(boxed, [0, 0], ahead, spawnYawFallbacks(1))
    const seen = clearAhead(boxed, [0, 0], pick)
    for (const y of [ahead, ...spawnYawFallbacks(1)]) expect(seen).toBeGreaterThanOrEqual(clearAhead(boxed, [0, 0], y))
    expect(seen).toBeGreaterThan(clearAhead(boxed, [0, 0], yawToward(-1, 0))) // the sweep found a better diagonal
  })

  it('every class, horizontal and vertical: the spawn view is open for SPAWN_OPEN_VIEW (or as open as the deck allows)', () => {
    for (const id of ids) {
      for (const orientation of ['horizontal', 'vertical'] as const) {
        const { deck, p, localYaw, side, yaw } = controllerSpawn(id, orientation)
        const label = `${id} ${orientation}`
        const d = clearAhead(deck, [p.x, p.z], yaw, SPAWN_OPEN_VIEW, undefined, p.level)
        const alternatives = [localYaw, ...spawnYawFallbacks(side), ...Array.from({ length: 16 }, (_, i) => localYaw + (i * Math.PI) / 8)].map((y) => clearAhead(deck, [p.x, p.z], y, SPAWN_OPEN_VIEW, undefined, p.level))
        expect(d, label).toBeGreaterThanOrEqual(Math.min(SPAWN_OPEN_VIEW, Math.max(...alternatives)) - 1e-9)
        expect(d, label).toBeGreaterThanOrEqual(SPAWN_CLEAR_AHEAD)
      }
    }
  })

  it('vertical man-o-war (BUG-799): the spawn faces the enemy beam over the rail, not the mainmast 0.7 u ahead; horizontal keeps the enemy facing', () => {
    const v = controllerSpawn('man-o-war', 'vertical')
    const bow = yawToward(1, 0)
    expect(Math.abs(Math.sin(v.yaw - bow))).toBeGreaterThan(0.9) // not along the deck
    expect(clearAhead(v.deck, [v.p.x, v.p.z], v.yaw, SPAWN_OPEN_VIEW, undefined, v.p.level)).toBe(SPAWN_OPEN_VIEW)
    expect(lookForward(v.yaw, 0)[2] * v.side).toBeGreaterThan(0.9) // toward the enemy's side of the deck
    const h = controllerSpawn('man-o-war', 'horizontal')
    expect(Math.abs(angleDelta(h.yaw, h.localYaw))).toBeLessThan(0.1) // the enemy beam (openView) ≈ the enemy bearing
    expect(clearAhead(h.deck, [h.p.x, h.p.z], h.yaw, SPAWN_OPEN_VIEW, undefined, h.p.level)).toBe(SPAWN_OPEN_VIEW)
  })

  it('rayToPolygonEdge: distance to the rail along a direction', () => {
    expect(rayToPolygonEdge([0, 0], [0, 1], rect)).toBeCloseTo(0.5, 9)
    expect(rayToPolygonEdge([0, 0.3], [0, -1], rect)).toBeCloseTo(0.8, 9)
    expect(rayToPolygonEdge([1, 0], [1, 0], rect)).toBeCloseTo(1, 9)
    expect(rayToPolygonEdge([0, 0.5], [0, 1], rect)).toBeCloseTo(0, 9)
    expect(rayToPolygonEdge([0, 0], [1, 0], [[-1, -1], [-1, 1]])).toBe(Infinity)
  })

  it('spawnStand keeps RAIL_INSET of deck before the facing rail, or the centreline on a narrow deck', () => {
    const d: DeckAnchors = { spawn: [0, 0, -0.45], walk: [{ points: rect, y: 0 }], ramps: [], obstacles: [], stations: [] }
    const toEnemy = yawToward(0, 1)
    const p = spawnStand(d, { x: 0, z: -0.45, y: 0, level: 0 }, 1, toEnemy)
    expect(p.z).toBeCloseTo(0.5 - RAIL_INSET - PLAYER_RADIUS, 9)
    expect(p.x).toBe(0)
    expect(railAhead(d, [p.x, p.z], 0, toEnemy)).toBeCloseTo(RAIL_INSET + PLAYER_RADIUS, 9)
    // a spawn away from the rail walks to it (the view over the rail is the point; the e2e runs along it)
    expect(spawnStand(d, { x: 0.2, z: -0.1, y: 0, level: 0 }, -1, yawToward(0, -1)).z).toBeCloseTo(-(0.5 - RAIL_INSET - PLAYER_RADIUS), 9)
    const narrow: DeckAnchors = { ...d, walk: [{ points: rectPolygon(4, 0.2, 0), y: 0 }] }
    expect(spawnStand(narrow, { x: 0, z: -0.09, y: 0, level: 0 }, 1, toEnemy).z).toBeCloseTo(0, 9)
    // boxed in at the spawn: backs off along the deck to the nearest stand with a clear view
    const trunk: DeckAnchors = { ...d, obstacles: [{ center: [0, 0.3], radius: 0.1 }, { center: [0.2, 0.2], radius: 0.1 }, { center: [-0.2, 0.2], radius: 0.1 }] }
    const off = spawnStand(trunk, { x: 0, z: -0.45, y: 0, level: 0 }, 1, toEnemy)
    expect(Math.abs(off.x)).toBeGreaterThan(0.1)
    expect(clearAhead(trunk, [off.x, off.z], clearLookYaw(trunk, [off.x, off.z], toEnemy, spawnYawFallbacks(1)))).toBe(SPAWN_CLEAR_AHEAD)
  })

  it('every class, horizontal and vertical: the spawn stand has ≥ RAIL_INSET of deck ahead before the rail', () => {
    for (const id of ids) {
      for (const orientation of ['horizontal', 'vertical'] as const) {
        const { deck, p, side, yaw } = controllerSpawn(id, orientation)
        const label = `${id} ${orientation}`
        expect(pointInPolygon([p.x, p.z], deck.walk[p.level].points), label).toBe(true)
        // the beam-wise inset the stand guarantees — unless a centreline fixture (the frigate's wheel) leaves no room:
        // then it stands as far from the rail as the fixture allows
        const toRail = rayToPolygonEdge([p.x, p.z], [0, side], deck.walk[p.level].points)
        const closer: [number, number] = [p.x, p.z - side * 0.02]
        const fixtureBehind = deck.obstacles.some((o) => Math.hypot(closer[0] - o.center[0], closer[1] - o.center[1]) < o.radius + PLAYER_RADIUS)
        expect(toRail >= RAIL_INSET + PLAYER_RADIUS - 1e-6 || fixtureBehind, `${label}: ${toRail.toFixed(3)} to the rail`).toBe(true)
        expect(toRail, label).toBeGreaterThan(0.1)
        // and along the look: either ≥ RAIL_INSET of deck before the edge, or that edge is a deck break (another level continues)
        const ahead = railAhead(deck, [p.x, p.z], p.level, yaw)
        if (ahead < RAIL_INSET) {
          const f = lookForward(yaw, 0)
          const len = Math.hypot(f[0], f[2])
          // (the authored levels leave a gap at a break: probe a little past the edge, or accept a ramp end nearby)
          const hit: [number, number] = [p.x + (f[0] / len) * ahead, p.z + (f[2] / len) * ahead]
          const beyond = [0.03, 0.08, 0.15].map((d): [number, number] => [hit[0] + (f[0] / len) * d, hit[1] + (f[2] / len) * d])
          const otherLevel = beyond.some((b) => deck.walk.some((w, i) => i !== p.level && pointInPolygon(b, w.points)))
          const rampNear = deck.ramps.some((r) => Math.min(Math.hypot(hit[0] - r.a[0], hit[1] - r.a[1]), Math.hypot(hit[0] - r.b[0], hit[1] - r.b[1])) < 0.3)
          expect(otherLevel || rampNear, `${label}: edge ${ahead.toFixed(3)} ahead is a rail`).toBe(true)
        }
      }
    }
  })

  it('the vertical man-o-war no longer stares into the mizzen', () => {
    const v = controllerSpawn('man-o-war', 'vertical')
    expect(clearAhead(v.deck, [v.p.x, v.p.z], v.yaw)).toBe(SPAWN_CLEAR_AHEAD)
    const h = controllerSpawn('man-o-war', 'horizontal')
    expect(Math.abs(angleDelta(h.yaw, h.localYaw))).toBeLessThan(0.1) // the enemy beam (openView) ≈ the enemy bearing
  })
})

const DECK_FOV_RAD = (DECK_FOV * Math.PI) / 180

describe('manned eye stays inboard with the barrel in frame (BUG-800)', () => {
  it('every on-deck station of every class: eye GUN_EYE_BEHIND_BREECH behind the breech on the barrel axis, inside the bulwark, muzzle in the lower half of the frame', () => {
    for (const id of Object.keys(SHIPS) as (keyof typeof SHIPS)[]) {
      const a = SHIPS[id].anchors
      const deck = resolveDeckAnchors(a, id)
      for (const s of stationsOf(a, deck)) {
        if (!s.onDeck) continue
        const label = `${id} station ${s.index}`
        const h = Math.hypot(s.direction[0], s.direction[2]) || 1
        const f: [number, number] = [s.direction[0] / h, s.direction[2] / h]
        const along = (x: number, z: number) => x * f[0] + z * f[1]
        const { position, pitch, yaw } = gunnerPose(s)
        const [ex, ez] = gunnerEyeXZ(s)
        expect(position[0], label).toBeCloseTo(ex, 9)
        expect(position[2], label).toBeCloseTo(ez, 9)
        expect(along(ex, ez), label).toBeCloseTo(along(s.breech[0], s.breech[2]) - GUN_EYE_BEHIND_BREECH, 9)
        expect(along(ex, ez), label).toBeLessThan(along(s.muzzle[0], s.muzzle[2]) - GUN_EYE_BACK)
        // inside the bulwark: behind the deck's walkable edge along the barrel, and inside the hull's beam
        const level = Math.max(0, levelAt([s.stand[0], s.stand[2]], deck))
        const toEdge = rayToPolygonEdge([ex, ez], f, deck.walk[level].points)
        expect(toEdge, label).toBeGreaterThan(0)
        expect(Math.abs(ez), label).toBeLessThan(a.hull.beam / 2)
        // the view centre clears the rail where it crosses the bulwark; the breech / carriage is below the centre (lower frame)
        if (s.rail !== undefined) {
          const dist = Math.hypot(s.muzzle[0] - ex, s.muzzle[2] - ez)
          expect(position[1] + Math.tan(pitch) * dist, label).toBeGreaterThanOrEqual(s.rail + GUN_RAY_OVER_RAIL - 1e-9)
        }
        const toBreech = Math.atan2(s.breech[1] - position[1], Math.hypot(s.breech[0] - ex, s.breech[2] - ez))
        expect(pitch - toBreech, label).toBeGreaterThan(0)
        expect(pitch, label).toBeLessThanOrEqual(-0.02)
        expect(pitch, label).toBeGreaterThan(-DECK_FOV_RAD / 2)
        expect(Math.abs(angleDelta(yaw, yawToward(f[0], f[1]))), label).toBeLessThan(1e-9)
      }
    }
  })
})

describe('manned view cone (owner): no own-ship obstacle within 1.0 u in the ±25° cone around the view centre, horizon in the middle third', () => {
  it('every on-deck station of every class', () => {
    const CONE = (25 * Math.PI) / 180
    for (const id of Object.keys(SHIPS) as (keyof typeof SHIPS)[]) {
      const a = SHIPS[id].anchors
      const deck = resolveDeckAnchors(a, id)
      for (const s of stationsOf(a, deck)) {
        if (!s.onDeck) continue
        const label = `${id} station ${s.index}`
        const { position, yaw, pitch } = gunnerPose(s, deck.obstacles, deck.viewObstacles)
        // breast / pin rails (view obstacles) stay out of the cone; the man-o'-war's waist end guns sit beside the castle breast rails
        expect(viewConeBlocked(deck.viewObstacles ?? [], position, yaw, pitch), label).toBe(false)
        if (id === 'man-o-war') expect(deck.viewObstacles?.length, label).toBe(3)
        // horizon (pitch above/below the centre) inside the middle third of a 70° frame
        expect(Math.abs(pitch), label).toBeLessThanOrEqual(DECK_FOV_RAD / 6 + 1e-9)
        // deck obstacles (masts, capstan, posts, hatches) intersecting the cone within 1 u — the barrel itself is not an obstacle
        for (let i = -5; i <= 5; i++) {
          const y = yaw + (i / 5) * CONE
          const d = clearAhead(deck, [position[0], position[2]], y, 1.0, 0, 99)
          expect(d, `${label} ray ${i}`).toBeGreaterThanOrEqual(1.0 - 1e-9)
        }
      }
    }
  })
})
