import { lazy, Suspense } from 'react'
import { OceanScene } from './scene'
import { GameUI } from './ui'

const SceneDemo = lazy(() => import('./scene/SceneDemo').then((m) => ({ default: m.SceneDemo })))
const ShipDemo = lazy(() => import('./ships/ShipDemo').then((m) => ({ default: m.ShipDemo })))
const AudioDemo = lazy(() => import('./audio/AudioDemo').then((m) => ({ default: m.AudioDemo })))
const KitDemo = lazy(() => import('./ships/kit/KitDemo').then((m) => ({ default: m.KitDemo })))

/** Review routes: `?scene-demo`, `?ship-demo`, `?audio-demo`, `?kit-demo`. `?no3d` disables WebGL (used by e2e). */
function demoRoute(): 'scene' | 'ship' | 'audio' | 'kit' | null {
  const q = new URLSearchParams(window.location.search)
  if (q.has('scene-demo')) return 'scene'
  if (q.has('ship-demo')) return 'ship'
  if (q.has('audio-demo')) return 'audio'
  if (q.has('kit-demo')) return 'kit'
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
        {demo === 'kit' && <KitDemo />}
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
