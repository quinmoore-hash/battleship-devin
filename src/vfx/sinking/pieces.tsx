import { useMemo } from 'react'
import * as THREE from 'three'
import type { Livery } from '../../ships/types'
import type { DebrisKind } from './debris'
import { clothTexture, woodBump, woodTexture } from './textures'

/**
 * Wreckage meshes shared by `<Debris>` and `<Flotsam>`. All geometry is module-level so dozens of
 * pieces across both fleets share buffers; materials are cached per livery.
 */

const G = {
  plank: new THREE.BoxGeometry(0.56, 0.045, 0.13),
  plankEnd: new THREE.TetrahedronGeometry(0.07, 0),
  nail: new THREE.CylinderGeometry(0.009, 0.009, 0.01, 6),
  barrel: new THREE.LatheGeometry(
    [new THREE.Vector2(0.1, -0.17), new THREE.Vector2(0.125, -0.09), new THREE.Vector2(0.135, 0), new THREE.Vector2(0.125, 0.09), new THREE.Vector2(0.1, 0.17)],
    18,
  ),
  barrelLid: new THREE.CircleGeometry(0.1, 18),
  hoop: new THREE.TorusGeometry(0.128, 0.008, 6, 24),
  crate: new THREE.BoxGeometry(0.26, 0.26, 0.26),
  slat: new THREE.BoxGeometry(0.27, 0.03, 0.03),
  brim: new THREE.CylinderGeometry(0.17, 0.17, 0.012, 28),
  crown: new THREE.SphereGeometry(0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
  band: new THREE.TorusGeometry(0.1, 0.008, 6, 24),
  spar: new THREE.CylinderGeometry(0.022, 0.028, 0.95, 10),
  scrap: new THREE.PlaneGeometry(0.42, 0.3, 4, 3),
  rim: new THREE.TorusGeometry(0.17, 0.018, 8, 28),
  spoke: new THREE.CylinderGeometry(0.01, 0.01, 0.34, 6),
  hub: new THREE.CylinderGeometry(0.035, 0.035, 0.05, 12),
  handle: new THREE.CylinderGeometry(0.009, 0.012, 0.07, 6),
}

// give the sail scrap a bit of sag so it doesn't read as a flat card
{
  const pos = G.scrap.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    pos.setZ(i, Math.sin(x * 7) * 0.02 + Math.cos(y * 9) * 0.015)
  }
  G.scrap.computeVertexNormals()
}

export interface PieceMaterials {
  wood: THREE.MeshStandardMaterial
  darkWood: THREE.MeshStandardMaterial
  iron: THREE.MeshStandardMaterial
  felt: THREE.MeshStandardMaterial
  gold: THREE.MeshStandardMaterial
  cloth: THREE.MeshStandardMaterial
}

const MAT_CACHE = new Map<Livery, PieceMaterials>()

export function pieceMaterials(livery: Livery): PieceMaterials {
  let m = MAT_CACHE.get(livery)
  if (m) return m
  const pirate = livery === 'pirate'
  const wood = woodTexture(pirate ? 11 : 12, pirate ? '#6b4a2c' : '#8c6a44', pirate ? '#2d1a0b' : '#4a301a')
  const bump = woodBump(pirate ? 11 : 12)
  const cloth = clothTexture(pirate ? '#2a2624' : '#e7dcc4', pirate ? '#0e0c0b' : '#b9ab90')
  m = {
    wood: new THREE.MeshStandardMaterial({ map: wood, bumpMap: bump, bumpScale: 0.6, roughness: 0.85, metalness: 0 }),
    darkWood: new THREE.MeshStandardMaterial({ map: wood, bumpMap: bump, bumpScale: 0.6, color: '#8a6d4d', roughness: 0.9 }),
    iron: new THREE.MeshStandardMaterial({ color: '#2c2c30', roughness: 0.5, metalness: 0.75 }),
    felt: new THREE.MeshStandardMaterial({ color: pirate ? '#15110f' : '#1a2440', roughness: 0.95 }),
    gold: new THREE.MeshStandardMaterial({ color: '#c9a24a', roughness: 0.35, metalness: 0.8 }),
    cloth: new THREE.MeshStandardMaterial({ map: cloth, color: '#ffffff', roughness: 0.95, side: THREE.DoubleSide }),
  }
  MAT_CACHE.set(livery, m)
  return m
}

/** One piece of wreckage, authored lying on the water (y = 0 is the waterline). */
export function DebrisMesh({ kind, livery }: { kind: DebrisKind; livery: Livery }) {
  const m = useMemo(() => pieceMaterials(livery), [livery])
  switch (kind) {
    case 'plank':
      return (
        <group position-y={-0.01}>
          <mesh geometry={G.plank} material={m.wood} castShadow receiveShadow />
          <mesh geometry={G.plankEnd} material={m.wood} position={[0.3, 0, 0.02]} rotation={[0.4, 0.3, 0.9]} scale={[1.2, 0.5, 0.9]} />
          <mesh geometry={G.plankEnd} material={m.wood} position={[-0.29, 0, -0.03]} rotation={[1.1, 0.8, 0.2]} scale={[1, 0.5, 1]} />
          {[-0.18, 0.02, 0.2].map((x) => (
            <mesh key={x} geometry={G.nail} material={m.iron} position={[x, 0.025, x > 0 ? 0.04 : -0.04]} />
          ))}
        </group>
      )
    case 'barrel':
      return (
        <group rotation-z={Math.PI / 2} position-y={0.02}>
          <mesh geometry={G.barrel} material={m.wood} castShadow receiveShadow />
          <mesh geometry={G.barrelLid} material={m.darkWood} position-y={0.171} rotation-x={-Math.PI / 2} />
          <mesh geometry={G.barrelLid} material={m.darkWood} position-y={-0.171} rotation-x={Math.PI / 2} />
          {[-0.12, 0, 0.12].map((y) => (
            <mesh key={y} geometry={G.hoop} material={m.iron} position-y={y} rotation-x={Math.PI / 2} scale={y === 0 ? 1.05 : 0.98} />
          ))}
        </group>
      )
    case 'crate':
      return (
        <group position-y={-0.06} rotation={[0.15, 0, -0.1]}>
          <mesh geometry={G.crate} material={m.wood} castShadow receiveShadow />
          {[0.12, -0.12].map((y) =>
            [0.125, -0.125].map((z) => (
              <mesh key={`${y}${z}`} geometry={G.slat} material={m.darkWood} position={[0, y, z]} />
            )),
          )}
          {[0.125, -0.125].map((x) => (
            <mesh key={x} geometry={G.slat} material={m.darkWood} position={[x, 0, 0.125]} rotation-y={Math.PI / 2} scale={[1, 1.2, 1.2]} />
          ))}
        </group>
      )
    case 'hat':
      return (
        <group rotation={[0.08, 0, 0.06]}>
          <mesh geometry={G.brim} material={m.felt} castShadow />
          <mesh geometry={G.crown} material={m.felt} />
          <mesh geometry={G.band} material={m.gold} position-y={0.025} rotation-x={Math.PI / 2} />
          {/* turned-up tricorn sides */}
          {[0, 2.1, 4.2].map((a) => (
            <mesh key={a} geometry={G.slat} material={m.felt} position={[Math.cos(a) * 0.14, 0.04, Math.sin(a) * 0.14]} rotation={[0, -a, 0.6]} scale={[0.5, 0.4, 3.2]} />
          ))}
        </group>
      )
    case 'spar':
      return (
        <group position-y={0.01}>
          <mesh geometry={G.spar} material={m.wood} rotation-z={Math.PI / 2} castShadow />
          <mesh geometry={G.scrap} material={m.cloth} position={[0.1, 0.01, 0.17]} rotation={[-Math.PI / 2 + 0.15, 0, 0.3]} />
          <mesh geometry={G.hoop} material={m.iron} position-x={0.3} rotation-y={Math.PI / 2} scale={0.3} />
        </group>
      )
    case 'wheel':
      return (
        <group rotation={[-Math.PI / 2 + 0.25, 0, 0]} position-y={0.02}>
          <mesh geometry={G.rim} material={m.darkWood} castShadow />
          <mesh geometry={G.hub} material={m.gold} rotation-x={Math.PI / 2} />
          {Array.from({ length: 8 }, (_, i) => (
            <group key={i} rotation-z={(i / 8) * Math.PI * 2}>
              <mesh geometry={G.spoke} material={m.wood} position-y={0.08} />
              <mesh geometry={G.handle} material={m.wood} position-y={0.2} />
            </group>
          ))}
        </group>
      )
  }
}
