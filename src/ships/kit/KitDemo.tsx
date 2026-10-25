import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { Livery } from '../types'
import {
  Anchor, Barrel, Bell, Block, Boat, Cannon, CannonballStack, Capstan, Chest, Cleat, Crate, Figurehead, Flag, GunPort, Hatch, HullHole,
  Lantern, Mast, Netting, Railing, Ratlines, Rope, RopeCoil, Stairs, SternLantern, SwivelGun, Wheel, Window, basicHullSections, loftHullParts, shipMaterials,
} from './index'

/**
 * `?kit-demo` — every kit part on a wooden stage, pirate row (front) and navy row (back).
 * Params: `recoil=0..1`, `set=0..1`, `torn=0..1`, `snapped=0..1`, `lit=0|1` (night lighting when lit),
 * `lod=0|1|2`, `focus=<slot>` (camera ~3 m from one slot), `livery=pirate|navy` (single row).
 */
export function KitDemo() {
  const q = new URLSearchParams(window.location.search)
  const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d)
  const state = {
    recoil: num('recoil', 0),
    set: num('set', 1),
    torn: num('torn', 0),
    snapped: num('snapped', 0),
    lit: q.has('lit') ? q.get('lit') !== '0' : false,
    lod: Math.min(2, Math.max(0, num('lod', 0))) as 0 | 1 | 2,
  }
  const only = q.get('livery') as Livery | null
  const rows: { livery: Livery; z: number }[] = only ? [{ livery: only, z: 0 }] : [{ livery: 'pirate', z: 1.9 }, { livery: 'navy', z: -1.9 }]
  const focus = q.get('focus')
  const slot = focus ? SLOTS.findIndex((s) => s.id === focus) : -1
  const focusX = slot >= 0 ? slotX(slot) : 0
  const camPos: [number, number, number] = slot >= 0 ? [focusX + 1.6, 1.6, (rows[0]?.z ?? 0) + 2.4] : [0, 5.5, 11]
  const target: [number, number, number] = slot >= 0 ? [focusX, 0.6, rows[0]?.z ?? 0] : [0, 0.6, 0]
  const night = state.lit
  return (
    <div data-testid="kit-demo" style={{ position: 'fixed', inset: 0, background: night ? '#060a14' : '#8fb4d6' }}>
      <Canvas shadows={{ type: THREE.PCFShadowMap }} camera={{ position: camPos, fov: 42, near: 0.05, far: 200 }} gl={{ antialias: true }}>
        <color attach="background" args={[night ? '#060a14' : '#8fb4d6']} />
        <fog attach="fog" args={[night ? '#060a14' : '#8fb4d6', 25, 70]} />
        <hemisphereLight args={[night ? '#2a3b66' : '#cfe3ff', night ? '#0a0806' : '#4a3a26', night ? 0.35 : 0.8]} />
        <directionalLight
          position={night ? [-8, 12, -6] : [10, 14, 6]}
          intensity={night ? 0.5 : 2.6}
          color={night ? '#9fb4ff' : '#fff1dc'}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0003}
          shadow-normalBias={0.02}
          shadow-camera-left={-14}
          shadow-camera-right={14}
          shadow-camera-top={8}
          shadow-camera-bottom={-8}
          shadow-camera-near={1}
          shadow-camera-far={40}
        />
        <Stage rows={rows.length} />
        {rows.map((r) => (
          <group key={r.livery} position-z={r.z}>
            <Row livery={r.livery} {...state} />
          </group>
        ))}
        <OrbitControls target={target} maxPolarAngle={Math.PI * 0.49} minDistance={0.6} maxDistance={40} />
      </Canvas>
      <div style={{ position: 'absolute', left: 12, bottom: 10, color: '#fff', font: '12px/1.4 ui-monospace, monospace', textShadow: '0 1px 2px #000', pointerEvents: 'none' }}>
        kit-demo · recoil={state.recoil} set={state.set} torn={state.torn} snapped={state.snapped} lit={night ? 1 : 0} lod={state.lod}
        <br />
        {SLOTS.map((s) => s.id).join(' · ')}
      </div>
    </div>
  )
}

const SLOTS = [
  { id: 'hull' }, { id: 'cannon' }, { id: 'mast' }, { id: 'railing' }, { id: 'stores' }, { id: 'lights' }, { id: 'helm' }, { id: 'bow' }, { id: 'deck' }, { id: 'stern' }, { id: 'boat' },
]
const PITCH = 2.6
const slotX = (i: number) => (i - (SLOTS.length - 1) / 2) * PITCH

function Stage({ rows }: { rows: number }) {
  const m = shipMaterials('pirate')
  const w = SLOTS.length * PITCH + 2
  const d = rows * 3.8 + 1
  const deck = useMemo(() => {
    const base = m.deck as THREE.MeshStandardMaterial
    const mat = base.clone()
    for (const k of ['map', 'normalMap', 'roughnessMap'] as const) {
      const t = base[k]
      if (!t) continue
      const c = t.clone()
      c.repeat.set(w / 2.4, d / 2.4)
      mat[k] = c
    }
    return mat
  }, [m, w, d])
  return (
    <group>
      <mesh material={deck} position-y={-0.06} receiveShadow>
        <boxGeometry args={[w, 0.12, d]} />
      </mesh>
      <mesh material={m.tarredPlanks} position-y={-0.5} receiveShadow>
        <boxGeometry args={[w + 0.3, 0.76, d + 0.3]} />
      </mesh>
      <mesh material={m.trim} position-y={-0.1}>
        <boxGeometry args={[w + 0.34, 0.06, d + 0.34]} />
      </mesh>
    </group>
  )
}

interface RowProps {
  livery: Livery
  recoil: number
  set: number
  torn: number
  snapped: number
  lit: boolean
  lod: 0 | 1 | 2
}

function Row({ livery, recoil, set, torn, snapped, lit, lod }: RowProps) {
  const m = shipMaterials(livery)
  const hull = useMemo(() => {
    const sections = basicHullSections(3.6, 1.1, 0.42, 0.48)
    return loftHullParts(sections, {
      sheer: 0.14,
      wales: [{ y: 0.12, height: 0.07, depth: 0.025 }, { y: 0.36, height: 0.05, depth: 0.02 }],
      gunPorts: [{ x: -0.9, y: 0.26, side: 'both' }, { x: 0, y: 0.26, side: 'both' }, { x: 0.9, y: 0.26, side: 'both' }],
    })
  }, [])
  const hole = hull.surfaceAt(-0.4, -0.05, 'starboard')
  const x = (id: string) => slotX(SLOTS.findIndex((s) => s.id === id))
  return (
    <group>
      {/* lofted hull sample with wales + gun ports, sitting on chocks */}
      <group position={[x('hull'), 0.5, 0]} scale={0.7}>
        <mesh geometry={hull.sides} material={m.hull} castShadow receiveShadow />
        {hull.deck && <mesh geometry={hull.deck} material={m.deck} receiveShadow />}
        {hull.keel && <mesh geometry={hull.keel} material={m.tarredPlanks} castShadow />}
        {hull.wales && <mesh geometry={hull.wales} material={m.trim} castShadow />}
        {hull.gunPorts.map((p, i) => (
          <GunPort key={i} placement={p} livery={livery} open={i % 2 === 0 ? 1 : 0.15} lod={lod} />
        ))}
        <Figurehead position={[1.9, 0.5, 0]} livery={livery} scale={0.5} />
        <HullHole position={hole.position.toArray() as [number, number, number]} rotationY={Math.atan2(hole.normal.x, hole.normal.z)} radius={0.14} />
      </group>
      {[-0.9, 0.9].map((dx) => (
        <mesh key={dx} material={m.oak} position={[x('hull') + dx, 0.08, 0]} castShadow>
          <boxGeometry args={[0.2, 0.16, 0.9]} />
        </mesh>
      ))}

      {/* guns */}
      <group position={[x('cannon'), 0, 0]}>
        <Cannon position={[-0.55, 0, 0.3]} livery={livery} recoil={recoil} rotationY={Math.PI} lod={lod} />
        <Cannon position={[0.45, 0, 0.3]} livery={livery} recoil={0} rotationY={Math.PI} lod={lod} scale={0.85} />
        <GunPort position={[-0.55, 0.42, -0.42]} livery={livery} open={1 - recoil * 0.3} lod={lod} rotationY={Math.PI} />
        <mesh material={m.hull} position={[0, 0.35, -0.47]} receiveShadow castShadow>
          <boxGeometry args={[2.2, 0.7, 0.06]} />
        </mesh>
        <CannonballStack position={[1.0, 0, -0.1]} livery={livery} />
        <SwivelGun position={[-1.0, 0.7, -0.4]} livery={livery} rotationY={Math.PI + 0.4} lod={lod} />
        <mesh material={m.oak} position={[-1.0, 0.35, -0.4]} castShadow>
          <boxGeometry args={[0.08, 0.7, 0.08]} />
        </mesh>
      </group>

      {/* mast, sails, rigging, flags */}
      <group position={[x('mast'), 0, 0]}>
        <Mast position={[0, 0, 0]} height={3.4} livery={livery} yards={[[2.0, 1.4], [1.5, 2.3], [1.0, 3.05]]} sails={set} torn={torn} snapped={snapped} crowsNest lod={lod} />
        <Ratlines from={[0.1, 0.1, 0.95]} to={[0, 1.88, 0.18]} livery={livery} rungs={11} lod={lod} />
        <Flag position={[0, 3.3, 0]} livery={livery} />
        <Flag position={[0, 3.42, 0]} livery={livery} kind="pennant" width={0.5} height={0.3} />
        <Rope from={[0, 3.3, 0]} to={[1.2, 0.3, 0]} sag={0.08} livery={livery} lod={lod} />
        <Rope from={[0, 1.85, 0]} to={[-1.15, 0.3, 0]} sag={0.12} livery={livery} lod={lod} />
        <Cleat position={[1.2, 0, 0]} livery={livery} />
        <Cleat position={[-1.15, 0, 0]} livery={livery} />
        <Block position={[0.6, 1.2, 0]} livery={livery} size={0.12} />
      </group>

      {/* railing + netting */}
      <group position={[x('railing'), 0, 0]}>
        <Railing position={[-1.1, 0, 0.6]} length={2.2} livery={livery} lod={lod} />
        <Netting position={[-1.1, 0.33, 0.6]} length={2.2} height={0.45} livery={livery} />
        <Railing position={[-1.1, 0, -0.6]} length={1.2} livery={livery} height={0.4} lod={lod} />
        <Stairs position={[1.0, 0, -0.6]} livery={livery} width={0.55} height={0.55} />
      </group>

      {/* stores */}
      <group position={[x('stores'), 0, 0]}>
        <Barrel position={[-0.8, 0, -0.4]} livery={livery} lod={lod} />
        <Barrel position={[-0.45, 0, -0.4]} livery={livery} scale={0.8} lod={lod} />
        <Barrel position={[-0.7, 0, 0.3]} livery={livery} onSide lod={lod} />
        <Crate position={[0.1, 0, -0.4]} livery={livery} size={0.3} />
        <Crate position={[0.1, 0.3, -0.4]} livery={livery} size={0.22} rotationY={0.4} />
        <Crate position={[0.5, 0, -0.45]} livery={livery} size={0.26} rotationY={-0.2} />
        <RopeCoil position={[0.2, 0, 0.35]} livery={livery} />
        <RopeCoil position={[0.75, 0, 0.3]} livery={livery} radius={0.09} turns={3} />
        <Chest position={[0.9, 0, -0.3]} livery={livery} open={livery === 'pirate' ? 0.8 : 0} rotationY={0.2} />
        <Hatch position={[-0.1, 0, 0.0]} livery={livery} width={0.5} depth={0.4} lod={lod} />
      </group>

      {/* lights + bell */}
      <group position={[x('lights'), 0, 0]}>
        <mesh material={m.oak} position={[-0.6, 0.6, 0]} castShadow>
          <boxGeometry args={[0.06, 1.2, 0.06]} />
        </mesh>
        <mesh material={m.oak} position={[-0.45, 1.15, 0]}>
          <boxGeometry args={[0.36, 0.04, 0.04]} />
        </mesh>
        <Lantern position={[-0.3, 1.1, 0]} livery={livery} lit={lit} light={lit} lod={lod} />
        <Lantern position={[0.25, 0.75, -0.4]} livery={livery} lit={lit} scale={1.3} lod={lod} />
        <mesh material={m.oak} position={[0.25, 0.4, -0.4]} castShadow>
          <boxGeometry args={[0.1, 0.8, 0.1]} />
        </mesh>
        <mesh material={m.oak} position={[0.25, 0.9, -0.4]}>
          <boxGeometry args={[0.04, 0.04, 0.1]} />
        </mesh>
        <mesh material={m.trim} position={[0.9, 0.5, 0.2]} castShadow receiveShadow>
          <boxGeometry args={[0.6, 1.0, 0.12]} />
        </mesh>
        <SternLantern position={[0.9, 1.25, 0.2]} livery={livery} lit={lit} light={lit} lod={lod} />
        <Bell position={[0.0, 0, 0.5]} livery={livery} />
      </group>

      {/* helm */}
      <group position={[x('helm'), 0, 0]}>
        <Wheel position={[-0.5, 0, 0]} livery={livery} />
        <Capstan position={[0.6, 0, 0.1]} livery={livery} scale={0.8} lod={lod} />
      </group>

      {/* bow: anchor on a cathead, figurehead on a stem */}
      <group position={[x('bow'), 0, 0]}>
        <mesh material={m.oak} position={[-0.6, 1.0, 0]} rotation-z={0.3} castShadow>
          <boxGeometry args={[0.9, 0.12, 0.14]} />
        </mesh>
        <mesh material={m.oak} position={[-0.95, 0.47, 0]} castShadow>
          <boxGeometry args={[0.14, 0.95, 0.14]} />
        </mesh>
        <Rope from={[-0.2, 1.1, 0]} to={[-0.2, 0.86, 0]} livery={livery} radius={0.014} />
        <Anchor position={[-0.2, 0.86, 0]} livery={livery} rotationY={Math.PI / 2} />
        <mesh material={m.hull} position={[0.8, 0.5, 0]} rotation-z={0.3} castShadow receiveShadow>
          <boxGeometry args={[0.18, 1.1, 0.26]} />
        </mesh>
        <Figurehead position={[0.95, 1.0, 0]} livery={livery} scale={0.9} />
      </group>

      {/* deck fittings */}
      <group position={[x('deck'), 0, 0]}>
        <Hatch position={[-0.5, 0, 0.2]} livery={livery} width={0.9} depth={0.7} lod={lod} />
        <Cleat position={[0.5, 0, 0.5]} livery={livery} rotationY={0.3} size={0.2} />
        <Block position={[0.4, 0.3, -0.3]} livery={livery} size={0.14} rotationY={0.5} />
        <mesh material={m.oak} position={[0.4, 0.1, -0.3]} castShadow>
          <boxGeometry args={[0.06, 0.2, 0.06]} />
        </mesh>
        <RopeCoil position={[0.8, 0, -0.1]} livery={livery} radius={0.14} turns={5} />
        <CannonballStack position={[0.9, 0, 0.45]} livery={livery} base={4} radius={0.04} />
      </group>

      {/* stern gallery panel: windows, lantern, hull hole */}
      <group position={[x('stern'), 0, 0]}>
        <mesh material={m.hull} position={[0, 0.65, 0]} castShadow receiveShadow>
          <boxGeometry args={[2.0, 1.3, 0.1]} />
        </mesh>
        <mesh material={m.trim} position={[0, 1.32, 0]} castShadow>
          <boxGeometry args={[2.1, 0.06, 0.16]} />
        </mesh>
        <mesh material={m.trim} position={[0, 0.9, 0.0]}>
          <boxGeometry args={[2.1, 0.05, 0.14]} />
        </mesh>
        {[-0.6, -0.2, 0.2, 0.6].map((dx) => (
          <Window key={dx} position={[dx, 1.1, 0.06]} livery={livery} width={0.3} height={0.36} />
        ))}
        <HullHole position={[-0.5, 0.45, 0.06]} radius={0.15} />
        <HullHole position={[0.55, 0.35, 0.06]} radius={0.1} seed={7} />
        <GunPort position={[0, 0.45, 0.06]} livery={livery} open={0.5} lod={lod} />
        <SternLantern position={[1.15, 1.2, 0.3]} livery={livery} lit={lit} scale={0.7} lod={lod} />
      </group>

      {/* ship's boat */}
      <group position={[x('boat'), 0, 0]}>
        <Boat position={[0, 0, 0]} livery={livery} length={1.9} lod={lod} />
      </group>
    </group>
  )
}
