import { describe, expect, it } from 'vitest'
import { SHOT_FLIGHT_MS, broadsideTimeline, shotTimeline, timelineLength } from './sequence'

const names = (cues: ReturnType<typeof shotTimeline>) => cues.map((c) => c.sfx)

describe('shotTimeline', () => {
  it('miss: fire → whistle → splash at the flight time', () => {
    const cues = shotTimeline('miss', { from: [0, 0, 5], to: [2, 0, -8] })
    expect(names(cues)).toEqual(['cannon-fire', 'cannon-whistle', 'splash-miss'])
    expect(cues[0].at).toBe(0)
    expect(cues[0].at3d).toEqual([0, 0, 5])
    expect(cues[1].at).toBeGreaterThan(0)
    expect(cues[1].at).toBeLessThan(cues[2].at)
    expect(cues[2].at).toBe(SHOT_FLIGHT_MS.full)
    expect(cues[2].at3d).toEqual([2, 0, -8])
  })

  it('hit: wood impact then the crew shouts', () => {
    const cues = shotTimeline('hit')
    expect(names(cues)).toEqual(['cannon-fire', 'cannon-whistle', 'impact-wood', 'crew-shout-hit'])
    expect(cues[3].at).toBeGreaterThan(cues[2].at)
  })

  it('sunk: impact → mast snap → groan → bubbles, and a cheer only for the player', () => {
    const player = shotTimeline('sunk', { byPlayer: true })
    expect(names(player)).toEqual(['cannon-fire', 'cannon-whistle', 'impact-wood', 'crew-shout-hit', 'mast-snap', 'sinking-groan', 'bubbles', 'crew-cheer'])
    for (let i = 1; i < player.length; i++) expect(player[i].at).toBeGreaterThanOrEqual(player[i - 1].at)
    expect(names(shotTimeline('sunk'))).not.toContain('crew-cheer')
  })

  it('fast mode shortens the flight and the tail', () => {
    const full = shotTimeline('sunk', { byPlayer: true })
    const fast = shotTimeline('sunk', { byPlayer: true, fast: true })
    expect(timelineLength(fast)).toBeLessThan(timelineLength(full) / 2)
    expect(fast.find((c) => c.sfx === 'impact-wood')!.at).toBe(SHOT_FLIGHT_MS.fast)
  })

  it('honours an explicit flight time from the cinematic and drops the whistle for point-blank shots', () => {
    expect(shotTimeline('miss', { flightMs: 2500 }).at(-1)!.at).toBe(2500)
    expect(names(shotTimeline('miss', { flightMs: 300 }))).toEqual(['cannon-fire', 'splash-miss'])
  })
})

describe('broadsideTimeline', () => {
  it('staggers the guns, is sorted and deterministic', () => {
    const a = broadsideTimeline({ guns: 5 })
    const b = broadsideTimeline({ guns: 5 })
    expect(a).toEqual(b)
    expect(a.filter((c) => c.sfx === 'cannon-fire')).toHaveLength(5)
    const fires = a.filter((c) => c.sfx === 'cannon-fire').map((c) => c.at)
    expect(new Set(fires).size).toBe(5)
    for (let i = 1; i < a.length; i++) expect(a[i].at).toBeGreaterThanOrEqual(a[i - 1].at)
  })

  it('cycles outcomes and positions per gun', () => {
    const cues = broadsideTimeline({ guns: 3, outcomes: ['miss'], gunPositions: [[-2, 0, 5], [2, 0, 5]], targetPositions: [[0, 0, -8]] })
    expect(cues.filter((c) => c.sfx === 'splash-miss')).toHaveLength(3)
    expect(cues.filter((c) => c.sfx === 'impact-wood')).toHaveLength(0)
    const fires = cues.filter((c) => c.sfx === 'cannon-fire')
    expect(fires[0].at3d).toEqual([-2, 0, 5])
    expect(fires[1].at3d).toEqual([2, 0, 5])
    expect(fires[2].at3d).toEqual([-2, 0, 5])
  })
})
