import { useState } from "react";
import type { Difficulty } from "../engine";
import {
  clearStats,
  DIFFICULTIES,
  formatDuration,
  formatPercent,
  totals,
  useStats,
  winRate,
} from "./stats";
import "./extras.css";

const LABEL: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

export interface StatsPanelProps {
  /** Row to highlight (the game just played). */
  difficulty?: Difficulty;
  /** Fewer columns, for the menu. */
  compact?: boolean;
  title?: string;
  className?: string;
}

/** Captain's log: per-difficulty games, wins, best shots-to-win, best accuracy, win streak and time at sea. */
export function StatsPanel({
  difficulty,
  compact = false,
  title = "Captain’s log",
  className = "",
}: StatsPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const stats = useStats();
  const t = totals(stats);
  const played = DIFFICULTIES.filter((d) => stats.byDifficulty[d].games > 0);
  return (
    <section
      className={`xt-panel xt-stats${compact ? " compact" : ""} ${className}`}
      data-testid="stats-panel"
      aria-label="Statistics"
    >
      <header className="xt-stats-head">
        <strong>{title}</strong>
        <span className="xt-muted" data-testid="stats-totals">
          {t.games === 0
            ? "No battles yet"
            : `${t.games} ${t.games === 1 ? "battle" : "battles"} · ${t.wins} won · ${formatDuration(t.playTimeMs)} at sea`}
        </span>
      </header>
      {played.length === 0 ? (
        <p className="xt-muted xt-stats-empty">
          Win a battle to start a streak.
        </p>
      ) : (
        <table className="xt-table">
          <thead>
            <tr>
              <th scope="col">Enemy</th>
              <th scope="col">W / G</th>
              <th scope="col" title="Win rate">
                Win %
              </th>
              <th scope="col" title="Current win streak (best)">
                Streak
              </th>
              <th scope="col" title="Fewest turns in a won game (shots)">
                Best
              </th>
              {!compact && (
                <th scope="col" title="Best accuracy">
                  Acc.
                </th>
              )}
              {!compact && <th scope="col">Time</th>}
            </tr>
          </thead>
          <tbody>
            {DIFFICULTIES.map((d) => {
              const s = stats.byDifficulty[d];
              if (s.games === 0) return null;
              return (
                <tr
                  key={d}
                  className={d === difficulty ? "current" : ""}
                  data-testid={`stats-row-${d}`}
                >
                  <th scope="row">{LABEL[d]}</th>
                  <td data-testid={`stats-${d}-wins`}>
                    {s.wins} / {s.games}
                  </td>
                  <td>{formatPercent(winRate(s))}</td>
                  <td data-testid={`stats-${d}-streak`}>
                    {s.streak > 0 ? String(s.streak) : "0"}{" "}
                    <small>({s.bestStreak})</small>
                  </td>
                  <td data-testid={`stats-${d}-best`}>
                    {s.bestTurns ?? s.bestShots ?? "—"}
                    {s.bestTurns !== null &&
                      s.bestShots !== null &&
                      s.bestShots !== s.bestTurns && (
                        <small> ({s.bestShots})</small>
                      )}
                  </td>
                  {!compact && <td>{formatPercent(s.bestAccuracy)}</td>}
                  {!compact && <td>{formatDuration(s.playTimeMs)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {t.games > 0 &&
        (confirming ? (
          <span
            className="xt-row xt-stats-clear"
            role="group"
            aria-label="Clear the captain’s log?"
          >
            <span className="xt-muted">Clear the log?</span>
            <button
              type="button"
              className="xt-btn tiny"
              data-testid="stats-clear-confirm"
              onClick={() => (clearStats(), setConfirming(false))}
            >
              Yes, clear
            </button>
            <button
              type="button"
              className="xt-btn ghost tiny"
              data-testid="stats-clear-cancel"
              onClick={() => setConfirming(false)}
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="xt-btn ghost tiny xt-stats-clear"
            data-testid="stats-clear"
            onClick={() => setConfirming(true)}
          >
            Clear log
          </button>
        ))}
    </section>
  );
}
