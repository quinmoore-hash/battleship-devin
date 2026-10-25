/**
 * Stats & streaks: per-difficulty games / wins / best shots-to-win / best accuracy / win streak / play time,
 * persisted in `localStorage['battleship-devin.stats']`.
 *
 *   emptyStats() / recordGame(stats, summary) / summarizeGame(state, durationMs)   pure
 *   loadStats() / saveStats(stats) / clearStats()                                   storage
 *   useStats()                                                                      React hook (live)
 *   bindStatsRecorder()                                                             records every finished game from the store
 */
import { useSyncExternalStore } from 'react'
import type { Difficulty } from '../engine'
import { useGameStore, type GameModes, type GameState } from '../store/gameStore'

export const STATS_KEY = 'battleship-devin.stats'
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard']

export interface DifficultyStats {
  games: number
  wins: number
  /** Fewest human shots in a won game; null until the first win. */
  bestShots: number | null
  /** Best hit ratio (0..1) over all games. */
  bestAccuracy: number
  /** Consecutive wins right now (0 after a loss). */
  streak: number
  bestStreak: number
  /** Total time spent in the battle phase, ms. */
  playTimeMs: number
}

export interface Stats {
  version: 1
  byDifficulty: Record<Difficulty, DifficultyStats>
  updatedAt: number | null
}

export interface GameSummary {
  difficulty: Difficulty
  won: boolean
  /** Shots the human fired. */
  shots: number
  /** Of which hit a ship. */
  hits: number
  durationMs: number
  modes?: GameModes
}

export const emptyDifficultyStats = (): DifficultyStats => ({
  games: 0,
  wins: 0,
  bestShots: null,
  bestAccuracy: 0,
  streak: 0,
  bestStreak: 0,
  playTimeMs: 0,
})

export const emptyStats = (): Stats => ({
  version: 1,
  byDifficulty: { easy: emptyDifficultyStats(), medium: emptyDifficultyStats(), hard: emptyDifficultyStats() },
  updatedAt: null,
})

export const accuracyOf = (summary: Pick<GameSummary, 'shots' | 'hits'>): number =>
  summary.shots > 0 ? Math.min(1, summary.hits / summary.shots) : 0

/** Folds one finished game into the stats. Pure: returns a new object. */
export function recordGame(stats: Stats, summary: GameSummary, now = Date.now()): Stats {
  const prev = stats.byDifficulty[summary.difficulty]
  const streak = summary.won ? prev.streak + 1 : 0
  const next: DifficultyStats = {
    games: prev.games + 1,
    wins: prev.wins + (summary.won ? 1 : 0),
    bestShots: summary.won ? Math.min(prev.bestShots ?? Infinity, summary.shots) : prev.bestShots,
    bestAccuracy: Math.max(prev.bestAccuracy, accuracyOf(summary)),
    streak,
    bestStreak: Math.max(prev.bestStreak, streak),
    playTimeMs: prev.playTimeMs + Math.max(0, Math.round(summary.durationMs)),
  }
  return { ...stats, byDifficulty: { ...stats.byDifficulty, [summary.difficulty]: next }, updatedAt: now }
}

/** Builds the summary of the game in `state` (call when `phase === 'gameover'`). */
export function summarizeGame(state: Pick<GameState, 'difficulty' | 'winner' | 'events' | 'modes'>, durationMs: number): GameSummary {
  const human = state.events.filter((e) => e.by === 'human')
  return {
    difficulty: state.difficulty,
    won: state.winner === 'human',
    shots: human.length,
    hits: human.filter((e) => e.result.outcome !== 'miss').length,
    durationMs,
    modes: state.modes,
  }
}

export interface StatsTotals {
  games: number
  wins: number
  playTimeMs: number
  /** Longest streak across difficulties. */
  bestStreak: number
}

export function totals(stats: Stats): StatsTotals {
  return DIFFICULTIES.reduce<StatsTotals>(
    (acc, d) => {
      const s = stats.byDifficulty[d]
      return { games: acc.games + s.games, wins: acc.wins + s.wins, playTimeMs: acc.playTimeMs + s.playTimeMs, bestStreak: Math.max(acc.bestStreak, s.bestStreak) }
    },
    { games: 0, wins: 0, playTimeMs: 0, bestStreak: 0 },
  )
}

export const winRate = (s: Pick<DifficultyStats, 'games' | 'wins'>): number => (s.games > 0 ? s.wins / s.games : 0)

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`
  return `${s}s`
}

export const formatPercent = (ratio: number): string => `${Math.round(ratio * 100)}%`

// ---------- storage ----------

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

function isDifficultyStats(v: unknown): v is DifficultyStats {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return ['games', 'wins', 'bestAccuracy', 'streak', 'bestStreak', 'playTimeMs'].every((k) => typeof o[k] === 'number') && (o.bestShots === null || typeof o.bestShots === 'number')
}

/** Parses a stored blob defensively: anything malformed falls back to empty stats (per difficulty). */
export function parseStats(raw: string | null): Stats {
  const base = emptyStats()
  if (!raw) return base
  try {
    const parsed = JSON.parse(raw) as Partial<Stats>
    if (!parsed || typeof parsed !== 'object' || !parsed.byDifficulty) return base
    for (const d of DIFFICULTIES) {
      const v = (parsed.byDifficulty as Record<string, unknown>)[d]
      if (isDifficultyStats(v)) base.byDifficulty[d] = { ...v }
    }
    base.updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : null
    return base
  } catch {
    return base
  }
}

export function loadStats(storage: StorageLike | null = defaultStorage()): Stats {
  return parseStats(storage?.getItem(STATS_KEY) ?? null)
}

export function saveStats(stats: Stats, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(STATS_KEY, JSON.stringify(stats))
  } catch {
    // quota / private mode: stats simply are not persisted this session
  }
  notify()
}

export function clearStats(storage: StorageLike | null = defaultStorage()): void {
  storage?.removeItem(STATS_KEY)
  notify()
}

// ---------- live subscription ----------

const listeners = new Set<() => void>()
let cached: Stats | null = null
let cachedRaw: string | null | undefined

function notify() {
  cached = null
  for (const l of listeners) l()
}

function snapshot(): Stats {
  const raw = defaultStorage()?.getItem(STATS_KEY) ?? null
  if (cached && raw === cachedRaw) return cached
  cachedRaw = raw
  cached = parseStats(raw)
  return cached
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STATS_KEY) notify()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

const EMPTY = emptyStats()

/** The persisted stats, re-rendering whenever a game is recorded (in this tab or another). */
export function useStats(): Stats {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY)
}

/** Records `summary` into the persisted stats and returns the new stats. */
export function commitGame(summary: GameSummary, storage: StorageLike | null = defaultStorage()): Stats {
  const next = recordGame(loadStats(storage), summary)
  saveStats(next, storage)
  return next
}

let recorderUnbind: (() => void) | null = null

/**
 * Watches the game store: starts a clock when the battle begins and records the game once when it ends.
 * Safe to call more than once (a single subscription is kept). Returns the unbind function.
 */
export function bindStatsRecorder(store: typeof useGameStore = useGameStore, now: () => number = () => Date.now()): () => void {
  if (recorderUnbind) return recorderUnbind
  let battleStart: number | null = null
  let prevPhase = store.getState().phase
  const unsub = store.subscribe((state) => {
    if (state.phase === prevPhase) return
    if (state.phase === 'battle') battleStart = now()
    if (state.phase === 'gameover' && prevPhase === 'battle') {
      const duration = battleStart === null ? 0 : now() - battleStart
      battleStart = null
      commitGame(summarizeGame(state, duration))
    }
    if (state.phase === 'menu' || state.phase === 'placement') battleStart = null
    prevPhase = state.phase
  })
  recorderUnbind = () => {
    unsub()
    recorderUnbind = null
  }
  return recorderUnbind
}
