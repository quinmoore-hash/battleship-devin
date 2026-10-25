import { Canvas } from '@react-three/fiber'
import { Component, useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import { useGameStore } from '../store/gameStore'
import { CameraRig, type CameraView } from './CameraRig'
import { Effects } from './Effects'
import { BayDressing } from './Environment'
import { is3dDisabled } from './flags'
import { Lighting, SkyDome } from './SkyDome'
import { computeAtmosphere, GOLDEN_HOUR } from './sun'
import { Water, type Quality } from './Water'

export { BoardGrid, type BoardGridProps } from './BoardGrid'
export { CameraRig, CAMERA_SHOTS, type CameraRigProps, type CameraView } from './CameraRig'
export {
  BOARD_LAYOUT,
  boardBounds,
  boardCenter,
  cellToWorld,
  worldToCell,
  type BoardKey,
  type BoardPlacement,
  type Vec3,
} from './layout'
export { SceneDemo } from './SceneDemo'
export { computeAtmosphere, GOLDEN_HOUR, type Atmosphere } from './sun'
export { sampleWaveHeight, sampleWaveNormal, WAVES } from './waves'
export type { Quality } from './Water'

export interface OceanSceneProps {
  children?: ReactNode
  /** `high` = full wave bank, 260² water mesh, bloom, shadows 2k. `low` drops all of that. Defaults to `?quality=low` in the URL, else `high`. */
  quality?: Quality
  /** 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. Default: golden hour. Also read from `?tod=0.x`. */
  timeOfDay?: number
  /** Camera shot. Defaults to the shot matching the game store's `phase`. */
  view?: CameraView
  /** Allow orbit/zoom. Defaults to true in the battle view only. */
  interactive?: boolean
  /** Render the rocks / kelp / shoreline / wildlife (default true). */
  dressing?: boolean
}

const PHASE_VIEW: Record<string, CameraView> = {
  menu: 'menu',
  placement: 'placement',
  battle: 'battle',
  gameover: 'gameover',
}

function readUrlParam(name: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}

export function defaultQuality(): Quality {
  const q = readUrlParam('quality')
  if (q === 'low' || q === 'high') return q
  if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2) return 'low'
  return 'high'
}

function defaultTimeOfDay(): number {
  const t = readUrlParam('tod')
  const n = t === null ? NaN : Number(t)
  return Number.isFinite(n) ? n : GOLDEN_HOUR
}

/**
 * The 3D river bay. Renders a fixed, full-screen Canvas behind the HTML UI and places its
 * children (ships, markers, grids, the mascot) inside the lit scene. Degrades to a flat
 * gradient when WebGL is unavailable or the URL has `?no3d`.
 */
export function OceanScene({ children, quality, timeOfDay, view, interactive, dressing = true }: OceanSceneProps) {
  if (is3dDisabled()) return <OceanFallback />
  const q = quality ?? defaultQuality()
  const tod = timeOfDay ?? defaultTimeOfDay()
  return (
    <WebGLBoundary>
      <Canvas
        shadows="percentage"
        dpr={q === 'high' ? [1, 1.75] : [1, 1]}
        gl={{ antialias: q === 'low', powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        camera={{ position: [0, 9, 30], fov: 42, near: 0.5, far: 1500 }}
        style={{ position: 'fixed', inset: 0, zIndex: 0 }}
        data-testid="ocean-canvas"
      >
        <SceneContents quality={q} timeOfDay={tod} view={view} interactive={interactive} dressing={dressing}>
          {children}
        </SceneContents>
      </Canvas>
    </WebGLBoundary>
  )
}

function SceneContents({
  children,
  quality,
  timeOfDay,
  view,
  interactive,
  dressing,
}: Required<Pick<OceanSceneProps, 'quality' | 'timeOfDay' | 'dressing'>> & Pick<OceanSceneProps, 'children' | 'view' | 'interactive'>) {
  const phase = useGameStore((s) => s.phase)
  const activeView = view ?? PHASE_VIEW[phase] ?? 'menu'
  const atmosphere = useMemo(() => computeAtmosphere(timeOfDay), [timeOfDay])
  return (
    <>
      <SkyDome atmosphere={atmosphere} clouds={quality === 'high' ? 1 : 0.7} />
      <Lighting atmosphere={atmosphere} quality={quality} />
      <Water quality={quality} atmosphere={atmosphere} />
      {dressing && <BayDressing atmosphere={atmosphere} quality={quality} />}
      <CameraRig view={activeView} interactive={interactive ?? activeView === 'battle'} />
      {children}
      {quality === 'high' && <Effects night={1 - atmosphere.daylight} />}
    </>
  )
}

class WebGLBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.warn('3D scene unavailable, falling back to 2D background', error)
  }

  render() {
    return this.state.failed ? <OceanFallback /> : this.props.children
  }
}

function OceanFallback() {
  return (
    <div
      data-testid="ocean-fallback"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        background: 'radial-gradient(ellipse at 50% 30%, #1b6a8a 0%, #0b2a3a 70%)',
      }}
    />
  )
}
