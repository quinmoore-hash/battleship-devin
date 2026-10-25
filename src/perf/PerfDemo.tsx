import { useState } from 'react'
import { randomPlacement } from '../engine'
import { OceanScene, BOARD_LAYOUT, type CameraView } from '../scene'
import { Fleet } from '../ships'
import { seededRandom } from '../vfx/random'
import { PerfOverlay } from './PerfOverlay'
import { usePerf } from './store'

const player = randomPlacement(seededRandom(7))
const enemy = randomPlacement(seededRandom(11))

/**
 * `?perf-demo`: the full-game load (10 ships, both liveries, ocean, dressing) with the `?perf` HUD
 * and `<Fleet lod="auto">`, used by `npm run perf` to measure each tier. `&view=battle|placement|menu`.
 */
export function PerfDemo() {
  const perf = usePerf()
  const [view] = useState(() => {
    const v = new URLSearchParams(window.location.search).get('view')
    return (v === 'placement' || v === 'menu' || v === 'gameover' ? v : 'battle') as CameraView
  })
  return (
    <div data-testid="perf-demo" style={{ position: 'fixed', inset: 0 }}>
      <OceanScene view={view} interactive>
        <Fleet ships={player.ships} livery="pirate" lod="auto" quality={perf.quality} boardOrigin={BOARD_LAYOUT.player.origin} />
        <Fleet ships={enemy.ships} livery="navy" lod="auto" quality={perf.quality} boardOrigin={BOARD_LAYOUT.enemy.origin} />
      </OceanScene>
      <PerfOverlay />
    </div>
  )
}
