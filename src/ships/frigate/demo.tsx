/**
 * Dev-only close-up review page for the frigate (not part of the app bundle):
 *   http://localhost:5173/src/ships/frigate/demo.html?livery=navy&damage=0,2&sink=0.4&sails=0.5&lod=0
 *     &cam=3,1.5,3&target=0,0.6,0&firing=1:starboard,0:port&both=1&quality=high&tod=0.6
 * Shows triangle / draw-call counts from `gl.info` so LOD budgets can be measured.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import type { CannonRef, CellDamage, Livery, Lod } from '../types'
import { FRIGATE } from './index'

const q = new URLSearchParams(window.location.search)
const num = (k: string, d: number) => (q.get(k) === null ? d : Number(q.get(k)))
const vec = (k: string, d: [number, number, number]): [number, number, number] => {
  const v = q.get(k)?.split(',').map(Number)
  return v && v.length === 3 && v.every(Number.isFinite) ? (v as [number, number, number]) : d
}
const livery = (q.get('livery') as Livery) || 'pirate'
const lod = Math.min(2, Math.max(0, num('lod', 0))) as Lod
const quality = q.get('quality') === 'low' ? 'low' : 'high'
const sink = num('sink', 0)
const sails = num('sails', 1)
const damaged = (q.get('damage') ?? '').split(',').filter(Boolean).map(Number)
const hitOnly = (q.get('hit') ?? '').split(',').filter(Boolean).map(Number)
const damage: CellDamage[] = Array.from({ length: 3 }, (_, i) => (damaged.includes(i) ? 'burning' : hitOnly.includes(i) ? 'hit' : 'intact'))
const firing: CannonRef[] = (q.get('firing') ?? '')
  .split(',')
  .filter(Boolean)
  .map((s) => {
    const [cell, side] = s.split(':')
    return { cell: Number(cell), side: side === 'port' ? 'port' : 'starboard' }
  })
const cam = vec('cam', [4.2, 2.2, 4.6])
const target = vec('target', [0, 0.6, 0])
const both = q.get('both') === '1'
const tod = num('tod', 0.62)

function Stats({ onStats }: { onStats: (s: string) => void }) {
  const gl = useThree((s) => s.gl)
  const [last, setLast] = useState(0)
  useFrame(({ clock }) => {
    if (clock.elapsedTime - last > 0.5) {
      setLast(clock.elapsedTime)
      onStats(`triangles ${gl.info.render.triangles.toLocaleString()} · draw calls ${gl.info.render.calls} · lod ${lod} · ${livery}`)
    }
  })
  return null
}

function Scene({ onStats }: { onStats: (s: string) => void }) {
  const sunAngle = (tod - 0.25) * Math.PI
  const sun: [number, number, number] = [Math.cos(sunAngle) * 20, Math.max(2, Math.sin(sunAngle) * 24), 10]
  const Model = FRIGATE.Model
  return (
    <>
      <color attach="background" args={['#9fc5d8']} />
      <fog attach="fog" args={['#9fc5d8', 40, 120]} />
      <hemisphereLight args={['#dfeeff', '#2a4a5a', 0.9]} />
      <directionalLight position={sun} intensity={2.6} color="#fff1dc" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0003} shadow-normalBias={0.02} shadow-camera-near={1} shadow-camera-far={80} shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} />
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#1d5f78" roughness={0.35} metalness={0.1} />
      </mesh>
      <group position={[0, 0, both ? 1.2 : 0]}>
        <Model livery={livery} damage={damage} sinkProgress={sink} sails={sails} lod={lod} quality={quality} firing={firing} />
      </group>
      {both && (
        <group position={[0, 0, -1.6]}>
          <Model livery={livery === 'pirate' ? 'navy' : 'pirate'} damage={['intact', 'intact', 'intact']} lod={lod} quality={quality} phase={2} />
        </group>
      )}
      <OrbitControls target={target} />
      <Stats onStats={onStats} />
    </>
  )
}

function App() {
  const [stats, setStats] = useState('')
  return (
    <>
      <Canvas shadows={{ type: THREE.PCFShadowMap }} dpr={1} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }} camera={{ position: cam, fov: 40, near: 0.05, far: 300 }} style={{ position: 'fixed', inset: 0 }}>
        <Scene onStats={setStats} />
      </Canvas>
      <div data-testid="frigate-stats" style={{ position: 'fixed', left: 8, bottom: 8, color: '#fff', font: '13px monospace', background: 'rgba(0,0,0,.45)', padding: '4px 8px', borderRadius: 4 }}>
        {stats}
      </div>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
