import { useFrame } from '@react-three/fiber'
import { useLayoutEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import * as THREE from 'three'
import type { Coord, Orientation, PlacedShip, ShipId, ShipSpec } from '../engine'
import {
  BOARD_LAYOUT,
  cellIndexOnShip,
  cellOffsetAlongShip,
  cellToWorld,
  shipCells,
  shipCenter,
  shipPhase,
  shipRotationY,
  type Vec3,
} from './layout'
import { MAT } from './materials'
import { ParticleBurst, SmokeColumn } from './ParticleFx'
import { bobPose, SINK_DURATION, sinkPose } from './timeline'

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

interface ShipModelProps {
  /** Ship length in cells (the model is built along local +x, one unit per cell). */
  length: number
  /** false = skip particle emitters (used for ghosts). */
  detail?: boolean
}

interface MiniOtterProps {
  position: Vec3
  rotationY?: number
  scale?: number
  flag?: boolean
  binoculars?: boolean
  armsUp?: boolean
}

/** A tiny crew otter, same palette as Devin. ~1.4 units tall before `scale`. */
function MiniOtter({ position, rotationY = 0, scale = 0.3, flag, binoculars, armsUp }: MiniOtterProps) {
  const armRot = armsUp ? -2.4 : -0.5
  return (
    <group position={position} rotation-y={rotationY} scale={scale}>
      <mesh material={MAT.otterOrange} position={[0, 0.45, 0]} scale={[1, 1.25, 0.85]}>
        <sphereGeometry args={[0.42, 14, 12]} />
      </mesh>
      <mesh material={MAT.otterCream} position={[0, 0.42, 0.22]} scale={[0.65, 0.9, 0.5]}>
        <sphereGeometry args={[0.36, 12, 10]} />
      </mesh>
      <mesh material={MAT.otterOrange} position={[0, 1.05, 0.05]}>
        <sphereGeometry args={[0.36, 16, 14]} />
      </mesh>
      <mesh material={MAT.otterCream} position={[0, 0.95, 0.32]} scale={[1.3, 0.8, 0.8]}>
        <sphereGeometry args={[0.2, 12, 10]} />
      </mesh>
      <mesh material={MAT.otterNose} position={[0, 1.0, 0.5]}>
        <sphereGeometry args={[0.06, 8, 8]} />
      </mesh>
      {[-0.13, 0.13].map((x) => (
        <mesh key={x} material={MAT.otterBlack} position={[x, 1.12, 0.31]}>
          <sphereGeometry args={[0.05, 8, 8]} />
        </mesh>
      ))}
      {[-0.3, 0.3].map((x) => (
        <group key={x} position={[x, 1.32, 0]}>
          <mesh material={MAT.otterOrange}>
            <sphereGeometry args={[0.1, 10, 8]} />
          </mesh>
          <mesh material={MAT.otterCream} position={[0, 0, 0.06]}>
            <sphereGeometry args={[0.055, 8, 8]} />
          </mesh>
        </group>
      ))}
      <mesh material={MAT.otterOrange} position={[0.1, 0.15, -0.45]} rotation={[1.2, 0, 0.3]}>
        <capsuleGeometry args={[0.12, 0.5, 4, 8]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} material={MAT.otterOrange} position={[s * 0.4, 0.62, 0.1]} rotation={[armRot, 0, s * 0.35]}>
          <capsuleGeometry args={[0.08, 0.3, 4, 8]} />
        </mesh>
      ))}
      {[-0.2, 0.2].map((x) => (
        <mesh key={x} material={MAT.otterOrange} position={[x, 0.05, 0.3]} scale={[1, 0.5, 1.4]}>
          <sphereGeometry args={[0.14, 10, 8]} />
        </mesh>
      ))}
      {flag && (
        <group position={[0.55, 0.9, 0.1]}>
          <mesh material={MAT.woodDark}>
            <cylinderGeometry args={[0.015, 0.015, 0.9, 6]} />
          </mesh>
          <mesh material={MAT.flag} position={[0.16, 0.33, 0]}>
            <planeGeometry args={[0.32, 0.2]} />
          </mesh>
        </group>
      )}
      {binoculars && (
        <group position={[0, 1.12, 0.48]}>
          {[-0.07, 0.07].map((x) => (
            <mesh key={x} material={MAT.metalDark} position={[x, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.05, 0.05, 0.16, 8]} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  )
}

// ---------------------------------------------------------------------------
// The five ships
// ---------------------------------------------------------------------------

const FROND_SPOTS: { x: number; z: number; tilt: number; len: number; bright: boolean }[] = [
  { x: -2.1, z: 0.42, tilt: 0.5, len: 0.9, bright: false },
  { x: -1.4, z: -0.45, tilt: -0.45, len: 0.75, bright: true },
  { x: -0.4, z: 0.46, tilt: 0.4, len: 0.8, bright: true },
  { x: 0.6, z: -0.47, tilt: -0.5, len: 0.95, bright: false },
  { x: 1.4, z: 0.45, tilt: 0.35, len: 0.7, bright: true },
  { x: 2.05, z: -0.4, tilt: -0.4, len: 0.85, bright: false },
  { x: -2.25, z: -0.1, tilt: -0.1, len: 0.6, bright: true },
]

/** Kelp Carrier (5): a lashed-log raft, kelp fronds at the gunwales, a hut, and a small crew. */
function KelpCarrier({ length }: ShipModelProps) {
  const L = length - 0.3
  const planks = Math.round(L * 2)
  return (
    <group>
      {[-0.32, 0, 0.32].map((z) => (
        <mesh key={z} material={MAT.wood} position={[0, 0.02, z]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.14, 0.14, L, 10]} />
        </mesh>
      ))}
      <mesh material={MAT.kelp} position={[0, 0.19, 0]}>
        <boxGeometry args={[L - 0.1, 0.1, 0.95]} />
      </mesh>
      {Array.from({ length: planks }, (_, i) => (
        <mesh key={i} material={MAT.kelpDark} position={[-L / 2 + 0.25 + i * ((L - 0.5) / Math.max(1, planks - 1)), 0.25, 0]}>
          <boxGeometry args={[0.08, 0.03, 0.9]} />
        </mesh>
      ))}
      {FROND_SPOTS.filter((f) => Math.abs(f.x) < L / 2 - 0.1).map((f, i) => (
        <mesh
          key={i}
          material={f.bright ? MAT.kelpBright : MAT.kelpDark}
          position={[f.x, 0.25 + f.len / 2, f.z]}
          rotation={[f.tilt, 0, i % 2 ? 0.15 : -0.15]}
        >
          <coneGeometry args={[0.07, f.len, 5]} />
        </mesh>
      ))}
      <group position={[-L / 4, 0.25, 0]}>
        <mesh material={MAT.woodDark} position={[0, 0.22, 0]}>
          <boxGeometry args={[0.7, 0.45, 0.6]} />
        </mesh>
        <mesh material={MAT.otterCream} position={[0, 0.48, 0]}>
          <boxGeometry args={[0.82, 0.08, 0.72]} />
        </mesh>
        <mesh material={MAT.screen} position={[0, 0.25, 0.31]}>
          <boxGeometry args={[0.22, 0.16, 0.02]} />
        </mesh>
      </group>
      <MiniOtter position={[L / 4, 0.25, 0.1]} rotationY={-0.4} />
      <MiniOtter position={[0.35, 0.25, -0.25]} rotationY={0.6} armsUp />
      <MiniOtter position={[L / 2 - 0.55, 0.25, 0.15]} rotationY={-1.1} flag />
    </group>
  )
}

/** Clam Cruiser (4): a tan hull armoured with ridged clam shells and a shell-crested tower. */
function ClamCruiser({ length }: ShipModelProps) {
  const L = length - 0.3
  const shells = [-1.2, -0.4, 0.4, 1.2].filter((x) => Math.abs(x) < L / 2 - 0.3)
  return (
    <group>
      <mesh material={MAT.shellTan} position={[0, 0.02, 0]} scale={[L / 2, 0.3, 0.55]}>
        <sphereGeometry args={[1, 24, 14]} />
      </mesh>
      <mesh material={MAT.woodDark} position={[0, 0.28, 0]}>
        <boxGeometry args={[L - 0.7, 0.06, 0.7]} />
      </mesh>
      {shells.map((x, i) => (
        <mesh key={x} material={i % 2 ? MAT.shellPink : MAT.shellCream} position={[x, 0.3, 0]} scale={[0.42, 0.32, 0.5]}>
          <sphereGeometry args={[1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
      ))}
      {[-1, 1].map((s) =>
        [-0.9, 0, 0.9].map((x) => (
          <mesh
            key={`${s}${x}`}
            material={MAT.shellCream}
            position={[x, 0.12, s * 0.5]}
            rotation={[s * -Math.PI / 2.4, 0, 0]}
            scale={[0.3, 0.22, 0.3]}
          >
            <sphereGeometry args={[1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
        )),
      )}
      <group position={[-0.25, 0.31, 0]}>
        <mesh material={MAT.shellPurple} position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.2, 0.24, 0.5, 12]} />
        </mesh>
        <mesh material={MAT.shellCream} position={[0, 0.62, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[0.38, 0.3, 0.42]}>
          <sphereGeometry args={[1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
      </group>
      <group position={[L / 2 - 0.85, 0.31, 0]}>
        <mesh material={MAT.metalDark} position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.18, 0.2, 0.2, 10]} />
        </mesh>
        <mesh material={MAT.metal} position={[0.32, 0.14, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.04, 0.045, 0.55, 8]} />
        </mesh>
      </group>
      <MiniOtter position={[0.55, 0.31, 0.18]} rotationY={-0.6} scale={0.26} binoculars />
    </group>
  )
}

/** Driftwood Destroyer (3): a weathered log with a leaf sail and a fin, built for speed. */
function DriftwoodDestroyer({ length }: ShipModelProps) {
  const L = length - 0.3
  const sail = useMemo(() => {
    const s = new THREE.Shape()
    s.moveTo(0, 0)
    s.lineTo(0, 1.15)
    s.quadraticCurveTo(0.6, 0.7, 0.95, 0.12)
    s.lineTo(0, 0)
    return s
  }, [])
  return (
    <group>
      <mesh position={[0, 0.08, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.3, 0.33, L, 12]} />
        <primitive object={MAT.wood} attach="material-0" />
        <primitive object={MAT.woodLight} attach="material-1" />
        <primitive object={MAT.woodLight} attach="material-2" />
      </mesh>
      {[
        [-0.6, 0.32, 0.14],
        [0.4, 0.3, -0.2],
        [0.9, 0.2, 0.24],
      ].map((p, i) => (
        <mesh key={i} material={MAT.woodDark} position={p as Vec3}>
          <sphereGeometry args={[0.07, 8, 6]} />
        </mesh>
      ))}
      <mesh material={MAT.wood} position={[-0.35, 0.35, -0.3]} rotation={[0.9, 0, 0.3]}>
        <cylinderGeometry args={[0.04, 0.06, 0.45, 6]} />
      </mesh>
      <mesh material={MAT.woodDark} position={[0.1, 0.95, 0]}>
        <cylinderGeometry args={[0.03, 0.035, 1.3, 6]} />
      </mesh>
      <mesh material={MAT.sail} position={[0.14, 0.4, 0]}>
        <shapeGeometry args={[sail]} />
      </mesh>
      <mesh material={MAT.woodDark} position={[-L / 2 + 0.4, 0.55, 0]} rotation={[0, 0, 0.55]} scale={[1, 1, 0.3]}>
        <coneGeometry args={[0.22, 0.5, 4]} />
      </mesh>
      <mesh material={MAT.woodDark} position={[-L / 2 - 0.03, 0.05, 0]}>
        <boxGeometry args={[0.1, 0.42, 0.3]} />
      </mesh>
      <MiniOtter position={[0.75, 0.35, 0.05]} rotationY={-0.3} scale={0.24} />
    </group>
  )
}

/** Stream Sub (3): mostly submerged teal hull, conning tower and periscope, trailing bubbles. */
function StreamSub({ length, detail = true }: ShipModelProps) {
  const L = length - 0.3
  return (
    <group>
      <mesh material={MAT.teal} position={[0, -0.14, 0]} rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.34, L - 0.7, 6, 14]} />
      </mesh>
      <mesh material={MAT.tealDark} position={[0.15, 0.22, 0]}>
        <cylinderGeometry args={[0.18, 0.2, 0.4, 12]} />
      </mesh>
      <mesh material={MAT.metal} position={[0.15, 0.44, 0]}>
        <cylinderGeometry args={[0.2, 0.2, 0.05, 12]} />
      </mesh>
      <mesh material={MAT.metal} position={[0.05, 0.72, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.6, 8]} />
      </mesh>
      <mesh material={MAT.metal} position={[0.1, 1.02, 0]}>
        <boxGeometry args={[0.18, 0.09, 0.09]} />
      </mesh>
      <mesh material={MAT.lens} position={[0.2, 1.02, 0]}>
        <sphereGeometry args={[0.03, 8, 8]} />
      </mesh>
      <mesh material={MAT.tealDark} position={[-0.55, 0.12, 0]}>
        <boxGeometry args={[0.3, 0.25, 0.06]} />
      </mesh>
      <mesh material={MAT.tealDark} position={[-L / 2 + 0.2, -0.1, 0]}>
        <boxGeometry args={[0.2, 0.5, 0.05]} />
      </mesh>
      <mesh material={MAT.tealDark} position={[-L / 2 + 0.2, -0.1, 0]}>
        <boxGeometry args={[0.2, 0.05, 0.5]} />
      </mesh>
      <mesh material={MAT.ripple} position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[L / 2 + 0.15, 0.7, 1]}>
        <ringGeometry args={[0.86, 1, 40]} />
      </mesh>
      {detail && (
        <SmokeColumn position={[-L / 2 + 0.1, 0, 0]} color="#d9f1fb" opacity={0.6} count={6} period={2.4} height={0.45} drift={0.1} baseScale={0.035} seed={3} />
      )}
    </group>
  )
}

/** Pebble Patrol (2): two otters on their favourite rock. */
function PebblePatrol({ length }: ShipModelProps) {
  const L = length - 0.3
  return (
    <group>
      <mesh material={MAT.rock} position={[0.05, -0.05, 0]} scale={[L * 0.72, 0.55, 0.85]}>
        <dodecahedronGeometry args={[0.7, 0]} />
      </mesh>
      <mesh material={MAT.rockDark} position={[-L / 2 + 0.1, -0.02, 0.22]} scale={[1, 0.6, 1]}>
        <dodecahedronGeometry args={[0.3, 0]} />
      </mesh>
      <mesh material={MAT.moss} position={[0.3, 0.3, 0.2]} scale={[1, 0.25, 1]}>
        <sphereGeometry args={[0.25, 10, 8]} />
      </mesh>
      <MiniOtter position={[-0.3, 0.3, 0.05]} rotationY={0.35} binoculars />
      <MiniOtter position={[0.45, 0.33, -0.05]} rotationY={-0.5} flag />
    </group>
  )
}

interface ShipLook {
  Model: ComponentType<ShipModelProps>
  /** Local height of the deck, where scorch marks and smoke sit. */
  deck: number
}

export const SHIP_LOOKS: Record<ShipId, ShipLook> = {
  'kelp-carrier': { Model: KelpCarrier, deck: 0.28 },
  'clam-cruiser': { Model: ClamCruiser, deck: 0.32 },
  'driftwood-destroyer': { Model: DriftwoodDestroyer, deck: 0.36 },
  'stream-sub': { Model: StreamSub, deck: 0.2 },
  'pebble-patrol': { Model: PebblePatrol, deck: 0.28 },
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

function Damage({ x, deck, seed }: { x: number; deck: number; seed: number }) {
  return (
    <group position={[x, deck, 0]}>
      <mesh material={MAT.scorch} position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.36, 18]} />
      </mesh>
      <mesh material={MAT.ember} position={[0, 0.06, 0]} rotation={[seed, seed * 0.7, 0]}>
        <dodecahedronGeometry args={[0.11, 0]} />
      </mesh>
      <SmokeColumn position={[0, 0.08, 0]} color="#ff8a2a" opacity={0.85} count={5} period={0.75} height={0.42} drift={0.06} baseScale={0.085} seed={seed} />
      <SmokeColumn position={[0, 0.1, 0]} count={9} period={2.8} height={1.6} drift={0.2} baseScale={0.11} seed={seed + 11} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// Ship: placement, bob, damage and sinking
// ---------------------------------------------------------------------------

export interface ShipModelViewProps {
  spec: ShipSpec
  /** Indices (0..length-1) of damaged cells. */
  hitIndices?: number[]
  cellSize?: number
  detail?: boolean
}

/** A ship hull with its damage, centred on the origin and running along +x. */
export function ShipModel({ spec, hitIndices = [], cellSize = BOARD_LAYOUT.cellSize, detail = true }: ShipModelViewProps) {
  const look = SHIP_LOOKS[spec.id]
  return (
    <group scale={cellSize}>
      <look.Model length={spec.length} detail={detail} />
      {detail &&
        hitIndices.map((i) => <Damage key={i} x={cellOffsetAlongShip(spec.length, i, 1)} deck={look.deck} seed={i + 1} />)}
    </group>
  )
}

interface ShipProps {
  ship: PlacedShip
  boardOrigin: Vec3
  cellSize: number
  revealed: boolean
  reducedMotion: boolean
}

function Ship({ ship, boardOrigin, cellSize, revealed, reducedMotion }: ShipProps) {
  const group = useRef<THREE.Group>(null)
  const sunk = ship.hits.length >= ship.spec.length
  const [initiallySunk] = useState(sunk)
  const sunkAt = useRef<number | null>(sunk ? -Infinity : null)
  const phase = useMemo(() => shipPhase(ship), [ship])
  const center = useMemo(
    () => shipCenter(ship.spec, ship.origin, ship.orientation, boardOrigin, cellSize),
    [ship, boardOrigin, cellSize],
  )
  const hitIndices = useMemo(() => ship.hits.map((h) => cellIndexOnShip(ship, h)).filter((i) => i >= 0), [ship])

  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    const t = clock.elapsedTime
    if (sunk && sunkAt.current === null) sunkAt.current = t
    if (!sunk) sunkAt.current = null
    const sink = sunkAt.current === null ? null : sinkPose(reducedMotion && sunkAt.current !== -Infinity ? SINK_DURATION : t - sunkAt.current)
    const afloat = 1 - (sink?.progress ?? 0)
    const bob = bobPose(t, phase, reducedMotion ? 0 : afloat)
    g.position.set(center[0], center[1] + bob.y + (sink?.depth ?? 0), center[2])
    g.rotation.set(bob.pitch + (sink?.roll ?? 0), shipRotationY(ship.orientation), bob.roll + (sink?.tilt ?? 0), 'YXZ')
  })

  if (!revealed && !sunk) return null
  const animateSink = sunk && !initiallySunk && !reducedMotion
  return (
    <>
      <group ref={group} position={center} rotation-y={shipRotationY(ship.orientation)}>
        <ShipModel spec={ship.spec} hitIndices={hitIndices} cellSize={cellSize} />
      </group>
      {animateSink && (
        <ParticleBurst
          position={center}
          count={48}
          seed={phase * 1000 + 7}
          speed={[0.05, 0.4]}
          up={[0.4, 1.1]}
          size={[0.03, 0.09]}
          life={[0.8, 1.6]}
          stagger={SINK_DURATION - 0.6}
          spread={ship.spec.length * cellSize * 0.45}
          gravity={0}
          colors={['#d9f1fb', '#ffffff', '#bfe6f5']}
          opacity={0.75}
        />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Public components
// ---------------------------------------------------------------------------

export interface FleetProps {
  ships: PlacedShip[]
  /** true for the human's own fleet (always visible); false renders only sunk enemy ships. */
  revealed: boolean
  /** World position of the board centre. Defaults to the player board. */
  origin?: Vec3
  cellSize?: number
  /** Skip bobbing and play sinks instantly. */
  reducedMotion?: boolean
}

export function Fleet({ ships, revealed, origin = BOARD_LAYOUT.player.origin, cellSize = BOARD_LAYOUT.cellSize, reducedMotion = false }: FleetProps) {
  return (
    <>
      {ships.map((ship) => (
        <Ship key={ship.spec.id} ship={ship} boardOrigin={origin} cellSize={cellSize} revealed={revealed} reducedMotion={reducedMotion} />
      ))}
    </>
  )
}

const GHOST_RENDER_ORDER = 10

export interface ShipGhostProps {
  spec: ShipSpec
  origin: Coord
  orientation: Orientation
  valid: boolean
  boardOrigin?: Vec3
  cellSize?: number
}

/** Translucent green/red preview of a ship for the drag-and-drop placement UI. */
export function ShipGhost({ spec, origin, orientation, valid, boardOrigin = BOARD_LAYOUT.player.origin, cellSize = BOARD_LAYOUT.cellSize }: ShipGhostProps) {
  const hull = useRef<THREE.Group>(null)
  const material = valid ? MAT.ghostValid : MAT.ghostInvalid
  useLayoutEffect(() => {
    hull.current?.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return
      ;(o as THREE.Mesh).material = material
      // Draw after the (transparent) water so the preview is never hidden under it.
      o.renderOrder = GHOST_RENDER_ORDER
    })
  }, [material, spec.id])
  const center = shipCenter(spec, origin, orientation, boardOrigin, cellSize)
  const cells = shipCells(spec, origin, orientation)
  return (
    <group>
      <group ref={hull} position={[center[0], center[1] + 0.06, center[2]]} rotation-y={shipRotationY(orientation)}>
        <ShipModel spec={spec} cellSize={cellSize} detail={false} />
      </group>
      {cells.map((c) => {
        const p = cellToWorld(c, boardOrigin, cellSize)
        return (
          <mesh
            key={`${c.x},${c.y}`}
            material={valid ? MAT.ghostTileValid : MAT.ghostTileInvalid}
            position={[p[0], p[1] + 0.02, p[2]]}
            rotation={[-Math.PI / 2, 0, 0]}
            renderOrder={GHOST_RENDER_ORDER}
          >
            <planeGeometry args={[cellSize * 0.92, cellSize * 0.92]} />
          </mesh>
        )
      })}
    </group>
  )
}
