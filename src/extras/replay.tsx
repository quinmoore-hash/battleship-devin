/**
 * Battle replay.
 *
 *   <ReplayPlayer snapshot onClose? autoPlay? />    full-screen 3D replay with play/pause, speed and stepping
 *   useReplay()                                     { snapshot, isOpen, open(snapshot?), close }
 *   requestReplay(snapshot?)                        dispatches `battleship:replay` (the UI's game-over screen does this)
 *
 * `<ExtrasLayer>` listens for the window event and mounts the player over the game. Without a snapshot the current
 * store state is captured (`snapshotFromState`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { GOLDEN_HOUR, OceanScene } from '../scene'
import { useGameStore } from '../store/gameStore'
import { usePerf } from '../perf'
import { Battlefield } from './Battlefield'
import { createOverlayStore, useOverlay, useWindowEvent } from './overlay'
import { REPLAY_SPEEDS, battlefieldLod, buildFrames, clampStep, describeEvent, shotCounts, snapshotFromState, stepIntervalMs, type ReplaySnapshot, type ReplaySpeed } from './replayModel'
import './extras.css'

export const REPLAY_EVENT = 'battleship:replay'

const replayStore = createOverlayStore<ReplaySnapshot>()

export function openReplay(snapshot: ReplaySnapshot = snapshotFromState(useGameStore.getState())) {
  replayStore.open(snapshot)
}
export const closeReplay = () => replayStore.close()

export function requestReplay(snapshot?: ReplaySnapshot) {
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT, { detail: snapshot }))
}

export function useReplay() {
  const snapshot = useOverlay(replayStore)
  return useMemo(() => ({ snapshot, isOpen: snapshot !== null, open: openReplay, close: closeReplay }), [snapshot])
}

/** Opens the replay whenever `battleship:replay` fires (detail: optional `ReplaySnapshot`). */
export function useReplayEvent() {
  useWindowEvent<ReplaySnapshot>(REPLAY_EVENT, (detail) => openReplay(detail ?? undefined))
}

export interface ReplayPlayerProps {
  snapshot: ReplaySnapshot
  onClose?: () => void
  autoPlay?: boolean
  initialSpeed?: ReplaySpeed
  /** Start at this step (0 = before the first shot). */
  initialStep?: number
  quality?: 'low' | 'high'
}

export function ReplayPlayer({ snapshot, onClose, autoPlay = true, initialSpeed = 1, initialStep = 0, quality }: ReplayPlayerProps) {
  const frames = useMemo(() => buildFrames(snapshot), [snapshot])
  const total = snapshot.events.length
  const [step, setStepRaw] = useState(() => clampStep(initialStep, total))
  const [playing, setPlaying] = useState(autoPlay && total > 0)
  const [speed, setSpeed] = useState<ReplaySpeed>(initialSpeed)
  const setStep = useCallback((s: number) => setStepRaw(clampStep(s, total)), [total])

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      setStepRaw((s) => {
        if (s >= total) {
          setPlaying(false)
          return s
        }
        return s + 1
      })
    }, stepIntervalMs(speed))
    return () => window.clearInterval(id)
  }, [playing, speed, total])

  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p && step >= total) {
        setStepRaw(0)
        return true
      }
      return !p
    })
  }, [step, total])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      const jump = (to: number) => {
        setPlaying(false)
        setStep(to)
      }
      if (e.key === ' ') {
        e.preventDefault()
        toggle()
      } else if (e.key === 'ArrowRight') jump(step + 1)
      else if (e.key === 'ArrowLeft') jump(step - 1)
      else if (e.key === 'Home') jump(0)
      else if (e.key === 'End') jump(total)
      else if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle, setStep, step, total, onClose])

  const boards = frames[step]
  // Same budget as the live battle (BUG-317): the tier's quality and lod, never below the baked lod 1
  const perf = usePerf()
  const q = quality ?? perf.quality
  const lod = battlefieldLod('replay', perf.lod, q)
  const event = step > 0 ? snapshot.events[step - 1] : null
  const counts = shotCounts(snapshot.events, step)
  const outcome = snapshot.winner === 'human' ? 'Victory' : snapshot.winner === 'enemy' ? 'Defeat' : 'Unfinished'

  return (
    <div className="xt-overlay" data-testid="replay-player" data-step={step} data-total={total} data-playing={playing}>
      <OceanScene view="battle" interactive weather={snapshot.modes?.storm ? 'stormy' : 'calm'} timeOfDay={GOLDEN_HOUR} quality={quality}>
        <Battlefield boards={boards} lod={lod} quality={q} />
      </OceanScene>

      <header className="xt-topbar">
        <div className="xt-title">
          <span className="xt-eyebrow">Battle replay</span>
          <strong>
            {outcome} · {snapshot.difficulty} · {total} shots
          </strong>
        </div>
        {onClose && (
          <button type="button" className="xt-btn ghost" data-testid="replay-close" onClick={onClose}>
            Close ✕
          </button>
        )}
      </header>

      <section className="xt-panel xt-replay-controls" aria-label="Replay controls">
        <p className="xt-caption" data-testid="replay-caption" aria-live="polite">
          {event ? describeEvent(event) : 'Fleets in position — press play'}
          <span className="xt-muted">
            {' '}
            · you {counts.human} · Devin {counts.enemy}
          </span>
        </p>
        <div className="xt-transport">
          <button type="button" className="xt-btn icon" aria-label="Restart" data-testid="replay-start" onClick={() => (setPlaying(false), setStep(0))}>
            |◀
          </button>
          <button type="button" className="xt-btn icon" aria-label="Previous shot" data-testid="replay-prev" onClick={() => (setPlaying(false), setStep(step - 1))}>
            ◀
          </button>
          <button type="button" className="xt-btn primary icon" aria-label={playing ? 'Pause' : 'Play'} data-testid="replay-toggle" onClick={toggle}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button type="button" className="xt-btn icon" aria-label="Next shot" data-testid="replay-next" onClick={() => (setPlaying(false), setStep(step + 1))}>
            ▶
          </button>
          <button type="button" className="xt-btn icon" aria-label="Jump to end" data-testid="replay-end" onClick={() => (setPlaying(false), setStep(total))}>
            ▶|
          </button>
          <input
            className="xt-range xt-scrub"
            type="range"
            min={0}
            max={total}
            step={1}
            value={step}
            aria-label="Replay position"
            data-testid="replay-scrub"
            onChange={(e) => (setPlaying(false), setStep(Number(e.target.value)))}
          />
          <span className="xt-counter" data-testid="replay-counter">
            {step}/{total}
          </span>
          <div className="xt-speeds" role="group" aria-label="Speed">
            {REPLAY_SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                className={`xt-btn small${s === speed ? ' active' : ''}`}
                aria-pressed={s === speed}
                data-testid={`replay-speed-${s}`}
                onClick={() => setSpeed(s)}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
        <p className="xt-hint">Space play/pause · ←/→ step · drag to orbit · wheel to zoom</p>
      </section>
    </div>
  )
}
