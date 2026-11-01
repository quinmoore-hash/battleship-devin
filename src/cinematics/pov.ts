import type { PlacedShip, Player } from '../engine'
import { DEFAULT_DECK, type DeckBusEvent, type DeckState } from '../deck/contract'
import type { Vec3 } from '../scene/layout'
import { SHIPS, shipWorldTransform } from '../ships'
import { directionToWorld, localToWorld, type ShipPose, type WorldMuzzle } from '../vfx/cannon/anchors'
import { useGameStore } from '../store/gameStore'
import { isAfloat, ownBoardOrigin } from './battery'
import type { Battery, CinematicEvent } from './types'

/**
 * "On deck" point-of-view branch of the director. When `deck.on` the camera belongs to the deck controller
 * (`src/deck`), so a sequence drives VFX/audio only and talks to the controller through `deckBus`. Pure helpers
 * here; the director calls them per beat. Nothing in this file runs while `deck.on` is false.
 */
export interface PovContext {
  deck: DeckState
  perspective: Player
  /** The own afloat ship the player stands on (the deck's `shipUid`, or the first afloat own ship). */
  standing: PlacedShip | null
  /** Shot fired by the perspective captain (from the deck). */
  outgoing: boolean
  /** The event lands on the perspective's own fleet (incoming shot, own sink). */
  ownSide: boolean
  /** The hit / sink is the very ship the player stands on. */
  standingHit: boolean
  /** `abandon-ship` already emitted for this sequence. */
  abandoned: boolean
}

export const POV = {
  /** `shake` on your own gun firing. */
  fireShake: 0.3,
  /** `shake` when the ship you stand on takes a ball. */
  hitShake: 1,
  hitShakeSeconds: 0.6,
  /** `shake` when another own ship is hit / a ball splashes on your waters. */
  nearShake: 0.35,
  nearMissShake: 0.15,
  /** `shake` when your own ball lands. */
  farShake: 0.08,
  lookSeconds: 0.6,
  sinkLookSeconds: 1.2,
  /** Seconds into the sink of the standing ship before `abandon-ship` is emitted. */
  abandonAt: 1.5,
} as const

type FleetsLike = Record<Player, readonly PlacedShip[]>

/**
 * The deck slice as the store exposes it (`useGameStore().deck`, Session A) or `DEFAULT_DECK` before it lands.
 * `?deck-pov[=uid[:station]]` forces the branch on for perf/VFX checks without the controller.
 */
export function readDeckState(): DeckState {
  // `?cinematics-demo&deck-pov=<uid>:<station>`: the demo page has no battle (the store drops the seat outside one), so it fakes the slice
  if (typeof location !== 'undefined' && location.search.includes('cinematics-demo')) {
    const q = new URLSearchParams(location.search).get('deck-pov')
    if (q !== null) {
      const [uid, station] = q.split(':')
      return { on: true, shipUid: uid || null, station: station ? Number(station) : null }
    }
  }
  return useGameStore.getState().deck ?? DEFAULT_DECK
}

/** Which ship the player stands on: the deck's `shipUid` while it is afloat, else the first afloat own ship. */
export function standingShip(own: readonly PlacedShip[], deck: DeckState, eventUid?: string): PlacedShip | null {
  const chosen = deck.shipUid ? own.find((s) => s.uid === deck.shipUid) : undefined
  // the ship this event is about may already be marked sunk in the snapshot (the sinking shot / sink event): we are still standing on it
  if (chosen && (isAfloat(chosen) || chosen.uid === eventUid)) return chosen
  return own.find(isAfloat) ?? null
}

/** The own ship a cinematic event is about (the hit / sunk ship), if any. */
function eventShipUid(event: CinematicEvent): string | undefined {
  if (event.type === 'shot') return event.result.shipUid ?? event.result.shipId
  if (event.type === 'sink') return event.uid ?? event.shipId
  return undefined
}

/** Null unless the deck is on; otherwise what this event means to the player standing on deck. */
export function povFor(event: CinematicEvent, deck: DeckState, fleets: FleetsLike, perspective: Player): PovContext | null {
  if (!deck.on) return null
  const own = fleets[perspective]
  const standing = standingShip(own, deck, eventShipUid(event))
  const ctx: PovContext = { deck, perspective, standing, outgoing: false, ownSide: false, standingHit: false, abandoned: false }
  if (event.type === 'shot') {
    ctx.outgoing = event.by === perspective
    ctx.ownSide = !ctx.outgoing
    const victim = event.result.shipUid ?? event.result.shipId
    ctx.standingHit = ctx.ownSide && (event.result.outcome === 'hit' || event.result.outcome === 'sunk') && !!standing && victim === standing.uid
  } else if (event.type === 'sink') {
    ctx.ownSide = event.owner === perspective
    ctx.standingHit = ctx.ownSide && !!standing && (event.uid ?? event.shipId) === standing.uid
  }
  return ctx
}

/** The manned gun as a one-cannon battery (outgoing shots only); null → the director's usual battery pick. */
export function stationBattery(pov: PovContext | null): Battery | null {
  if (!pov || !pov.outgoing || !pov.standing || pov.deck.station === null) return null
  const cannon = SHIPS[pov.standing.spec.id].anchors.cannons[pov.deck.station]
  if (!cannon) return null
  return { shipId: pov.standing.spec.id, uid: pov.standing.uid, side: cannon.side, cells: [cannon.cell] }
}

/** The manned gun's muzzle in world space (a cell can carry two guns a side; the player fires exactly this one). */
export function stationMuzzle(pov: PovContext | null, shooter: ShipPose | null): WorldMuzzle | null {
  if (!pov || !pov.outgoing || !pov.standing || pov.deck.station === null || !shooter) return null
  const c = SHIPS[pov.standing.spec.id].anchors.cannons[pov.deck.station]
  if (!c) return null
  return { cell: c.cell, side: c.side, position: localToWorld(c.muzzle, shooter), direction: directionToWorld(c.direction, shooter.rotationY) }
}

/** The ship to wake up on after `sinking` goes down: the next afloat own ship in fleet order (wrapping), or null. */
export function nextAfloatUid(own: readonly PlacedShip[], sinking: string): string | null {
  const i = own.findIndex((s) => s.uid === sinking)
  const n = own.length
  for (let k = 1; k <= n; k++) {
    const s = own[(Math.max(0, i) + k) % n]
    if (s.uid !== sinking && isAfloat(s)) return s.uid
  }
  return null
}

const shake = (intensity: number, seconds: number, reducedMotion: boolean): DeckBusEvent => ({ type: 'shake', intensity: reducedMotion ? 0 : intensity, seconds })

/**
 * Deck-bus events for entering `beat` of `event` on deck. Reduced motion keeps the beats but zeroes every shake and
 * drops every `look-at`.
 */
export function povBeatEvents(
  event: CinematicEvent,
  pov: PovContext,
  beat: string | null,
  impact: Vec3 | null,
  reducedMotion: boolean,
): DeckBusEvent[] {
  const out: DeckBusEvent[] = []
  const look = (point: Vec3, seconds: number) => {
    if (!reducedMotion) out.push({ type: 'look-at', point, seconds })
  }
  if (event.type === 'shot') {
    if (beat === 'fire' && pov.outgoing) out.push(shake(POV.fireShake, 0.3, reducedMotion))
    if (beat === 'impact' && impact) {
      look(impact, POV.lookSeconds)
      const outcome = event.result.outcome
      const landed = outcome === 'hit' || outcome === 'sunk'
      if (pov.standingHit) out.push(shake(POV.hitShake, POV.hitShakeSeconds, reducedMotion))
      else if (pov.ownSide) out.push(shake(landed ? POV.nearShake : POV.nearMissShake, 0.4, reducedMotion))
      else if (landed) out.push(shake(POV.farShake, 0.25, reducedMotion))
    }
  } else if (event.type === 'sink' && beat === 'sink' && !pov.standingHit) {
    if (impact) look(impact, POV.sinkLookSeconds)
  } else if (event.type === 'victory' && beat === 'flyover' && impact) {
    look(impact, POV.sinkLookSeconds)
  }
  return out
}

/** World position of a ship (sink / victory look-at targets). */
export function shipWorldPosition(ship: PlacedShip, owner: Player): Vec3 {
  const pose = shipWorldTransform(ship, ownBoardOrigin(owner))
  return [pose.position[0], pose.position[1] + SHIPS[ship.spec.id].anchors.deckY, pose.position[2]]
}
