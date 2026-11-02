import { describe, expect, it } from 'vitest'
import type { ShotResult } from '../engine'
import { nextExchange, type AnnouncedShot } from './battleController'

const shot = (by: 'human' | 'enemy', x: number): AnnouncedShot => ({
  by,
  result: { coord: { x, y: 1 }, outcome: 'miss' } as unknown as ShotResult,
})

describe('nextExchange (assertive shot announcer, BUG-724)', () => {
  it('keeps your shot when the reply lands, so both are read: "You fired at A2 … The enemy fired at F9 …"', () => {
    const mine = nextExchange([], shot('human', 0))
    expect(mine).toHaveLength(1)
    const both = nextExchange(mine, shot('enemy', 5))
    expect(both.map((s) => s.by)).toEqual(['human', 'enemy'])
  })

  it('a salvo volley accumulates on both sides, and your next shot after a reply starts a new exchange', () => {
    let ex: AnnouncedShot[] = []
    for (let i = 0; i < 3; i++) ex = nextExchange(ex, shot('human', i))
    for (let i = 0; i < 3; i++) ex = nextExchange(ex, shot('enemy', i))
    expect(ex.map((s) => s.by)).toEqual(['human', 'human', 'human', 'enemy', 'enemy', 'enemy'])
    ex = nextExchange(ex, shot('human', 7))
    expect(ex).toEqual([shot('human', 7)])
  })
})
