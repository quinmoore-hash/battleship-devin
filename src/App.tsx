import { lazy, Suspense } from 'react'
import { OceanScene } from './scene'
import { GameUI } from './ui'

const SceneDemo = lazy(() => import('./scene/SceneDemo').then((m) => ({ default: m.SceneDemo })))
const ShipDemo = lazy(() => import('./ships/ShipDemo').then((m) => ({ default: m.ShipDemo })))
const AudioDemo = lazy(() => import('./audio/AudioDemo').then((m) => ({ default: m.AudioDemo })))
const VfxDamageDemo = lazy(() => import('./vfx/VfxDamageDemo').then((m) => ({ default: m.VfxDamageDemo })))

/** Review routes: `?scene-demo`, `?ship-demo`, `?audio-demo`, `?vfx-damage-demo`. `?no3d` disables WebGL (used by e2e). */
function demoRoute(): 'scene' | 'ship' | 'audio' | 'vfx-damage' | null {
  const q = new URLSearchParams(window.location.search)
  if (q.has('scene-demo')) return 'scene'
  if (q.has('ship-demo')) return 'ship'
  if (q.has('audio-demo')) return 'audio'
  if (q.has('vfx-damage-demo')) return 'vfx-damage'
  return null
}

export default function App() {
  const demo = demoRoute()
  if (demo) {
    return (
      <Suspense fallback={null}>
        {demo === 'scene' && <SceneDemo />}
        {demo === 'ship' && <ShipDemo />}
        {demo === 'audio' && <AudioDemo />}
        {demo === 'vfx-damage' && <VfxDamageDemo />}
      </Suspense>
    )
  }
  return (
    <>
      <OceanScene />
      <GameUI />
    </>
  )
}
