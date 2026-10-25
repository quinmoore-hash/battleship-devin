import { lazy, Suspense } from 'react'
import { OceanScene } from './scene'
import { GameUI } from './ui'

const SceneDemo = lazy(() => import('./scene/SceneDemo').then((m) => ({ default: m.SceneDemo })))
const ShipDemo = lazy(() => import('./ships/ShipDemo').then((m) => ({ default: m.ShipDemo })))
const AudioDemo = lazy(() => import('./audio/AudioDemo').then((m) => ({ default: m.AudioDemo })))
const KitDemo = lazy(() => import('./ships/kit/KitDemo').then((m) => ({ default: m.KitDemo })))
const SinkingDemo = lazy(() => import('./vfx/sinking/SinkingDemo').then((m) => ({ default: m.SinkingDemo })))
const CannonDemo = lazy(() => import('./vfx/cannon/CannonDemo').then((m) => ({ default: m.CannonDemo })))
const VfxDamageDemo = lazy(() => import('./vfx/VfxDamageDemo').then((m) => ({ default: m.VfxDamageDemo })))

/** Review routes: `?scene-demo`, `?ship-demo`, `?audio-demo`, `?kit-demo`. `?no3d` disables WebGL (used by e2e). */
function demoRoute(): 'scene' | 'ship' | 'audio' | 'kit' | null {
/** Review routes: `?scene-demo`, `?ship-demo`, `?audio-demo`, `?vfx-sinking-demo`. `?no3d` disables WebGL (used by e2e). */
function demoRoute(): 'scene' | 'ship' | 'audio' | 'vfx-sinking' | null {
/** Review routes: `?scene-demo`, `?ship-demo`, `?audio-demo`, `?vfx-cannon-demo`. `?no3d` disables WebGL (used by e2e). */
function demoRoute(): 'scene' | 'ship' | 'audio' | 'cannon' | null {
/** Review routes: `?scene-demo`, `?ship-demo`, `?audio-demo`, `?vfx-damage-demo`. `?no3d` disables WebGL (used by e2e). */
function demoRoute(): 'scene' | 'ship' | 'audio' | 'vfx-damage' | null {
  const q = new URLSearchParams(window.location.search)
  if (q.has('scene-demo')) return 'scene'
  if (q.has('ship-demo')) return 'ship'
  if (q.has('audio-demo')) return 'audio'
  if (q.has('kit-demo')) return 'kit'
  if (q.has('vfx-sinking-demo')) return 'vfx-sinking'
  if (q.has('vfx-cannon-demo')) return 'cannon'
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
        {demo === 'kit' && <KitDemo />}
        {demo === 'vfx-sinking' && <SinkingDemo />}
        {demo === 'cannon' && <CannonDemo />}
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
