import { describe, expect, it } from 'vitest'
import { SHIPS } from '../../ships'
import { batteryMuzzles, directionToWorld, facingSide, impactPointWorld, localToWorld } from './anchors'

describe('ship anchor transforms', () => {
  it('a horizontal ship keeps the model frame', () => {
    expect(localToWorld([1, 2, 3], { position: [10, 0.2, -5], rotationY: 0 })).toEqual([11, 2.2, -2])
  })
  it('a vertical ship (rotationY = -π/2) points its bow toward +z', () => {
    const bow = localToWorld([1, 0, 0], { position: [0, 0, 0], rotationY: -Math.PI / 2 })
    expect(bow[0]).toBeCloseTo(0)
    expect(bow[2]).toBeCloseTo(1)
    const starboard = directionToWorld([0, 0, 1], -Math.PI / 2)
    expect(starboard[0]).toBeCloseTo(-1)
    expect(starboard[2]).toBeCloseTo(0)
  })
  it('batteryMuzzles returns the chosen side bow-to-stern in world space', () => {
    const pose = { position: [0, 0.2, 5] as [number, number, number], rotationY: 0 }
    const port = batteryMuzzles(SHIPS.frigate.anchors, pose, 'port')
    expect(port).toHaveLength(3)
    expect(port.map((m) => m.cell)).toEqual([0, 1, 2])
    for (const m of port) {
      expect(m.position[2]).toBeLessThan(5)
      expect(m.direction[2]).toBeLessThan(0)
    }
    expect(batteryMuzzles(SHIPS.frigate.anchors, pose, 'starboard', [1])).toHaveLength(1)
  })
  it('impact points mirror z for starboard and facingSide agrees', () => {
    const pose = { position: [0, 0.2, 0] as [number, number, number], rotationY: 0 }
    const p = impactPointWorld(SHIPS.frigate.anchors, pose, 1, 'port')
    const s = impactPointWorld(SHIPS.frigate.anchors, pose, 1, 'starboard')
    expect(s[2]).toBeCloseTo(-p[2])
    expect(facingSide(pose, [0, 0, -10])).toBe('port')
    expect(facingSide(pose, [0, 0, 10])).toBe('starboard')
    expect(facingSide({ ...pose, rotationY: -Math.PI / 2 }, [-10, 0, 0])).toBe('starboard')
  })
})
