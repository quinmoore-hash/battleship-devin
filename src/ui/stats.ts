import { isSunk, type Board } from '../engine'
import type { Player } from '../engine'
import type { GameEvent } from '../store/gameStore'

export interface BattleReport {
  shots: number
  hits: number
  misses: number
  accuracy: number
  /** Turns the player took: one per shot in classic, one per volley in salvo (BUG-316). */
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

/**
 * Turns `by` took: the sides alternate, so a run of consecutive events by one side is one turn (a salvo volley
 * lands as several events in a row; classic turns are single shots).
 */
export function countTurns(events: readonly GameEvent[], by: Player): number {
  let turns = 0
  let prev: Player | null = null
  for (const e of events) {
    if (e.kind === 'spyglass') continue
    if (e.by === by && prev !== by) turns++
    prev = e.by
  }
  return turns
}

/** Pure summary of a finished (or running) battle for the HUD and the game-over report. */
export function battleReport(events: readonly GameEvent[], playerBoard: Board, enemyBoard: Board, startedAt: number | null, now = Date.now()): BattleReport {
  // Spyglass looks are not shots
  const mine = events.filter((e) => e.by === 'human' && e.kind !== 'spyglass')
  const theirs = events.filter((e) => e.by === 'enemy' && e.kind !== 'spyglass')
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
    turns: countTurns(events, 'human'),
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
