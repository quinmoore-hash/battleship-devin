import { isSunk, type Board } from '../engine'
import type { GameEvent } from '../store/gameStore'

export interface BattleReport {
  shots: number
  hits: number
  misses: number
  accuracy: number
  turns: number
  shipsSunk: number
  shipsLost: number
  enemyShots: number
  enemyHits: number
  /** Longest run of consecutive player hits. */
  bestStreak: number
  /** Elapsed battle time in seconds (0 when unknown). */
  seconds: number
}

/** Pure summary of a finished (or running) battle for the HUD and the game-over report. */
export function battleReport(events: readonly GameEvent[], playerBoard: Board, enemyBoard: Board, startedAt: number | null, now = Date.now()): BattleReport {
  const mine = events.filter((e) => e.by === 'human')
  const theirs = events.filter((e) => e.by === 'enemy')
  const hits = mine.filter((e) => e.result.outcome !== 'miss').length
  let streak = 0
  let bestStreak = 0
  for (const e of mine) {
    streak = e.result.outcome === 'miss' ? 0 : streak + 1
    bestStreak = Math.max(bestStreak, streak)
  }
  return {
    shots: mine.length,
    hits,
    misses: mine.length - hits,
    accuracy: mine.length ? Math.round((hits / mine.length) * 100) : 0,
    turns: mine.length,
    shipsSunk: enemyBoard.ships.filter(isSunk).length,
    shipsLost: playerBoard.ships.filter(isSunk).length,
    enemyShots: theirs.length,
    enemyHits: theirs.filter((e) => e.result.outcome !== 'miss').length,
    bestStreak,
    seconds: startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0,
  }
}

/** `1:05`, `12:30`, `1:02:03`. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}

/** A captain's rank for the report, from accuracy and whether the battle was won. */
export function captainRank(report: BattleReport, won: boolean): string {
  if (!won) return report.shipsSunk >= 4 ? 'Unlucky Privateer' : report.shipsSunk >= 2 ? 'Deckhand' : 'Powder Monkey'
  if (report.accuracy >= 60) return 'Terror of the Seas'
  if (report.accuracy >= 45) return 'Dread Captain'
  if (report.accuracy >= 33) return 'Seasoned Buccaneer'
  return 'Lucky Corsair'
}
