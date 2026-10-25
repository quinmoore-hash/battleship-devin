import { useMemo } from 'react'
import { FLEET, type ShipId } from '../engine'
import { OceanScene } from '../scene'
import { SHIPS, Ship } from './index'
import type { CellDamage, Livery } from './types'

/**
 * `?ship-demo`                    all five classes side by side, pirate + navy liveries
 * `?ship-demo&ship=galleon&livery=navy&damage=0,2&sink=0.4&sails=0.5`   one ship, close up
 * Used by the ship sessions (and reviewers) to inspect models without playing a game.
 */
export function ShipDemo() {
  const q = new URLSearchParams(window.location.search)
  const only = q.get('ship') as ShipId | null
  const livery = (q.get('livery') as Livery) || 'pirate'
  const sink = Number(q.get('sink') ?? 0)
  const sails = Number(q.get('sails') ?? 1)
  const damaged = (q.get('damage') ?? '').split(',').filter(Boolean).map(Number)

  const items = useMemo(() => {
    const ids = only && SHIPS[only] ? [only] : FLEET.map((s) => s.id)
    return ids.map((id, i) => ({ id, x: only ? 0 : (i - (ids.length - 1) / 2) * 7 }))
  }, [only])

  return (
    <OceanScene view="placement" interactive dressing={false}>
      {items.map(({ id, x }) => {
        const len = SHIPS[id].length
        const damage: CellDamage[] = Array.from({ length: len }, (_, i) => (damaged.includes(i) ? 'burning' : 'intact'))
        return (
          <group key={id}>
            <group position={[x, 0.2 - sink * 0.9, only ? 0 : 2]} rotation-z={sink * 0.35}>
              <Ship id={id} livery={livery} damage={damage} sinkProgress={sink} sails={sails} />
            </group>
            {!only && (
              <group position={[x, 0.2, -3]}>
                <Ship id={id} livery={livery === 'pirate' ? 'navy' : 'pirate'} damage={Array(len).fill('intact')} />
              </group>
            )}
          </group>
        )
      })}
    </OceanScene>
  )
}
