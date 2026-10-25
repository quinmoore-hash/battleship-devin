import { useMemo } from 'react'
import type { PlacedShip } from '../../engine'
import { coordKey } from '../../engine'
import { BOARD_LAYOUT, cellToWorld, type Vec3 } from '../../scene/layout'
import { SHIPS, shipWorldTransform } from '../../ships'
import type { Side } from '../../ships/types'
import { hashString } from '../random'
import { Fire } from './Fire'
import { HullBreach } from './HullBreach'
import { Smoke } from './Smoke'

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
      const key = `${ship.spec.id}:${coordKey(hit)}`
      const seed = hashString(key)
      const centre = cellToWorld(hit, boardOrigin, cellSize)
      const jitter = ((seed % 100) / 100 - 0.5) * 0.3
      // a sunk ship has left the deck height behind: smoulder at the waterline instead
      const deckY = sunk ? boardOrigin[1] + 0.05 : boardOrigin[1] + def.anchors.deckY
      const deck: Vec3 = [centre[0] + (ship.orientation === 'vertical' ? jitter : 0), deckY, centre[2] + (ship.orientation === 'horizontal' ? jitter : 0)]
      const breaches: Entry['breaches'] = []
      const ip = def.anchors.impactPoints[idx]
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
export function DamageLayer({ ships, boardOrigin = BOARD_LAYOUT.player.origin, cellSize = 1, fires = true, smoke = true, breachSide = 'starboard' }: DamageLayerProps) {
  const entries = useMemo(() => damageEntries(ships, boardOrigin, cellSize, breachSide), [ships, boardOrigin, cellSize, breachSide])
  return (
    <group>
      {entries.map((e) => (
        <group key={e.key}>
          {fires && !e.sunk && <Fire position={e.deck} seed={e.seed} scale={cellSize * 0.9} />}
          {smoke && <Smoke position={e.deck} seed={e.seed + 1} scale={cellSize * (e.sunk ? 0.7 : 1)} intensity={e.sunk ? 0.6 : 1} color={e.sunk ? '#55504b' : '#2f2b28'} />}
          {e.breaches.map((b, i) => (
            <HullBreach key={i} position={b.position} normal={b.normal} seed={b.seed} radius={cellSize * 0.17} glowing={!e.sunk} />
          ))}
        </group>
      ))}
    </group>
  )
}
