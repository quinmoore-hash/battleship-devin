import { lazy, Suspense } from 'react'
import { ExtrasLayer, useGameWeather } from './extras'
import { OceanScene } from './scene'
import { GameUI } from './ui'

const SceneDemo = lazy(() => import('./scene/SceneDemo').then((m) => ({ default: m.SceneDemo })))
const ShipDemo = lazy(() => import('./ships/ShipDemo').then((m) => ({ default: m.ShipDemo })))
const AudioDemo = lazy(() => import('./audio/AudioDemo').then((m) => ({ default: m.AudioDemo })))
const KitDemo = lazy(() => import('./ships/kit/KitDemo').then((m) => ({ default: m.KitDemo })))
const SinkingDemo = lazy(() => import('./vfx/sinking/SinkingDemo').then((m) => ({ default: m.SinkingDemo })))
const CannonDemo = lazy(() => import('./vfx/cannon/CannonDemo').then((m) => ({ default: m.CannonDemo })))
const VfxDamageDemo = lazy(() => import('./vfx/VfxDamageDemo').then((m) => ({ default: m.VfxDamageDemo })))
const FrigateDemo = lazy(() => import('./ships/frigate/demo').then((m) => ({ default: m.FrigateDemoApp })))
const ExtrasDemo = lazy(() => import('./extras/ExtrasDemo').then((m) => ({ default: m.ExtrasDemo })))

/**
 * Review routes (one query flag each): `?scene-demo`, `?ship-demo`, `?audio-demo`, `?kit-demo`,
 * `?vfx-sinking-demo`, `?vfx-cannon-demo`, `?vfx-damage-demo`, `?extras-demo`. `?no3d` disables WebGL (used by e2e).
 * Add new demos here as one entry; keep the list alphabetical-ish to avoid merge conflicts.
 */
const DEMOS: Record<string, React.LazyExoticComponent<() => React.JSX.Element>> = {
  'scene-demo': SceneDemo,
  'ship-demo': ShipDemo,
  'audio-demo': AudioDemo,
  'kit-demo': KitDemo,
  'vfx-sinking-demo': SinkingDemo,
  'vfx-cannon-demo': CannonDemo,
  'vfx-damage-demo': VfxDamageDemo,
  'frigate-demo': FrigateDemo,
  'extras-demo': ExtrasDemo,
}

function demoRoute() {
  const q = new URLSearchParams(window.location.search)
  for (const key of Object.keys(DEMOS)) if (q.has(key)) return DEMOS[key]
  return null
}

export default function App() {
  const Demo = demoRoute()
  const weather = useGameWeather()
  if (Demo) {
    return (
      <Suspense fallback={null}>
        <Demo />
      </Suspense>
    )
  }
  return (
    <>
      <OceanScene weather={weather} />
      <GameUI />
      <ExtrasLayer />
    </>
  )
}
