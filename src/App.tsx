import { lazy, Suspense } from 'react'
import { OceanScene } from './scene'
import { GameUI } from './ui'
import { A11yBootstrap } from './perf/a11y/A11yBootstrap'
import { PerfBootstrap, perfOverlayRequested } from './perf/PerfBootstrap'
import { PerfOverlay } from './perf/PerfOverlay'
import { FpsWatchdog } from './perf/FpsWatchdog'
import { QualityToast } from './perf/QualityToast'

const SceneDemo = lazy(() => import('./scene/SceneDemo').then((m) => ({ default: m.SceneDemo })))
const ShipDemo = lazy(() => import('./ships/ShipDemo').then((m) => ({ default: m.ShipDemo })))
const AudioDemo = lazy(() => import('./audio/AudioDemo').then((m) => ({ default: m.AudioDemo })))
const KitDemo = lazy(() => import('./ships/kit/KitDemo').then((m) => ({ default: m.KitDemo })))
const SinkingDemo = lazy(() => import('./vfx/sinking/SinkingDemo').then((m) => ({ default: m.SinkingDemo })))
const CannonDemo = lazy(() => import('./vfx/cannon/CannonDemo').then((m) => ({ default: m.CannonDemo })))
const VfxDamageDemo = lazy(() => import('./vfx/VfxDamageDemo').then((m) => ({ default: m.VfxDamageDemo })))
const PerfDemo = lazy(() => import('./perf/PerfDemo').then((m) => ({ default: m.PerfDemo })))
const FrigateDemo = lazy(() => import('./ships/frigate/demo').then((m) => ({ default: m.FrigateDemoApp })))

/**
 * Review routes (one query flag each): `?scene-demo`, `?ship-demo`, `?audio-demo`, `?kit-demo`,
 * `?vfx-sinking-demo`, `?vfx-cannon-demo`, `?vfx-damage-demo`. `?no3d` disables WebGL (used by e2e).
 * Add new demos here as one entry; keep the list alphabetical-ish to avoid merge conflicts.
 */
const DEMOS: Record<string, React.LazyExoticComponent<() => React.JSX.Element>> = {
  'scene-demo': SceneDemo,
  'perf-demo': PerfDemo,
  'ship-demo': ShipDemo,
  'audio-demo': AudioDemo,
  'kit-demo': KitDemo,
  'vfx-sinking-demo': SinkingDemo,
  'vfx-cannon-demo': CannonDemo,
  'vfx-damage-demo': VfxDamageDemo,
  'frigate-demo': FrigateDemo,
}

function demoRoute() {
  const q = new URLSearchParams(window.location.search)
  for (const key of Object.keys(DEMOS)) if (q.has(key)) return DEMOS[key]
  return null
}

export default function App() {
  const Demo = demoRoute()
  if (Demo) {
    return (
      <Suspense fallback={null}>
        <PerfBootstrap />
        <Demo />
      </Suspense>
    )
  }
  return (
    <>
      <PerfBootstrap />
      <FpsWatchdog />
      <A11yBootstrap />
      <OceanScene />
      <GameUI />
      <QualityToast />
      {perfOverlayRequested() && <PerfOverlay />}
    </>
  )
}
