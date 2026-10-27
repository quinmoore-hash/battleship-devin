import { beforeEach, describe, expect, it } from 'vitest'
import { create } from 'zustand'
import {
  accuracyOf,
  bindStatsRecorder,
  emptyStats,
  formatDuration,
  loadStats,
  parseStats,
  recordGame,
  saveStats,
  STATS_KEY,
  summarizeGame,
  totals,
  winRate,
  type GameSummary,
} from './stats'
import { useGameStore } from '../store/gameStore'

class MemoryStorage {
  map = new Map<string, string>()
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.map.set(k, v)
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
}

const game = (over: Partial<GameSummary>): GameSummary => ({ difficulty: 'medium', won: true, shots: 40, hits: 17, durationMs: 60_000, ...over })

describe('stats: recordGame', () => {
  it('tracks games, wins, best shots, best accuracy, streaks and play time per difficulty', () => {
    let s = emptyStats()
    s = recordGame(s, game({ shots: 50, hits: 17 }), 1)
    s = recordGame(s, game({ shots: 38, hits: 17, durationMs: 30_000 }), 2)
    s = recordGame(s, game({ won: false, shots: 60, hits: 12 }), 3)
    s = recordGame(s, game({ difficulty: 'hard', won: true, shots: 70, hits: 17 }), 4)
    const m = s.byDifficulty.medium
    expect(m.games).toBe(3)
    expect(m.wins).toBe(2)
    expect(m.bestShots).toBe(38)
    expect(m.bestTurns).toBe(38)
    expect(m.bestAccuracy).toBeCloseTo(17 / 38)
    expect(m.streak).toBe(0)
    expect(m.bestStreak).toBe(2)
    expect(m.playTimeMs).toBe(150_000)
    expect(s.byDifficulty.hard).toMatchObject({ games: 1, wins: 1, bestShots: 70, streak: 1, bestStreak: 1 })
    expect(s.byDifficulty.easy.games).toBe(0)
    expect(s.updatedAt).toBe(4)
    expect(totals(s)).toEqual({ games: 4, wins: 3, playTimeMs: 210_000, bestStreak: 2 })
    expect(winRate(m)).toBeCloseTo(2 / 3)
  })

  it('a loss does not set best shots; a streak resumes after a loss', () => {
    let s = emptyStats()
    s = recordGame(s, game({ won: false, shots: 10 }))
    expect(s.byDifficulty.medium.bestShots).toBeNull()
    s = recordGame(s, game({ won: true }))
    s = recordGame(s, game({ won: true }))
    s = recordGame(s, game({ won: false }))
    s = recordGame(s, game({ won: true }))
    expect(s.byDifficulty.medium.streak).toBe(1)
    expect(s.byDifficulty.medium.bestStreak).toBe(2)
  })

  it('does not mutate its input', () => {
    const s = emptyStats()
    recordGame(s, game({}))
    expect(s).toEqual(emptyStats())
  })

  it('accuracy and durations are clamped / formatted', () => {
    expect(accuracyOf({ shots: 0, hits: 0 })).toBe(0)
    expect(accuracyOf({ shots: 4, hits: 9 })).toBe(1)
    expect(formatDuration(5_000)).toBe('5s')
    expect(formatDuration(65_000)).toBe('1m 05s')
    expect(formatDuration(3_700_000)).toBe('1h 1m')
  })
})

describe('stats: persistence', () => {
  it('round-trips through storage under the documented key', () => {
    const storage = new MemoryStorage()
    const s = recordGame(emptyStats(), game({}), 5)
    saveStats(s, storage)
    expect(storage.map.has(STATS_KEY)).toBe(true)
    expect(loadStats(storage)).toEqual(s)
  })

  it('ignores malformed or partial blobs', () => {
    expect(parseStats(null)).toEqual(emptyStats())
    expect(parseStats('not json')).toEqual(emptyStats())
    expect(parseStats('{"version":1}')).toEqual(emptyStats())
    const partial = parseStats(JSON.stringify({ version: 1, byDifficulty: { easy: { games: 2, wins: 1, bestShots: 30, bestAccuracy: 0.5, streak: 1, bestStreak: 1, playTimeMs: 10 }, hard: { games: 'x' } } }))
    expect(partial.byDifficulty.easy.games).toBe(2)
    expect(partial.byDifficulty.easy.bestTurns).toBeNull()
    expect(partial.byDifficulty.hard).toEqual(emptyStats().byDifficulty.hard)
  })
})

describe('stats: salvo turns (BUG-316)', () => {
  it('records the fewest turns separately from the fewest shots', () => {
    let s = emptyStats()
    s = recordGame(s, game({ shots: 60, hits: 17, turns: 15 }))
    s = recordGame(s, game({ shots: 45, hits: 17 }))
    expect(s.byDifficulty.medium.bestShots).toBe(45)
    expect(s.byDifficulty.medium.bestTurns).toBe(15)
  })
})

describe('stats: summarizeGame + recorder', () => {
  beforeEach(() => useGameStore.getState().reset())

  it('summarises the human side of a finished game', () => {
    const summary = summarizeGame(
      {
        difficulty: 'hard',
        winner: 'enemy',
        modes: { salvo: true, storm: false, blackFlag: false },
        events: [
          { id: 1, by: 'human', kind: 'shot', result: { coord: { x: 0, y: 0 }, outcome: 'hit', shipId: 'sloop' } },
          { id: 2, by: 'enemy', kind: 'shot', result: { coord: { x: 0, y: 0 }, outcome: 'miss' } },
          { id: 3, by: 'human', kind: 'shot', result: { coord: { x: 1, y: 0 }, outcome: 'miss' } },
        ],
      },
      1234,
    )
    expect(summary).toEqual({ difficulty: 'hard', won: false, shots: 2, hits: 1, turns: 2, durationMs: 1234, modes: { salvo: true, storm: false, blackFlag: false } })
  })

  it('stormy seas: shots lost in the storm count as neither shots nor hits (accuracy matches the report)', () => {
    const summary = summarizeGame(
      {
        difficulty: 'easy',
        winner: 'human',
        modes: { salvo: false, storm: true },
        events: [
          { id: 1, by: 'human', result: { coord: { x: 0, y: 0 }, outcome: 'lost' } },
          { id: 2, by: 'enemy', result: { coord: { x: 0, y: 0 }, outcome: 'lost' } },
          { id: 3, by: 'human', result: { coord: { x: 0, y: 0 }, outcome: 'hit', shipId: 'sloop' } },
          { id: 4, by: 'enemy', result: { coord: { x: 1, y: 0 }, outcome: 'miss' } },
          { id: 5, by: 'human', result: { coord: { x: 1, y: 0 }, outcome: 'miss' } },
        ],
      },
      10,
    )
    expect(summary).toMatchObject({ shots: 2, hits: 1, turns: 3 })
    expect(accuracyOf(summary)).toBeCloseTo(0.5)
  })

  it('records a game once when the store goes battle -> gameover, timing the battle phase', () => {
    let t = 1000
    const store = create<{ phase: string; difficulty: string; winner?: string; events: unknown[]; modes: unknown }>(() => ({
      phase: 'menu',
      difficulty: 'easy',
      events: [],
      modes: { salvo: false, storm: false },
    }))
    const storage = new MemoryStorage()
    // the recorder writes to the default storage; emulate it by swapping the global
    const g = globalThis as { localStorage?: unknown }
    const prev = g.localStorage
    g.localStorage = storage
    try {
      const unbind = bindStatsRecorder(store as unknown as typeof useGameStore, () => t)
      expect(bindStatsRecorder(store as unknown as typeof useGameStore, () => t)).toBe(unbind)
      store.setState({ phase: 'placement' })
      t = 2000
      store.setState({ phase: 'battle' })
      t = 9000
      store.setState({ events: [{ id: 1, by: 'human', kind: 'shot', result: { coord: { x: 0, y: 0 }, outcome: 'miss' } }] })
      store.setState({ phase: 'gameover', winner: 'human' })
      store.setState({ phase: 'gameover', winner: 'human' })
      const saved = loadStats(storage)
      expect(saved.byDifficulty.easy).toMatchObject({ games: 1, wins: 1, bestShots: 1, playTimeMs: 7000, streak: 1 })
      store.setState({ phase: 'menu' })
      store.setState({ phase: 'gameover' })
      expect(loadStats(storage).byDifficulty.easy.games).toBe(1)
      unbind()
    } finally {
      g.localStorage = prev
    }
  })
})
