import { describe, expect, it } from 'vitest'
import { BOARD_LAYOUT, boardCenter, cellToWorld } from '../scene/layout'
import { SPYGLASS_FOV, cellUnderGlass, handSway, pointerPan, railPoint, spyglassEye } from './Spyglass'
import type { DeckAnchors } from './contract'
import { lookAngles } from './math'

const deck: DeckAnchors = {
  spawn: [0, 0.1, 0.8],
  walk: [{ points: [[-0.3, -1.2], [0.3, -1.2], [0.3, 1.2], [-0.3, 1.2]], y: 0.1 }],
  ramps: [],
  obstacles: [],
  stations: [],
}

describe('spyglass projection', () => {
  it('finds the cell straight under the crosshair and null off the board', () => {
    const board = BOARD_LAYOUT.enemy
    const target = cellToWorld({ x: 4, y: 7 }, board.origin)
    const eye: [number, number, number] = [target[0] + 3, BOARD_LAYOUT.surfaceY + 2, target[2] + 9]
    const { yaw, pitch } = lookAngles(eye, target)
    expect(cellUnderGlass(eye, yaw, pitch, board)).toEqual({ x: 4, y: 7 })
    // looking at the sky
    expect(cellUnderGlass(eye, yaw, 0.4, board)).toBeNull()
    // looking well wide of the board
    expect(cellUnderGlass(eye, yaw + 1.2, pitch, board)).toBeNull()
  })
  it('panning the pointer right / up turns the glass right / up, clamped at the window edge', () => {
    expect(pointerPan(0, 0).yaw).toBeCloseTo(0)
    expect(pointerPan(0.25, 0).yaw).toBeLessThan(0)
    expect(pointerPan(0, -0.25).pitch).toBeGreaterThan(0)
    expect(pointerPan(3, 0).yaw).toBe(pointerPan(0.5, 0).yaw)
  })
  it('stands the lookout at the rail nearest the enemy waters and faces the board', () => {
    const rail = railPoint(deck, [0, -1])
    expect(rail[1]).toBeCloseTo(-1.16, 2)
    expect(Math.abs(rail[0])).toBeLessThan(1e-6)
    const foe = boardCenter(BOARD_LAYOUT.enemy)
    const pose = spyglassEye(deck, { position: [0, BOARD_LAYOUT.surfaceY, 5], rotationY: 0 }, BOARD_LAYOUT.surfaceY, foe)
    expect(pose.eye[2]).toBeLessThan(5)
    expect(pose.eye[1]).toBeGreaterThan(BOARD_LAYOUT.surfaceY)
    expect(Math.abs(pose.yaw)).toBeLessThan(0.05)
    expect(pose.pitch).toBeLessThan(0)
    // a ship turned 90° still puts the lookout on the side facing the enemy
    const turned = spyglassEye(deck, { position: [0, BOARD_LAYOUT.surfaceY, 5], rotationY: Math.PI / 2 }, BOARD_LAYOUT.surfaceY, foe)
    expect(turned.eye[2]).toBeLessThan(5)
    expect(Math.abs(turned.eye[0])).toBeLessThan(0.05)
  })
  it('narrows the view and sways only when motion is allowed', () => {
    expect(SPYGLASS_FOV).toBeLessThan(30)
    expect(handSway(0.3, true)).toEqual({ yaw: 0, pitch: 0 })
    expect(Math.abs(handSway(0.3, false).yaw)).toBeGreaterThan(0)
  })
})
