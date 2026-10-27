import { useMemo } from 'react'
import type { PlacedShip } from '../../engine'
import { coordKey } from '../../engine'
import { BOARD_LAYOUT, cellToWorld, type Vec3 } from '../../scene/layout'
import { SHIPS, shipWorldTransform } from '../../ships'
import type { Side } from '../../ships/types'
import { hashString } from '../random'
import { HullBreach } from './HullBreach'
import { Fires, Smokes, type FireEmitter, type SmokeEmitter } from './FireField'
import { useParticlesScale } from '../../perf/store'

export interface DamageLayerProps {
  ships: PlacedShip[]
  boardOrigin?: Vec3
  cellSize?: number
  /** Render fires on hit cells (default true). Sunk ships only smoulder. */
  fires?: boolean
  smoke?: boolean
  /** Render hull breaches at the ship's `impactPoints` for hit cells. `null` disables. */
  breachSide?: Side | 'both' | null
}

interface Entry {
  key: string
  deck: Vec3
  seed: number
  sunk: boolean
  breaches: { position: Vec3; normal: Vec3; seed: number }[]
}

function rotY(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
}

/**
 * The impact point for cell `idx` of a ship with `length` cells: the one nearest the cell's local x
 * (`cells[0]` is at the stern, −x; `cells[length-1]` at the bow, +x per ARCHITECTURE.md), so a model
 * that lists its points bow-first still gets the breach on the right cell.
 */
export function impactPointFor(points: readonly Vec3[], idx: number, length: number, cellSize = 1): Vec3 | undefined {
  if (points.length === 0) return undefined
  const localX = (idx - (length - 1) / 2) * cellSize
  let best = points[0]
  for (const p of points) if (Math.abs(p[0] - localX) < Math.abs(best[0] - localX)) best = p
  return best
}

/** Pure: everything the layer renders for a fleet, so the per-frame cost is only the effects themselves. */
export function damageEntries(ships: PlacedShip[], boardOrigin: Vec3, cellSize: number, breachSide: Side | 'both' | null): Entry[] {
  const out: Entry[] = []
  for (const ship of ships) {
    if (ship.hits.length === 0) continue
    const def = SHIPS[ship.spec.id]
    const { position, rotationY } = shipWorldTransform(ship, boardOrigin, cellSize)
    const sunk = ship.hits.length >= ship.spec.length
    for (const hit of ship.hits) {
      const idx = ship.cells.findIndex((c) => c.x === hit.x && c.y === hit.y)
      if (idx < 0) continue
      const key = `${ship.uid}:${coordKey(hit)}`
      const seed = hashString(key)
      const centre = cellToWorld(hit, boardOrigin, cellSize)
      const jitter = ((seed % 100) / 100 - 0.5) * 0.3
      // a sunk ship has left the deck height behind: smoulder at the waterline instead
      const deckY = sunk ? boardOrigin[1] + 0.05 : boardOrigin[1] + def.anchors.deckY
      const deck: Vec3 = [centre[0] + (ship.orientation === 'vertical' ? jitter : 0), deckY, centre[2] + (ship.orientation === 'horizontal' ? jitter : 0)]
      const breaches: Entry['breaches'] = []
      const ip = impactPointFor(def.anchors.impactPoints, idx, ship.spec.length, cellSize)
      if (ip && breachSide && !sunk) {
        const sides: Side[] = breachSide === 'both' ? ['port', 'starboard'] : [breachSide]
        for (const side of sides) {
          const local: Vec3 = [ip[0], ip[1], side === 'port' ? ip[2] : -ip[2]]
          const n: Vec3 = [0, 0, side === 'port' ? -1 : 1]
          const w = rotY(local, rotationY)
          breaches.push({ position: [position[0] + w[0], position[1] + w[1], position[2] + w[2]], normal: rotY(n, rotationY), seed: seed + (side === 'port' ? 0 : 1) })
        }
      }
      out.push({ key, deck, seed, sunk, breaches })
    }
  }
  return out
}

/**
 * Convenience layer: for every hit cell of every ship, a fire + smoke column on the deck (using the
 * class's `anchors.deckY`) and a hull breach at its impact point. Sunk ships only smoulder at the
 * waterline (the model animates away, so no fire or breach follows it).
 */
/** Hull breaches are ~9 draw calls each, so only the newest `BREACH_CAP` breaches are rendered (fire + smoke still mark every hit). */
export const BREACH_CAP = 4

export function DamageLayer({ ships, boardOrigin = BOARD_LAYOUT.player.origin, cellSize = 1, fires = true, smoke = true, breachSide = 'starboard' }: DamageLayerProps) {
  const entries = useMemo(() => damageEntries(ships, boardOrigin, cellSize, breachSide), [ships, boardOrigin, cellSize, breachSide])
  const fireEmitters = useMemo<FireEmitter[]>(
    () => (fires ? entries.filter((e) => !e.sunk).map((e) => ({ key: e.key, position: e.deck, seed: e.seed, scale: cellSize * 0.9 })) : []),
    [entries, fires, cellSize],
  )
  const burningSmoke = useMemo<SmokeEmitter[]>(
    () => (smoke ? entries.filter((e) => !e.sunk).map((e) => ({ key: e.key, position: e.deck, seed: e.seed + 1, scale: cellSize })) : []),
    [entries, smoke, cellSize],
  )
  const sunkSmoke = useMemo<SmokeEmitter[]>(
    () => (smoke ? entries.filter((e) => e.sunk).map((e) => ({ key: e.key, position: e.deck, seed: e.seed + 1, scale: cellSize * 0.7, intensity: 0.6 })) : []),
    [entries, smoke, cellSize],
  )
  const particles = useParticlesScale()
  const cap = particles < 0.5 ? BREACH_CAP / 2 : BREACH_CAP
  const breached = useMemo(() => {
    const out: Entry[] = []
    let n = 0
    for (let i = entries.length - 1; i >= 0 && n < cap; i--) {
      if (entries[i].breaches.length === 0) continue
      out.unshift(entries[i])
      n += entries[i].breaches.length
    }
    return out
  }, [entries, cap])
  return (
    <group name="damage">
      <Fires emitters={fireEmitters} />
      <Smokes emitters={burningSmoke} />
      <Smokes emitters={sunkSmoke} color="#55504b" />
      {breached.map((e) => (
        <group key={e.key}>
          {e.breaches.map((b, i) => (
            <HullBreach key={i} position={b.position} normal={b.normal} seed={b.seed} radius={cellSize * 0.17} glowing={!e.sunk} />
          ))}
        </group>
      ))}
    </group>
  )
}
