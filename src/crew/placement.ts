/**
 * Deterministic crew placement on a ship's deck, in ship-local space (bow +x, waterline y = 0, starboard +z).
 * Pure functions: the same ship + seed always yields the same crew, so both boards, the deck controller and the
 * tests agree on where everyone stands.
 */
import type { ShipAnchors } from '../ships/types'
import type { ShipId } from '../engine'
import { resolveDeckAnchors, stationsOf, clampToPolygon, pushOutOfObstacles, levelAt, deckHeightAt, yawToward, dist, type Pt, type Station } from '../deck/math'
import type { DeckAnchors } from '../deck/contract'
import { cellX } from '../vfx/sinking/pose'
import type { AnimName } from './anim'

export type CrewRole = 'gunner' | 'lookout' | 'helm' | 'rail' | 'swab'

export interface CrewSlot {
  role: CrewRole
  anim: AnimName
  x: number
  y: number
  z: number
  yaw: number
  /** Hull cell (0 = bow) the figure stands over. */
  cell: number
  /** Cannon station index for gunners, else −1. */
  station: number
  /** Colour variant 0..n, deterministic per figure. */
  variant: number
}

/** Crew per ship class at Medium/High. */
export const CREW_COUNT: Record<ShipId, number> = { sloop: 3, brigantine: 4, frigate: 5, galleon: 6, 'man-o-war': 8 }
/** Crew per ship on the Low tier. */
export const LOW_TIER_CREW = 2
export const MAX_CREW = 8
/** Minimum distance kept from the player's spawn / current position (and from each other, below). */
export const PLAYER_CLEARANCE = 0.35
export const CREW_SPACING = 0.12
/** Figure footprint radius for obstacle pushing. */
export const CREW_RADIUS = 0.04

/** mulberry32: a tiny deterministic PRNG. */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const crewCountFor = (id: ShipId, low: boolean): number => (low ? LOW_TIER_CREW : CREW_COUNT[id])

/** Hull cell under local x (clamped). */
export const cellOfX = (x: number, length: number): number => Math.min(length - 1, Math.max(0, Math.floor(length / 2 - x)))

interface Candidate {
  role: CrewRole
  anim: AnimName
  p: Pt
  y?: number
  yaw: number
  station: number
}

function settle(c: Candidate, deck: DeckAnchors, taken: Pt[], avoid: Pt | null): Pt | null {
  let p: Pt = c.p
  const level = levelAt(p, deck, 0)
  if (level < 0 && deck.walk[0]) p = clampToPolygon(p, deck.walk[0].points)
  p = pushOutOfObstacles(p, deck.obstacles, CREW_RADIUS)
  if (avoid && dist(p, avoid) < PLAYER_CLEARANCE) return null
  for (const t of taken) if (dist(p, t) < CREW_SPACING) return null
  return p
}

/**
 * Place `count` crew on the ship described by `anchors` (gunners first at the cannon stations, one lookout at the
 * foremast foot, a helmsman aft, the rest at the rails and swabbing the waist). `avoid` is the player's position to
 * keep ≥ `PLAYER_CLEARANCE` from (defaults to the deck spawn).
 */
export function placeCrew(anchors: ShipAnchors & { deck?: DeckAnchors }, seed: number, count: number, avoid: Pt | null = null): CrewSlot[] {
  const deck = resolveDeckAnchors(anchors)
  const random = rng(seed)
  const n = Math.min(MAX_CREW, Math.max(0, count))
  const { length, beam } = anchors.hull
  const hx = length / 2
  const spawn: Pt = avoid ?? [deck.spawn[0], deck.spawn[2]]
  const taken: Pt[] = []
  const out: CrewSlot[] = []

  const push = (c: Candidate) => {
    if (out.length >= n) return false
    const p = settle(c, deck, taken, spawn)
    if (!p) return false
    const level = Math.max(0, levelAt(p, deck, 0))
    const y = c.y ?? deckHeightAt(p, level, deck)
    taken.push(p)
    out.push({ role: c.role, anim: c.anim, x: p[0], y, z: p[1], yaw: c.yaw, cell: cellOfX(p[0], length), station: c.station, variant: Math.floor(random() * 6) })
    return true
  }

  // Gunners: about half the crew, spread across the on-deck stations, alternating sides.
  const stations = stationsOf(anchors, deck).filter((s) => s.onDeck)
  const gunners = n <= 2 ? 1 : Math.max(1, Math.floor(n / 2) - 1)
  const picked = pickStations(stations, gunners, random)
  for (const s of picked) push({ role: 'gunner', anim: 'gunner', p: [s.stand[0], s.stand[2]], y: s.stand[1], yaw: s.yaw, station: s.index })

  // Lookout at the foremast foot (bow side), on whatever deck level the mast rises from.
  const masts = [...anchors.masts].sort((a, b) => b.base[0] - a.base[0])
  const fore = masts[0]
  if (fore) push({ role: 'lookout', anim: 'lookout', p: [fore.base[0] + 0.13, fore.base[2] + 0.02], y: Math.max(fore.base[1], anchors.deckY), yaw: yawToward(1, 0), station: -1 })
  else push({ role: 'lookout', anim: 'lookout', p: [hx - 0.25, 0], yaw: yawToward(1, 0), station: -1 })

  // Helmsman aft of the aftmost mast when there are two or more masts.
  const aft = masts[masts.length - 1]
  if (masts.length >= 2 && aft) push({ role: 'helm', anim: 'idle', p: [aft.base[0] - 0.16, aft.base[2]], y: Math.max(aft.base[1], anchors.deckY), yaw: yawToward(1, 0), station: -1 })

  // Everyone else: rails (hauling rope, facing outboard) and swabbing the waist, with a few retries per figure.
  let tries = 0
  while (out.length < n && tries < 40) {
    tries++
    const rail = tries % 2 === 1
    const x = -0.28 * length + random() * 0.56 * length
    if (rail) {
      const side = random() < 0.5 ? -1 : 1
      const z = side * (beam / 2 - 0.1)
      push({ role: 'rail', anim: 'haul', p: [x, z], yaw: yawToward(0, side), station: -1 })
    } else {
      const z = (random() - 0.5) * Math.max(0.1, beam * 0.4)
      push({ role: 'swab', anim: 'swab', p: [x, z], yaw: yawToward(random() - 0.5, random() - 0.5), station: -1 })
    }
  }
  return out
}

function pickStations(stations: Station[], count: number, random: () => number): Station[] {
  if (stations.length === 0 || count <= 0) return []
  const port = stations.filter((s) => s.side === 'port').sort((a, b) => a.cell - b.cell)
  const star = stations.filter((s) => s.side === 'starboard').sort((a, b) => a.cell - b.cell)
  const out: Station[] = []
  const used = new Set<number>()
  let side = random() < 0.5 ? 0 : 1
  for (let i = 0; i < count && used.size < stations.length; i++) {
    const pool = (side === 0 ? port : star).filter((s) => !used.has(s.index))
    const alt = (side === 0 ? star : port).filter((s) => !used.has(s.index))
    const from = pool.length ? pool : alt
    if (!from.length) break
    // Spread along the hull: walk the sorted list with a seeded stride.
    const s = from[Math.floor(random() * from.length)]
    used.add(s.index)
    out.push(s)
    side = 1 - side
  }
  return out
}

export interface HitReaction {
  /** Slot index thrown overboard, or −1 when nobody is near enough. */
  thrown: number
  /** Slot indices that stumble/crouch. */
  stumble: number[]
}

/**
 * Who reacts to a hit on `hitCell`: figures within ~1 cell of the hit along the hull. The nearest one is thrown
 * over the rail; the others stumble. `gone` marks slots already overboard (ignored).
 */
export function reactionFor(slots: readonly CrewSlot[], hitCell: number, length: number, gone: readonly boolean[] = []): HitReaction {
  const hx = cellX(hitCell, length)
  let thrown = -1
  let best = Infinity
  const stumble: number[] = []
  for (let i = 0; i < slots.length; i++) {
    if (gone[i]) continue
    const d = Math.abs(slots[i].x - hx)
    if (d > 1.05) continue
    stumble.push(i)
    if (d < best) {
      best = d
      thrown = i
    }
  }
  const idx = stumble.indexOf(thrown)
  if (idx >= 0) stumble.splice(idx, 1)
  return { thrown, stumble }
}

/** Direction (ship-local z sign) a figure at `z` is thrown: toward the nearest rail. */
export const overboardSide = (z: number): 1 | -1 => (z >= 0 ? 1 : -1)
