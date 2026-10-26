import { lazy, Suspense, useEffect } from 'react'
import { bindGameAudio } from './audio'
import { CinematicCamera, CinematicLayer, Letterbox, useDirector } from './cinematics'
import { ExtrasLayer, MenuExtras, useGameWeather } from './extras'
import { OceanScene } from './scene'
import { useGameStore } from './store/gameStore'
import { GameUI } from './ui'
import { bindCinematics, directorPlaysAudio } from './ui/cinematicsBinding'
import { GameWorld } from './ui/world/GameWorld'
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
const CinematicsDemo = lazy(() => import('./cinematics/CinematicsDemo').then((m) => ({ default: m.CinematicsDemo })))
const FrigateDemo = lazy(() => import('./ships/frigate/demo').then((m) => ({ default: m.FrigateDemoApp })))
const ExtrasDemo = lazy(() => import('./extras/ExtrasDemo').then((m) => ({ default: m.ExtrasDemo })))

/**
 * Review routes (one query flag each): `?scene-demo`, `?ship-demo`, `?audio-demo`, `?kit-demo`,
 * `?vfx-sinking-demo`, `?vfx-cannon-demo`, `?vfx-damage-demo`, `?cinematics-demo`, `?extras-demo`. `?no3d` disables WebGL (used by e2e).
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
  'cinematics-demo': CinematicsDemo,
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
  if (Demo) {
    return (
      <Suspense fallback={null}>
        <PerfBootstrap />
        <Demo />
      </Suspense>
    )
  }
  return <Game />
}

/**
 * The real game: the shared ocean with the game world and the cinematics director's layer/camera inside it,
 * the HTML HUD, extras and perf plumbing on top. The director paces every turn (see `src/ui/turnFlow.ts`)
 * and owns shot / sink / victory SFX while it plays; `bindGameAudio` keeps music, ambience and placement cues.
 */
function Game() {
  const weather = useGameWeather()
  const phase = useGameStore((s) => s.phase)
  const cinematic = useDirector((s) => s.busy)
  const inBattle = phase === 'battle' || phase === 'gameover'
  useEffect(() => {
    const unbindCinematics = bindCinematics()
    const unbindAudio = bindGameAudio({ director: directorPlaysAudio })
    return () => {
      unbindAudio()
      unbindCinematics()
    }
  }, [])
  return (
    <>
      <PerfBootstrap />
      <FpsWatchdog />
      <A11yBootstrap />
      <OceanScene weather={weather} cameraOverride={cinematic}>
        <GameWorld />
        {inBattle && <CinematicLayer />}
        {inBattle && <CinematicCamera />}
      </OceanScene>
      <GameUI menuExtras={<MenuExtras />} />
      <ExtrasLayer />
      <Letterbox hint={false} />
      <QualityToast />
      {perfOverlayRequested() && <PerfOverlay />}
    </>
  )
}
