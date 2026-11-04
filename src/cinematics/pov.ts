import type { PlacedShip, Player } from '../engine'
import { playerDeck } from '../crew/playerPose'
import { DEFAULT_DECK, type DeckBusEvent, type DeckState } from '../deck/contract'
import { angleDelta, deckGun, gunnerPose, resolveDeckAnchors, stationsOf } from '../deck/math'
import { BOARD_LAYOUT, boardCenter, type Vec3 } from '../scene/layout'
import { SHIPS, damageOf, shipWorldTransform } from '../ships'
import { directionToWorld, localToWorld, type ShipPose, type WorldMuzzle } from '../vfx/cannon/anchors'
import { lastHitIndex, placedShipSeed, sectionSurfaceY, sinkPose } from '../vfx/sinking/pose'
import { sinkTimeAt } from '../vfx/sinking/timeline'
import { useGameStore } from '../store/gameStore'
import { isAfloat, ownBoardOrigin } from './battery'
import { beatEnd, type Sequence } from './sequence'
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
  /** Set when the incoming ball took the very section the player stood on (or the gun they manned): see `overboardFor`. */
  overboard?: OverboardBeat
  /** The director borrowed the camera for this sequence (follow-cam): the chase shows the impact, so no `look-at` nudges are emitted. */
  cameraBorrowed?: boolean
  /**
   * Another own ship sinks: how the player on deck gets to see it — a held `look-at` for the whole sink (`look`), or the
   * director borrows the camera because the wreck is hidden behind the standing ship's own masts / sails or beyond a
   * gunner's glance (`borrow`). See `sinkViewFor`.
   */
  sinkView?: SinkView
  /** World point the held look / borrowed camera is about (the sinking ship). */
  sinkTarget?: Vec3 | null
  /** Standing-ship sink: seconds into the sequence at which `abandon-ship` is emitted (`abandonAtFor`); `POV.abandonAt` until computed. */
  abandonAt?: number
}

export type SinkView = 'look' | 'borrow'

/** The thrown-overboard beat of one incoming hit. */
export interface OverboardBeat {
  /** Cell index (into `PlacedShip.cells`) the player stood on = the hit cell. */
  cell: number
  /** Where the player climbs aboard afterwards: the next afloat own ship, or this ship again when it is the last one. */
  nextUid: string
  /** Where the player stood (world) when the ball struck — splinters burst here. */
  point: Vec3
  /** Where the player hits the water (world, at the surface): over the nearest rail. */
  splashAt: Vec3
}

/**
 * The deck camera's world position, written each idle frame by `CinematicCamera` while the player is on deck (the director runs
 * outside the canvas and needs it to tell which hull section the player stands on). Null off deck.
 */
export const deckEye: { position: Vec3 | null } = { position: null }

/**
 * Where the player is (world, at eye height): the deck controller's published feet position on the standing ship
 * (`playerDeck`, ship-local), falling back to the deck camera's last idle position (demo page, no controller).
 */
export function playerEye(pov: PovContext): Vec3 | null {
  const ship = pov.standing
  if (ship && playerDeck.uid === ship.uid) {
    const anchors = SHIPS[ship.spec.id].anchors
    return localToWorld([playerDeck.x, anchors.deckY + 0.17, playerDeck.z], shipWorldTransform(ship, ownBoardOrigin(pov.perspective)))
  }
  return deckEye.position
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
  /** The swing toward a sinking ship; an own ship's sink re-issues it every tick so the look holds for the whole sink beat. */
  sinkLookSeconds: 1.2,
  /**
   * Earliest seconds into the sink of the standing ship at which `abandon-ship` is emitted. The real cue is the deck under the
   * player going awash (`abandonAtFor`), never earlier than this (skips / `off` emit it at once as before).
   */
  abandonAt: 1.5,
  /** The deck must be at most this far above the surface (ship units) under the player before the abandon fade may start. */
  awashY: 0.02,
  /** The deck stays visibly awash this long before the abandon-ship fade starts (eye at / below the waterline). */
  awashHold: 0.5,
  /**
   * An own ship sinking within this half-angle (radians) of the standing ship's long axis is hidden behind its own masts, sails
   * and castles from anywhere on deck, so the director borrows the camera instead of nudging the look.
   */
  sinkOccludedHalfAngle: 0.5,
  /** How far a gunner may glance off the barrel (mirrors the deck controller's gun glance), beyond which a held look cannot reach. */
  gunGlanceYaw: 0.7,
  /** Fractions of the overboard beat: tumbling off the deck until `tumble`, in the water until the fade (the rest). */
  overboardTumble: 0.35,
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
/**
 * The gun a deck chart shot leaves from: the manned station, else (walking) the usable gun nearest the player's feet on
 * the ship they stand on (`deckGun`), so firing is never from thin air. One pick shared by the recoil swing
 * (`mannedCannon`) and the cinematic (`stationBattery` / `stationMuzzle`).
 */
export function deckGunIndex(standing: PlacedShip, deck: DeckState, perspective: Player): number | null {
  const anchors = SHIPS[standing.spec.id].anchors
  if (deck.station !== null) return anchors.cannons[deck.station] ? deck.station : null
  const pose = shipWorldTransform(standing, ownBoardOrigin(perspective))
  const foe = boardCenter(BOARD_LAYOUT[perspective === 'human' ? 'enemy' : 'player'])
  const feet: Vec3 | undefined = playerDeck.uid === standing.uid ? [playerDeck.x, 0, playerDeck.z] : undefined
  return deckGun(stationsOf(anchors, resolveDeckAnchors(anchors, standing.spec.id)), null, pose.rotationY, pose.position, foe, feet)?.index ?? null
}

export function stationBattery(pov: PovContext | null): Battery | null {
  if (!pov || !pov.outgoing || !pov.standing) return null
  const index = deckGunIndex(pov.standing, pov.deck, pov.perspective)
  const cannon = index === null ? undefined : SHIPS[pov.standing.spec.id].anchors.cannons[index]
  if (!cannon) return null
  return { shipId: pov.standing.spec.id, uid: pov.standing.uid, side: cannon.side, cells: [cannon.cell] }
}

/** The manned gun's muzzle in world space (a cell can carry two guns a side; the player fires exactly this one). */
export function stationMuzzle(pov: PovContext | null, shooter: ShipPose | null): WorldMuzzle | null {
  if (!pov || !pov.outgoing || !pov.standing || !shooter) return null
  const index = deckGunIndex(pov.standing, pov.deck, pov.perspective)
  const c = index === null ? undefined : SHIPS[pov.standing.spec.id].anchors.cannons[index]
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
    if (!reducedMotion && !pov.cameraBorrowed) out.push({ type: 'look-at', point, seconds })
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

/**
 * The held look at another own ship going down: the director emits this every tick of the `sink` beat (the deck controller
 * restarts its swing timer on each one), so the look settles on the wreck in `sinkLookSeconds` and stays there — slow-mo,
 * water and sounds included — until the `return` beat frees the player. Null off the sink beat, for enemy sinks (the usual
 * one-off nudge), the standing ship (the deck itself goes under), reduced motion, or a borrowed camera (BUG-716).
 */
export function sinkHoldLook(event: CinematicEvent, pov: PovContext, beat: string | null, target: Vec3 | null, reducedMotion: boolean): DeckBusEvent | null {
  if (event.type !== 'sink' || beat !== 'sink' || !pov.ownSide || pov.standingHit || pov.cameraBorrowed || reducedMotion || !target) return null
  return { type: 'look-at', point: target, seconds: POV.sinkLookSeconds }
}

/**
 * How the player on deck gets to see another own ship sink, decided once per sequence without raycasts: `borrow` when the
 * wreck lies within `sinkOccludedHalfAngle` of the standing ship's long axis (own masts, sails and castles in the way), or
 * while manning a gun whose barrel points more than `gunGlanceYaw` away from it; otherwise a held `look-at` is enough.
 * Unknown eye position → `look`.
 */
export function sinkViewFor(pov: PovContext, target: Vec3, eye: Vec3 | null): SinkView {
  const ship = pov.standing
  if (!ship || !eye) return 'look'
  const pose = shipWorldTransform(ship, ownBoardOrigin(pov.perspective))
  const [ex, ez] = worldToLocal(eye, pose)
  const [tx, tz] = worldToLocal(target, pose)
  const dx = tx - ex
  const dz = tz - ez
  const len = Math.hypot(dx, dz)
  if (len < 1e-6) return 'look'
  if (Math.abs(dz) / len < Math.sin(POV.sinkOccludedHalfAngle)) return 'borrow'
  if (pov.deck.station !== null) {
    const anchors = SHIPS[ship.spec.id].anchors
    const st = stationsOf(anchors, resolveDeckAnchors(anchors, ship.spec.id))[pov.deck.station]
    if (st && Math.abs(angleDelta(gunnerPose(st).yaw, Math.atan2(-dx, -dz))) > POV.gunGlanceYaw) return 'borrow'
  }
  return 'look'
}

/**
 * Seconds into the standing ship's sink at which the deck under the player's feet goes awash (`sinkPose` is the very pose the
 * controller follows per frame), so the abandon-ship fade starts after the player has watched the deck tilt and go under.
 * Clamped to [`POV.abandonAt`, end of the sink beat]; `POV.abandonAt` when the sequence has no sink timeline.
 */
export function abandonAtFor(pov: PovContext, seq: Sequence): number {
  const ship = pov.standing
  if (!ship || !seq.sink) return POV.abandonAt
  const anchors = SHIPS[ship.spec.id].anchors
  const onIt = playerDeck.uid === ship.uid
  const x = onIt ? playerDeck.x : 0
  const z = onIt ? playerDeck.z : 0
  const input = { seed: placedShipSeed(ship), hull: anchors.hull, damage: damageOf(ship), lastHit: lastHitIndex(ship) }
  const above = (p: number) => sectionSurfaceY(sinkPose(p, input), x, anchors.deckY, z) > POV.awashY
  // depth is monotonic in progress: bisect for the first awash progress
  let lo = 0
  let hi = 1
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (above(mid)) lo = mid
    else hi = mid
  }
  const end = beatEnd(seq, 'sink') || seq.duration
  return Math.min(end, Math.max(POV.abandonAt, sinkTimeAt(hi, seq.sink) + POV.awashHold))
}

/** World position of a ship (sink / victory look-at targets). */
export function shipWorldPosition(ship: PlacedShip, owner: Player): Vec3 {
  const pose = shipWorldTransform(ship, ownBoardOrigin(owner))
  return [pose.position[0], pose.position[1] + SHIPS[ship.spec.id].anchors.deckY, pose.position[2]]
}

/**
 * Engine cell index (`ship.cells[i]`) under a ship-space x, clamped to the hull. `shipWorldTransform` puts the origin
 * cell at the stern (−x) — the opposite of the classes' bow-indexed `gunCell` (see `cannonEngineCell`).
 */
export function cellAtLocalX(x: number, length: number): number {
  return Math.min(length - 1, Math.max(0, Math.round(x + (length - 1) / 2)))
}

/** Ship-space x / z of a world point for a ship at `pose` (inverse of `localToWorld`). */
export function worldToLocal(point: Vec3, pose: ShipPose): [number, number] {
  const c = Math.cos(pose.rotationY)
  const sn = Math.sin(pose.rotationY)
  const dx = point[0] - pose.position[0]
  const dz = point[2] - pose.position[2]
  return [dx * c - dz * sn, dx * sn + dz * c]
}

/** Which hull section (cell index) of `ship` a world point is over. */
/** The classes index cannon cells from the bow (+x); the engine's `cells[]` run from the stern. */
export const cannonEngineCell = (cell: number, length: number): number => length - 1 - cell

export function standingCell(ship: PlacedShip, pose: ShipPose, point: Vec3): number {
  return cellAtLocalX(worldToLocal(point, pose)[0], ship.spec.length)
}

/** The section the player is on: the manned gun's cell, else the cell under the deck camera (null when neither is known). */
export function standingCellFor(pov: PovContext, eye: Vec3 | null): number | null {
  if (!pov.standing) return null
  const anchors = SHIPS[pov.standing.spec.id].anchors
  if (pov.deck.station !== null) {
    const c = anchors.cannons[pov.deck.station]
    if (c) return cannonEngineCell(c.cell, pov.standing.spec.length)
  }
  if (!eye) return null
  return standingCell(pov.standing, shipWorldTransform(pov.standing, ownBoardOrigin(pov.perspective)), eye)
}

/** Where to climb aboard after going overboard: the next afloat own ship after `hitUid` in fleet order; the same ship when it is the last afloat. */
export function overboardNextUid(own: readonly PlacedShip[], hitUid: string): string {
  return nextAfloatUid(own, hitUid) ?? hitUid
}

/**
 * The thrown-overboard beat for an incoming hit on the standing ship, or null when the ball took another section
 * (or the player's position is unknown). Lost-in-the-storm shots never reach here (they are not hits).
 */
export function overboardFor(pov: PovContext, event: CinematicEvent, own: readonly PlacedShip[], eye: Vec3 | null): OverboardBeat | null {
  if (event.type !== 'shot' || pov.outgoing || !pov.standingHit || !pov.standing) return null
  if (event.result.outcome !== 'hit' && event.result.outcome !== 'sunk') return null
  const ship = pov.standing
  const hitCell = ship.cells.findIndex((c) => c.x === event.result.coord.x && c.y === event.result.coord.y)
  const mine = standingCellFor(pov, eye)
  if (hitCell < 0 || mine === null || mine !== hitCell) return null
  const pose = shipWorldTransform(ship, ownBoardOrigin(pov.perspective))
  const anchors = SHIPS[ship.spec.id].anchors
  const [lx, lz] = eye ? worldToLocal(eye, pose) : [hitCell - (ship.spec.length - 1) / 2, 0]
  const side = lz < 0 ? -1 : 1
  const point: Vec3 = eye ?? localToWorld([lx, anchors.deckY + 0.17, 0], pose)
  const splash = localToWorld([lx, 0, side * (anchors.hull.beam / 2 + 0.6)], pose)
  return { cell: hitCell, nextUid: overboardNextUid(own, ship.uid), point, splashAt: [splash[0], BOARD_LAYOUT.surfaceY, splash[2]] }
}
