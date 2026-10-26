import { create } from 'zustand'
import type { Coord, ShotResult } from '../engine'
import { useGameStore } from '../store/gameStore'
import { createTurnFlow, type TurnBeat, type TurnFlow } from './turnFlow'
import { useUiStore } from './uiStore'

/**
 * One battle controller shared by the HTML HUD and the 3D world: both fire through `requestFire`,
 * both read the current beat for the status line. Touch taps on the 3D board set a pending target
 * that a second tap (or the Fire button) confirms.
 */
interface BattleControllerState {
  beat: TurnBeat
  /** The most recent shot by either side, for the status line / flash. */
  last: { by: 'human' | 'enemy'; result: ShotResult } | null
  busy: boolean
  flow: TurnFlow | null
  start: () => void
  stop: () => void
  /** Fire from the HTML grid / confirm button. */
  fire: (coord: Coord) => Promise<void>
  /** Fire or stage a target from the 3D board, depending on pointer type. */
  requestFire: (coord: Coord, pointerType?: string) => void
  skip: () => void
}

export const useBattleController = create<BattleControllerState>((set, get) => ({
  beat: { phase: 'idle' },
  last: null,
  busy: false,
  flow: null,

  start: () => {
    get().flow?.dispose()
    const flow = createTurnFlow({
      onBeat: (beat) => {
        const patch: Partial<BattleControllerState> = { beat }
        if (beat.phase === 'player-shot' && beat.result) patch.last = { by: 'human', result: beat.result }
        if (beat.phase === 'enemy-shot' && beat.result) patch.last = { by: 'enemy', result: beat.result }
        if (beat.phase === 'intro') patch.busy = true
        if (beat.phase === 'done') patch.busy = false
        set(patch)
      },
    })
    set({ flow, beat: { phase: 'idle' }, last: null, busy: false })
    void flow.intro()
  },

  stop: () => {
    get().flow?.dispose()
    set({ flow: null, beat: { phase: 'idle' }, last: null, busy: false })
  },

  fire: async (coord) => {
    const { flow, busy, beat } = get()
    const game = useGameStore.getState()
    // a shot during the battle-start flyover skips it (the flow handles that); any other busy state ignores the click
    if (!flow || (busy && beat.phase !== 'intro') || game.phase !== 'battle' || game.turn !== 'human') return
    useUiStore.getState().setPendingTarget(null)
    set({ busy: true })
    try {
      await flow.fire(coord)
    } finally {
      set({ busy: false })
    }
  },

  requestFire: (coord, pointerType) => {
    const ui = useUiStore.getState()
    const touch = pointerType === 'touch' || (pointerType === undefined && window.matchMedia?.('(pointer: coarse)').matches)
    if (!touch) return void get().fire(coord)
    const pending = ui.pendingTarget
    if (pending && pending.x === coord.x && pending.y === coord.y) void get().fire(coord)
    else ui.setPendingTarget(coord)
  },

  skip: () => get().flow?.skip(),
}))
