import { useMemo } from 'react'
import * as THREE from 'three'
import type { Vec3 } from '../scene/layout'
import { basicHullSections, Cannon, Flag, loftHull, Mast, Railing, shipMaterials } from './kit'
import type { CannonRef, ShipAnchors, ShipDefinition, ShipClass, ShipModelProps } from './types'

/**
 * Generic stand-in ship used by every class until its dedicated session lands a real model.
 * Keeps the fleet renderable and gives the VFX/cinematics sessions correct anchors to aim at.
 */
interface PlaceholderSpec {
  id: ShipClass
  name: string
  length: number
  beam: number
  masts: number
  mastHeight: number
  freeboard: number
  draft: number
}

export function placeholderAnchors(p: PlaceholderSpec): ShipAnchors {
  const half = p.length / 2
  const cannons: ShipAnchors['cannons'] = []
  for (let i = 0; i < p.length; i++) {
    const x = half - (i + 0.5)
    for (const side of ['port', 'starboard'] as const) {
      const z = side === 'starboard' ? p.beam / 2 : -p.beam / 2
      cannons.push({ cell: i, side, muzzle: [x, p.freeboard + 0.22, z * 1.08], direction: [0, 0.08, Math.sign(z)] })
    }
  }
  const masts = Array.from({ length: p.masts }, (_, i) => ({
    base: [half - ((i + 1) / (p.masts + 1)) * p.length, p.freeboard, 0] as Vec3,
    height: p.mastHeight * (i === Math.floor((p.masts - 1) / 2) ? 1 : 0.85),
  }))
  return {
    cannons,
    masts,
    deckY: p.freeboard,
    hull: { length: p.length, beam: p.beam, height: p.freeboard + p.mastHeight, draft: p.draft },
    impactPoints: Array.from({ length: p.length }, (_, i) => [half - (i + 0.5), p.freeboard * 0.4, -p.beam / 2] as Vec3),
  }
}

export function makePlaceholderShip(p: PlaceholderSpec): ShipDefinition {
  const anchors = placeholderAnchors(p)
  function Model({ livery, damage, sinkProgress = 0, sails = 1, phase = 0, firing = [] }: ShipModelProps) {
    const m = shipMaterials(livery)
    const geom = useMemo(() => loftHull(basicHullSections(p.length, p.beam, p.draft, p.freeboard)), [])
    const deckGeom = useMemo(() => new THREE.BoxGeometry(p.length * 0.92, 0.04, p.beam * 0.86), [])
    const isFiring = (c: CannonRef) => firing.some((f) => f.cell === c.cell && f.side === c.side)
    const tint = useMemo(() => (livery === 'pirate' ? '#000' : '#fff'), [livery])
    return (
      <group>
        <mesh geometry={geom} material={m.hull} castShadow receiveShadow />
        <mesh geometry={deckGeom} material={m.deck} position={[0, p.freeboard - 0.02, 0]} receiveShadow />
        <mesh material={m.trim} position={[0, p.freeboard + 0.02, 0]}>
          <boxGeometry args={[p.length * 0.98, 0.05, p.beam * 1.02]} />
        </mesh>
        <Railing position={[0, p.freeboard, p.beam / 2]} length={p.length * 0.9} livery={livery} />
        <Railing position={[0, p.freeboard, -p.beam / 2]} length={p.length * 0.9} livery={livery} />
        {anchors.masts.map((mast, i) => (
          <Mast
            key={i}
            position={mast.base}
            height={mast.height}
            livery={livery}
            yards={[
              [p.beam * 1.6, mast.height * 0.45],
              [p.beam * 1.2, mast.height * 0.72],
            ]}
            sails={sails * (1 - sinkProgress)}
            snapped={Math.max(0, (sinkProgress - 0.3 - i * 0.15) / 0.5)}
            phase={phase + i}
            crowsNest={i === 0}
          />
        ))}
        {anchors.cannons.map((c) => (
          <Cannon
            key={`${c.cell}-${c.side}`}
            position={[c.muzzle[0], p.freeboard, c.side === 'starboard' ? p.beam / 2 - 0.2 : -p.beam / 2 + 0.2]}
            rotationY={c.side === 'starboard' ? 0 : Math.PI}
            livery={livery}
            recoil={isFiring(c) ? 1 : 0}
            scale={0.6}
          />
        ))}
        {damage.map((d, i) =>
          d === 'intact' ? null : (
            <mesh key={i} position={[p.length / 2 - (i + 0.5), p.freeboard + 0.1, 0]}>
              <boxGeometry args={[0.5, 0.2, p.beam * 0.6]} />
              <meshStandardMaterial color={d === 'burning' ? '#ff5a1f' : '#1a0d05'} emissive={d === 'burning' ? '#ff3c00' : tint} emissiveIntensity={d === 'burning' ? 1.5 : 0} />
            </mesh>
          ),
        )}
        <Flag position={[anchors.masts[0]?.base[0] ?? 0, p.freeboard + p.mastHeight + 0.15, 0]} livery={livery} phase={phase} />
      </group>
    )
  }
  Model.displayName = `Placeholder(${p.id})`
  return { id: p.id, name: p.name, length: p.length, Model, anchors }
}
