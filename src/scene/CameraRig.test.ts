import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { BOARD_LAYOUT } from './layout'
import { CAMERA_SHOTS, battleFraming, fitFov, frameShot, unfitFov, type CameraView, type ShotFrame } from './CameraRig'

const frame = (view: CameraView, w: number, h: number): ShotFrame =>
  frameShot(view, w / h, w, { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 0 })

/** Screen position of a world point as fractions of the viewport (0,0 = top-left) through the shot's camera. */
function project(shot: ShotFrame, w: number, h: number, p: [number, number, number]) {
  const cam = new THREE.PerspectiveCamera(fitFov(shot.fov, w / h), w / h, 0.1, 500)
  cam.position.copy(shot.position)
  cam.lookAt(shot.target)
  cam.updateMatrixWorld()
  const v = new THREE.Vector3(...p).project(cam)
  return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 }
}

const corners = (b: typeof BOARD_LAYOUT.player): [number, number, number][] => {
  const [x, , z] = b.origin
  const s = b.size * b.cellSize
  return [
    [x, 0, z],
    [x + s, 0, z],
    [x, 0, z + s],
    [x + s, 0, z + s],
  ]
}
const HORIZON: [number, number, number] = [0, 0, -400]
const LANDSCAPE: [number, number][] = [
  [1440, 900],
  [1280, 800],
  [812, 375],
  [1024, 700],
]
const PORTRAIT: [number, number][] = [
  [375, 812],
  [768, 1024],
  [390, 844],
]

describe('frameShot', () => {
  it('leaves every landscape shot byte-identical to CAMERA_SHOTS / battleFraming', () => {
    for (const [w, h] of LANDSCAPE) {
      for (const view of ['placement', 'gameover', 'menu', 'handoff', 'deck'] as CameraView[]) {
        const f = frame(view, w, h)
        expect(f.position.toArray()).toEqual(CAMERA_SHOTS[view].position.toArray())
        expect(f.target.toArray()).toEqual(CAMERA_SHOTS[view].target.toArray())
        expect(f.fov).toBe(CAMERA_SHOTS[view].fov)
      }
      for (const view of ['battle', 'battle-far'] as const) {
        const f = frame(view, w, h)
        const ref = battleFraming(w / h, w, { target: new THREE.Vector3(), fov: 0 }, view)
        expect(f.position.toArray()).toEqual(CAMERA_SHOTS[view].position.toArray())
        expect(f.target.toArray()).toEqual(ref.target.toArray())
        expect(f.fov).toBe(ref.fov)
      }
    }
  })

  it('keeps the pre-BUG-707 landscape battle framing (regression pins)', () => {
    const a = frame('battle', 1440, 900)
    expect(a.fov).toBeCloseTo(33.9, 1)
    expect(a.target.z).toBeCloseTo(0.9, 1)
    const b = frame('battle', 1280, 800)
    expect(b.fov).toBeCloseTo(37.6, 1)
    expect(b.target.z).toBeCloseTo(-0.9, 1)
  })

  it('unfitFov inverts fitFov on portrait aspects', () => {
    for (const v of [50, 60, 69]) expect(fitFov(unfitFov(v, 0.46), 0.46)).toBeCloseTo(v, 6)
    expect(unfitFov(42, 1.6)).toBe(42)
  })

  it('portrait battle: both boards and their label rows on screen under a horizon in the top third (BUG-707)', () => {
    for (const [w, h] of [[375, 812], [768, 1024], [414, 896]]) {
      const f = frameShot('battle', w / h, w, { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 0 })
      expect(f.target.distanceTo(f.position)).toBeLessThanOrEqual(44.01) // OrbitControls maxDistance=48 must not pull the camera in
    }
    for (const [w, h] of PORTRAIT) {
      const f = frame('battle', w, h)
      expect(f.position.toArray()).toEqual(CAMERA_SHOTS.battle.position.toArray())
      expect(fitFov(f.fov, w / h)).toBeLessThan(72)
      const horizon = project(f, w, h, HORIZON)
      expect(horizon.y).toBeGreaterThan(0.1)
      expect(horizon.y).toBeLessThan(0.35)
      for (const p of [...corners(BOARD_LAYOUT.player), ...corners(BOARD_LAYOUT.enemy)]) {
        const { x, y } = project(f, w, h, p)
        expect(x).toBeGreaterThan(0.02)
        expect(x).toBeLessThan(0.98)
        expect(y).toBeGreaterThan(horizon.y)
        expect(y).toBeLessThan(0.96)
      }
      const labels = project(f, w, h, [-6.2, 0, BOARD_LAYOUT.player.origin[2] + 10.7])
      expect(labels.x).toBeGreaterThan(-0.01)
      expect(labels.y).toBeLessThan(0.97)
    }
  })

  it('portrait placement: pulls back until the player board and its labels clear the sides', () => {
    for (const [w, h] of PORTRAIT) {
      const f = frame('placement', w, h)
      expect(f.position.y).toBeGreaterThan(CAMERA_SHOTS.placement.position.y)
      for (const p of corners(BOARD_LAYOUT.player)) {
        const { x, y } = project(f, w, h, p)
        expect(x).toBeGreaterThan(0.08)
        expect(x).toBeLessThan(0.92)
        expect(y).toBeGreaterThan(0.1)
        expect(y).toBeLessThan(0.92)
      }
      const label = project(f, w, h, [-6.6, 0, BOARD_LAYOUT.player.origin[2] + 11.7])
      expect(label.x).toBeGreaterThan(0)
    }
  })

  it('portrait game over: the enemy board is on screen below a horizon in the top third', () => {
    for (const [w, h] of PORTRAIT) {
      const f = frame('gameover', w, h)
      const horizon = project(f, w, h, [200, 0, -200])
      expect(horizon.y).toBeLessThan(0.33)
      for (const p of corners(BOARD_LAYOUT.enemy)) {
        const { x, y } = project(f, w, h, p)
        expect(x).toBeGreaterThan(0.05)
        expect(x).toBeLessThan(0.95)
        expect(y).toBeGreaterThan(horizon.y)
        expect(y).toBeLessThan(0.9)
      }
    }
  })
})
