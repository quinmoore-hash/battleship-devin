import { Canvas } from '@react-three/fiber'
import { Component, type ReactNode } from 'react'
import { is3dDisabled } from './flags'

/**
 * Placeholder 3D ocean. The scene child session replaces this with the real
 * Gerstner-wave water, sky, lighting and camera rig. Keep the public API:
 * `<OceanScene>` renders a full-screen Canvas and accepts children (ships, VFX, grids).
 * If WebGL is unavailable (or the URL has `?no3d`, used by low-end devices and the e2e flow
 * tests) the scene degrades to a flat gradient so the game stays playable.
 */
export function OceanScene({ children }: { children?: ReactNode }) {
  if (is3dDisabled()) return <OceanFallback />
  return (
    <WebGLBoundary>
      <Canvas
        camera={{ position: [0, 12, 14], fov: 45 }}
        style={{ position: 'fixed', inset: 0, zIndex: 0 }}
        data-testid="ocean-canvas"
      >
        <color attach="background" args={['#0b2a3a']} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 10, 5]} intensity={1.2} />
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[60, 60]} />
          <meshStandardMaterial color="#1b6a8a" />
        </mesh>
        {children}
      </Canvas>
    </WebGLBoundary>
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
