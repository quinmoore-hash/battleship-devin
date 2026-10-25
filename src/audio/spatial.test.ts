import { describe, expect, it } from 'vitest'
import { DEFAULT_LISTENER, spatialize, type AudioListener } from './spatial'

const cam: AudioListener = { position: [0, 10, 15], forward: [0, -0.5, -1] }

describe('spatialize', () => {
  it('pans left for sources left of the camera and right for the right', () => {
    expect(spatialize([-8, 0, 0], cam).pan).toBeLessThan(-0.5)
    expect(spatialize([8, 0, 0], cam).pan).toBeGreaterThan(0.5)
    expect(spatialize([0, 0, 0], cam).pan).toBe(0)
  })

  it('clamps pan to [-1, 1]', () => {
    expect(spatialize([-100, 0, 0], cam).pan).toBe(-1)
    expect(spatialize([100, 0, 0], cam).pan).toBe(1)
  })

  it('flips left/right when the camera looks the other way', () => {
    const reversed: AudioListener = { position: [0, 10, -15], forward: [0, -0.5, 1] }
    expect(spatialize([-8, 0, 0], reversed).pan).toBeGreaterThan(0)
  })

  it('falls back to a sane right vector when the camera looks straight down', () => {
    const topDown: AudioListener = { position: [0, 30, 0], forward: [0, -1, 0] }
    expect(spatialize([-6, 0, 0], topDown).pan).toBeLessThan(0)
  })

  it('attenuates with distance: full gain nearby, quieter far away, floored at minGain', () => {
    const near = spatialize([0, 4, 10], cam)
    const mid = spatialize([0, 0, -10], cam)
    const far = spatialize([0, 0, -45], cam)
    expect(near.gain).toBe(1)
    expect(mid.gain).toBeLessThan(near.gain)
    expect(far.gain).toBeLessThan(mid.gain)
    expect(spatialize([0, 0, -500], cam).gain).toBe(0.08)
  })

  it('honours custom rolloff options', () => {
    const loose = spatialize([0, 0, -20], cam, { refDistance: 40 })
    expect(loose.gain).toBe(1)
    const tight = spatialize([0, 0, -20], cam, { refDistance: 2, rolloff: 3 })
    expect(tight.gain).toBeLessThan(0.1)
  })

  it('reports the straight-line distance', () => {
    expect(spatialize([3, 4, 15], { position: [0, 0, 15], forward: [0, 0, -1] }).distance).toBe(5)
  })

  it('default listener sits above the player fleet looking at the enemy fleet', () => {
    expect(DEFAULT_LISTENER.position[2]).toBeGreaterThan(0)
    expect(DEFAULT_LISTENER.forward[2]).toBeLessThan(0)
    // enemy fleet (z ≈ -8) is further than the player fleet (z ≈ 5.5) so it is quieter
    expect(spatialize([-0.5, 0.2, -8.5]).gain).toBeLessThan(spatialize([-0.5, 0.2, 5.5]).gain)
  })
})
