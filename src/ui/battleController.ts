import { create } from 'zustand'
import { playSfx } from '../audio'
import { director } from '../cinematics'
import { broadsideCells, coordLabel, hasBeenShot, type Coord, type ShotResult } from '../engine'
import { mannedCannon, SWING_DELAY_MS, useDeckStore } from '../deck'
import { isHotSeat, targetBoardKey, useGameStore } from '../store/gameStore'
import type { PowerFire } from './turnFlow'
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
  /** The shots of the current exchange (your volley, then the reply) for the assertive announcer, see `nextExchange`. */
  exchange: AnnouncedShot[]
  busy: boolean
  flow: TurnFlow | null
  start: () => void
  stop: () => void
  /** Fire from the HTML grid / confirm button. */
  fire: (coord: Coord, power?: PowerFire) => Promise<void>
  /** Fire or stage a target from the 3D board, depending on pointer type. */
  requestFire: (coord: Coord, pointerType?: string) => void
  /**
   * The one "click a square" path shared by the 2-D chart, the 3D enemy board and the deck crosshair: honours the armed
   * Black Flag power (Spyglass look / Broadside line / plain shot), refuses shot cells, and on deck requires a manned gun
   * (which swings first). `pointerType` adds the touch two-tap confirm of the 3D board.
   */
  aim: (coord: Coord, pointerType?: string) => void
  skip: () => void
}

let swingTimer: ReturnType<typeof setTimeout> | undefined

export interface AnnouncedShot {
  by: 'human' | 'enemy'
  result: ShotResult
}

/**
 * What the assertive live region reads after a shot. With reduced motion (or cinematics off) the reply lands 60–120 ms
 * after your own shot, so announcing only the latest shot replaced "You fired at A2" before a screen reader could say it
 * (BUG-724). Instead the region holds the whole exchange: your shots this turn, then the reply; it starts over when you
 * fire again after a reply.
 */
export function nextExchange(exchange: AnnouncedShot[], shot: AnnouncedShot): AnnouncedShot[] {
  const prev = exchange[exchange.length - 1]
  return shot.by === 'human' && prev?.by === 'enemy' ? [shot] : [...exchange, shot]
}

export const useBattleController = create<BattleControllerState>((set, get) => ({
  beat: { phase: 'idle' },
  last: null,
  exchange: [],
  busy: false,
  flow: null,

  start: () => {
    get().flow?.dispose()
    const flow = createTurnFlow({
      onBeat: (beat) => {
        const patch: Partial<BattleControllerState> = { beat }
        if (beat.phase === 'player-shot' && beat.result) patch.last = { by: 'human', result: beat.result }
        if (beat.phase === 'enemy-shot' && beat.result) patch.last = { by: 'enemy', result: beat.result }
        if (patch.last) patch.exchange = nextExchange(get().exchange, patch.last)
        if (beat.phase === 'intro') patch.busy = true
        if (beat.phase === 'done') patch.busy = false
        set(patch)
      },
    })
    set({ flow, beat: { phase: 'idle' }, last: null, exchange: [], busy: false })
    void flow.intro()
  },

  stop: () => {
    get().flow?.dispose()
    set({ flow: null, beat: { phase: 'idle' }, last: null, exchange: [], busy: false })
  },

  fire: async (coord, power) => {
    const { flow, busy, beat } = get()
    const game = useGameStore.getState()
    // a shot during the battle-start flyover skips it (the flow handles that); any other busy state ignores the click
    // hot-seat: the active captain (whose side is on screen) fires; single player: only the human
    const shooter = isHotSeat(game.players) ? game.perspective : 'human'
    if (!flow || (busy && beat.phase !== 'intro') || game.phase !== 'battle' || game.handoff || game.turn !== shooter) return
    useUiStore.getState().setPendingTarget(null)
    set({ busy: true })
    try {
      await flow.fire(coord, power)
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

  aim: (coord, pointerType) => {
    const game = useGameStore.getState()
    const ui = useUiStore.getState()
    const shooter = isHotSeat(game.players) ? game.perspective : 'human'
    const { busy, beat } = get()
    if (game.phase !== 'battle' || game.handoff || game.turn !== shooter || (busy && beat.phase !== 'intro')) return
    const foeBoard = game[targetBoardKey(shooter)]
    if (game.deck.on && !mannedCannon()) {
      useDeckStore.getState().showNudge('No gun bears — Tab to another ship')
      return playSfx('miss')
    }
    if (ui.armed === 'spyglass') {
      if (hasBeenShot(foeBoard, coord)) return playSfx('miss')
      const seen = game.spyAt(coord, shooter)
      if (!seen) return playSfx('miss')
      playSfx('ui-click')
      ui.setSpyNote(`Spyglass ${coordLabel(coord)} — ${seen === 'ship' ? 'a ship!' : 'open water.'}`)
      ui.setArmed('shot')
      return
    }
    ui.setSpyNote(null)
    let shoot: () => void
    if (ui.armed === 'broadside') {
      if (!broadsideCells(coord, ui.broadsideDir, foeBoard.size).some((b) => !hasBeenShot(foeBoard, b))) return playSfx('miss')
      const orientation = ui.broadsideDir
      ui.setArmed('shot')
      shoot = () => void get().fire(coord, { kind: 'broadside', orientation })
    } else {
      if (hasBeenShot(foeBoard, coord)) return playSfx('miss')
      const touch = pointerType === 'touch' || (pointerType !== undefined && pointerType === '' && window.matchMedia?.('(pointer: coarse)').matches)
      if (touch) return get().requestFire(coord, 'touch')
      shoot = () => void get().fire(coord)
    }
    // on deck the gun the shot leaves from (manned, else the usable one beside you) swings to bear (the fleet's `firing`
    // recoil) before the shot resolves — same odds, just a beat later
    const gun = mannedCannon()
    if (!gun || swingTimer) return shoot()
    director.store.setState({ firing: { [gun.uid]: [{ cell: gun.cell, side: gun.side }] } })
    swingTimer = setTimeout(() => {
      swingTimer = undefined
      shoot()
    }, SWING_DELAY_MS)
  },

  skip: () => get().flow?.skip(),
}))
