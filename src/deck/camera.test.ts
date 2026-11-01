import { describe, expect, it } from 'vitest'
import { SHIPS } from '../ships'
import {
  BLEND_SECONDS,
  CAM_FLOOR,
  MIN_ARM,
  TP_BACK,
  TP_PIVOT,
  TP_UP,
  bestSpawnYaw,
  blendPose,
  blockersFor,
  blendProgress,
  cameraFloor,
  clampOrbit,
  isBlocked,
  orbitPosition,
  springArm,
  thirdPersonPose,
  type CameraBlockers,
} from './camera'
import { PLAYER_RADIUS, fallbackDeckAnchors, lookForward, pointInPolygon, spawnPose } from './math'

const blockers = (id: 'frigate' | 'man-o-war'): CameraBlockers => {
  const a = SHIPS[id].anchors
  return blockersFor(fallbackDeckAnchors(a, id), a.masts, id)
}

describe('third-person orbit', () => {
  it('sits TP_BACK behind and TP_UP above the pivot at the default elevation, opposite the look direction', () => {
    const yaw = 0.7
    const p = orbitPosition([1, 2, 3], { yaw, pitch: 0 })
    const f = lookForward(yaw, 0)
    expect(p[1]).toBeCloseTo(2 + TP_UP)
    expect(p[0]).toBeCloseTo(1 - f[0] * TP_BACK)
    expect(p[2]).toBeCloseTo(3 - f[2] * TP_BACK)
  })

  it('clamps the elevation: looking far down caps at the top of the arc, looking up never dips under the pivot', () => {
    const hi = orbitPosition([0, 0, 0], { yaw: 0, pitch: clampOrbit(5) })
    const lo = orbitPosition([0, 0, 0], { yaw: 0, pitch: clampOrbit(-5) })
    expect(hi[1]).toBeGreaterThan(lo[1])
    expect(lo[1]).toBeGreaterThan(0)
    expect(clampOrbit(0)).toBe(0)
  })
})

describe('spring arm', () => {
  it('leaves a clear arm alone and never lets the camera under the deck floor', () => {
    const b = blockers('frigate')
    const deckY = b.deck.walk[0].y
    // x −0.1 is clear of both sail slabs (mainmast −0.22 reaches −0.16, foremast 0.37 starts at −0.03)
    const pivot: [number, number, number] = [-0.1, deckY + TP_PIVOT, 0.3]
    const clear: [number, number, number] = [-0.1, deckY + TP_PIVOT + TP_UP, 0.3 + TP_BACK]
    const r = springArm(pivot, clear, b)
    expect(r.arm).toBe(1)
    expect(r.point[0]).toBeCloseTo(clear[0])
    expect(r.point[1]).toBeCloseTo(clear[1])
    expect(r.point[2]).toBeCloseTo(clear[2])
    const low: [number, number, number] = [-0.1, deckY - 0.3, 0.3]
    const lifted = springArm(pivot, low, b)
    expect(lifted.arm).toBe(1)
    expect(lifted.point[1]).toBeGreaterThanOrEqual(deckY + CAM_FLOOR - 1e-9)
  })

  it('pulls in before the raised quarterdeck instead of going through it (frigate, pirate on the main deck looking forward)', () => {
    const b = blockers('frigate')
    const qd = b.deck.walk.find((l) => l.y > b.deck.walk[0].y)!
    const deckY = b.deck.walk[0].y
    // pirate just forward of the quarterdeck break (x −0.85), looking toward the bow: the ideal camera is aft, inside the quarterdeck
    const feet: [number, number, number] = [-0.7, deckY, 0.1]
    const look = { yaw: Math.PI / 2, pitch: -0.3 } // yaw π/2 looks toward −x? no: forward = (−sin yaw, 0, −cos yaw) = (−1, 0, 0) → looks aft; use −π/2 for the bow
    const pose = thirdPersonPose(feet, { ...look, yaw: -Math.PI / 2 }, b)
    // the ideal spot is behind (aft, −x) and low enough to be inside the quarterdeck box: the arm must stop above the quarterdeck planks or short of them
    expect(pose.position[1]).toBeGreaterThanOrEqual(cameraFloor(pose.position[0], pose.position[2], b.deck) - 1e-9)
    if (pose.position[0] < qd.points[1][0] + 0.12) expect(pose.position[1]).toBeGreaterThanOrEqual(qd.y + 0.3 - 1e-9)
  })

  it('does not pass through a mast', () => {
    const b = blockers('man-o-war')
    const mast = b.masts[1]
    const deckY = b.deck.walk[0].y
    const pivot: [number, number, number] = [mast.base[0] + 0.15, deckY + TP_PIVOT, 0]
    const ideal: [number, number, number] = [mast.base[0] - 0.4, deckY + TP_PIVOT + 0.1, 0]
    const r = springArm(pivot, ideal, b)
    expect(r.point[0]).toBeGreaterThan(mast.base[0])
    expect(r.arm).toBeLessThan(0.3)
  })

  it('does not sit inside a sail: behind the frigate mainmast at camera height the arm slides sideways or pulls in', () => {
    const b = blockers('frigate')
    const mast = b.masts[1]
    const deckY = b.deck.walk[0].y
    // pirate just forward of the mainmast looking toward the bow: the ideal camera is right in the mainsail
    const feet: [number, number, number] = [mast.base[0] + 0.3, deckY, 0]
    const pose = thirdPersonPose(feet, { yaw: -Math.PI / 2, pitch: 0 }, b)
    expect(isBlocked(pose.position, b)).toBe(false)
    expect(pose.arm).toBeGreaterThan(0.3)
  })

  it('the spawn pose of every class yields a camera above its deck and within the arm length', () => {
    for (const id of ['frigate', 'man-o-war'] as const) {
      const b = blockers(id)
      const sp = spawnPose(b.deck)
      const pose = thirdPersonPose([sp.x, sp.y, sp.z], { yaw: Math.PI, pitch: 0 }, b)
      expect(pose.position[1]).toBeGreaterThan(sp.y)
      expect(Math.hypot(pose.position[0] - sp.x, pose.position[2] - sp.z)).toBeLessThanOrEqual(Math.hypot(TP_BACK, TP_UP) + 1e-6)
      expect(isBlocked(pose.position, b)).toBe(false)
    }
  })
})

describe('spawn against the castle', () => {
  it("Man-o'-War spawn looking along the ship (camera over the quarterdeck) keeps the pirate in view", () => {
    const b = blockers('man-o-war')
    const feet: [number, number, number] = [b.deck.spawn[0], b.deck.spawn[1], b.deck.spawn[2]]
    for (const yaw of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
      const pose = thirdPersonPose(feet, { yaw, pitch: 0 }, b)
      expect(pose.arm).toBeGreaterThanOrEqual(0.3)
      expect(isBlocked(pose.position, b)).toBe(false)
    }
  })
})

describe('slide hysteresis', () => {
  it('keeps the slide in use while its arm is within 80 % of the best, and reports the slide it used', () => {
    const b = blockers('frigate')
    const deckY = b.deck.walk[0].y
    const mast = b.masts[1]
    const feet: [number, number, number] = [mast.base[0] + 0.3, deckY, 0]
    const fresh = thirdPersonPose(feet, { yaw: -Math.PI / 2, pitch: 0 }, b)
    expect(isBlocked(fresh.position, b)).toBe(false)
    // the slide in use is stable frame to frame
    const again = thirdPersonPose(feet, { yaw: -Math.PI / 2, pitch: 0 }, b, undefined, fresh.slide)
    expect(again.slide).toBe(fresh.slide)
    // a clear spot always returns to the default view, whatever slide was in use
    const clearFeet: [number, number, number] = [-0.1, deckY, 0.2]
    const open = thirdPersonPose(clearFeet, { yaw: 0, pitch: 0 }, b)
    expect(open.slide).toBe(0)
    const back = thirdPersonPose(clearFeet, { yaw: 0, pitch: 0 }, b, undefined, 4)
    expect(back.slide).toBe(0)
  })
})

describe('blend', () => {
  it('smoothsteps from 0 to 1 over BLEND_SECONDS, monotonic, and cuts when seconds is 0', () => {
    expect(blendProgress(0)).toBe(0)
    expect(blendProgress(BLEND_SECONDS)).toBe(1)
    expect(blendProgress(BLEND_SECONDS * 2)).toBe(1)
    let prev = 0
    for (let t = 0; t <= BLEND_SECONDS; t += 0.02) {
      const v = blendProgress(t)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    expect(blendProgress(0.5, 0)).toBe(1)
    expect(blendProgress(0, 0)).toBe(1)
  })

  it('blendPose interpolates position and target without allocating when given an out', () => {
    const a = { position: [0, 0, 0] as [number, number, number], target: [0, 0, -1] as [number, number, number], arm: 1, slide: 0 }
    const b = { position: [2, 4, 6] as [number, number, number], target: [2, 0, 1] as [number, number, number], arm: 0, slide: 0 }
    const out = { position: [9, 9, 9] as [number, number, number], target: [9, 9, 9] as [number, number, number], arm: 1, slide: 0 }
    const r = blendPose(a, b, 0.5, out)
    expect(r).toBe(out)
    expect(r.position).toEqual([1, 2, 3])
    expect(r.target).toEqual([1, 0, 0])
    expect(r.arm).toBe(0.5)
  })
})

describe('pirate never hidden by the static deck geometry', () => {
  for (const id of ['sloop', 'brigantine', 'frigate', 'galleon', 'man-o-war'] as const) {
    it(`${id}: every walkable spot × 8 look yaws keeps at least MIN_ARM`, () => {
      const a = SHIPS[id].anchors
      const b = blockersFor(fallbackDeckAnchors(a, id), a.masts, id)
      const bad: string[] = []
      for (const lvl of b.deck.walk) {
        const xs = lvl.points.map((p) => p[0])
        const zs = lvl.points.map((p) => p[1])
        for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.05) {
          for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.05) {
            const r = PLAYER_RADIUS
            if (![[x, z], [x + r, z], [x - r, z], [x, z + r], [x, z - r]].every((q) => pointInPolygon(q as [number, number], lvl.points))) continue
            for (let k = 0; k < 8; k++) {
              const pose = thirdPersonPose([x, lvl.y, z], { yaw: (k * Math.PI) / 4, pitch: 0 }, b)
              if (pose.arm < MIN_ARM - 1e-9) bad.push(`${x.toFixed(2)},${z.toFixed(2)} yaw ${k}: ${pose.arm.toFixed(2)}`)
            }
          }
        }
      }
      expect(bad, bad.slice(0, 8).join('\n')).toEqual([])
    })
  }
})

describe('bestSpawnYaw', () => {
  for (const id of ['frigate', 'man-o-war'] as const) {
    it(`${id}: whichever way the enemy lies, the first frame has a full arm and no castle lift`, () => {
      const b = blockers(id)
      const feet: [number, number, number] = [b.deck.spawn[0], b.deck.spawn[1], b.deck.spawn[2]]
      for (const want of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const yaw = bestSpawnYaw(feet, want, b)
        expect(Math.abs(yaw - want)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9)
        const pose = thirdPersonPose(feet, { yaw, pitch: 0 }, b)
        expect(pose.arm).toBe(1)
        expect(pose.position[1]).toBeLessThan(feet[1] + TP_PIVOT + TP_UP + 0.05)
      }
    })
  }
  it('below the quarterdeck break, an unlifted low slide beats a camera lifted onto the castle rail (testing-agent spot)', () => {
    const b = blockers('man-o-war')
    const feet: [number, number, number] = [-0.2967, 0.55, -0.3502]
    for (const yaw of [0, -Math.PI / 4, -Math.PI / 2]) {
      const pose = thirdPersonPose(feet, { yaw, pitch: 0 }, b)
      expect(pose.arm).toBeGreaterThanOrEqual(0.3)
      expect(pose.position[1]).toBeLessThan(feet[1] + TP_PIVOT + TP_UP + 0.05)
    }
  })
  it('the pumps beside the mainmast never stand between the camera and the pirate (testing-agent spot, yaw 0)', () => {
    const b = blockers('man-o-war')
    expect(b.posts?.length).toBeGreaterThan(0)
    const feet: [number, number, number] = [-0.3067, 0.55, -0.347]
    const pose = thirdPersonPose(feet, { yaw: 0, pitch: 0 }, b)
    expect(pose.arm).toBeGreaterThanOrEqual(0.3)
    // every point of the line of sight is outside every post below its top
    for (let t = 0; t <= 1; t += 0.05) {
      const x = pose.position[0] + (feet[0] - pose.position[0]) * t
      const y = pose.position[1] + (feet[1] + TP_PIVOT - pose.position[1]) * t
      const z = pose.position[2] + (feet[2] - pose.position[2]) * t
      for (const o of b.posts!) if (y < o.top) expect(Math.hypot(x - o.center[0], z - o.center[1])).toBeGreaterThan(o.radius)
    }
  })
})
