import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import type { ShotResult } from '../engine'
import { useGameStore } from '../store/gameStore'
import { director as defaultDirector, type Director } from './director'
import type { CinematicEvent } from './types'

export interface BattleCinematics {
  director: Director
  /** True while a sequence plays — feed `<OceanScene cameraOverride>`. */
  busy: boolean
  /** Resolves when every queued sequence has finished; await it before `enemyTurn()`. */
  idle(): Promise<void>
  /** `shots` minus the one whose ball is still in the air, so markers / damage appear on impact rather than on click. */
  visibleShots(shots: readonly ShotResult[]): readonly ShotResult[]
}

export interface UseBattleCinematicsOptions {
  director?: Director
  /** Default true; false plays nothing (the hook still tracks events so nothing replays when re-enabled). */
  enabled?: boolean
}

/**
 * Subscribes to the game store and plays the matching sequence for everything that happens: a flyover when
 * the battle starts, a shot (plus a sink when it sank a ship) for every new `events` entry, and the victory
 * flyover at game over. Sequences queue in order and use `settings.cinematics` (`full` / `fast` / `off`).
 *
 *   const cine = useBattleCinematics()
 *   <OceanScene cameraOverride={cine.busy}> … <CinematicLayer /> <CinematicCamera /> </OceanScene> <Letterbox />
 *   await cine.idle(); enemyTurn()
 */
export function useBattleCinematics({ director = defaultDirector, enabled = true }: UseBattleCinematicsOptions = {}): BattleCinematics {
  const events = useGameStore((s) => s.events)
  const phase = useGameStore((s) => s.phase)
  const winner = useGameStore((s) => s.winner)
  const busy = useStore(director.store, (s) => s.busy)
  const impacted = useStore(director.store, (s) => s.impacted)
  const active = useStore(director.store, (s) => s.active)
  const lastId = useRef(events.length ? events[events.length - 1].id : 0)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const seenPhase = useRef(phase)

  const enqueue = (ev: CinematicEvent) => {
    const level = useGameStore.getState().settings.cinematics
    queue.current = queue.current.then(() => director.play(ev, level)).catch(() => undefined)
  }

  useEffect(() => {
    const fresh = events.filter((e) => e.id > lastId.current)
    if (fresh.length) lastId.current = fresh[fresh.length - 1].id
    if (!enabled) return
    for (const e of fresh) {
      enqueue({ type: 'shot', by: e.by, target: e.result.coord, result: e.result })
      if (e.result.outcome === 'sunk' && e.result.shipId) enqueue({ type: 'sink', owner: e.by === 'human' ? 'enemy' : 'human', shipId: e.result.shipId, uid: e.result.shipUid ?? e.result.shipId })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, enabled])

  useEffect(() => {
    const prev = seenPhase.current
    seenPhase.current = phase
    if (!enabled || prev === phase) return
    if (phase === 'battle') enqueue({ type: 'battle-start' })
    if (phase === 'gameover' && winner) enqueue({ type: 'victory', winner })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, winner, enabled])

  const pending = active?.event.type === 'shot' && !impacted ? active.event.result : null
  return {
    director,
    busy,
    idle: () => queue.current,
    visibleShots: (shots) => (pending ? shots.filter((s) => !(s.coord.x === pending.coord.x && s.coord.y === pending.coord.y)) : shots),
  }
}
