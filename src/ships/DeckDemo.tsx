import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { FLEET, createBoard, placeShip, type Board, type PlacedShip, type ShipId } from '../engine'
import { DECK_FOV, DECK_NEAR, EYE_HEIGHT } from '../deck/contract'
import { OceanScene } from '../scene'
import type { Weather } from '../scene/sun'
import { BOARD_LAYOUT, type Vec3 } from '../scene/layout'
import { sampleWaveHeight } from '../scene/waves'
import { Fleet, SHIPS, shipWorldTransform } from './index'
import type { Livery } from './types'

/**
 * `?deck-demo&ship=man-o-war&look=fwd|rail|aft|port&lod=0&dressed=0|1&wrecks=6&tod=0.6&weather=squall&livery=navy&perf&quality=medium`
 *
 * Eye-height review of one class in the real battle scene: the chosen ship sits on the player board's first row
 * and is rendered live at `lod` (default 0, the "On deck" detail level); the rest of a classic fleet is baked on
 * the rows behind it; `wrecks` sunk enemy ships lie on the enemy waters. The camera stands at the class's helm
 * (`anchors.deck.spawn`, else a quarterdeck guess) at `deckY + EYE_HEIGHT`, near `DECK_NEAR`, fov `DECK_FOV`, and
 * rides the hull on the waves. `look`: `fwd` down the deck toward the bow, `rail` across the port rail toward
 * the enemy board, `aft` toward the stern, `port` = `rail` pitched up to the horizon, `down` from `eye=x,y,z` (ship frame,
 * overrides the spawn; no eye-height offset) for a top-down check of the deck.
 */
const LOOKS: Record<string, Vec3> = {
  fwd: [1, -0.08, 0],
  rail: [0.15, -0.12, -1],
  aft: [-1, -0.08, 0],
  port: [0, 0.02, -1],
  down: [0.25, -1, -0.45],
}

/** Helm position guess per class (ship frame) until `anchors.deck` lands; y is the deck the helmsman stands on. */
const HELM_GUESS: Record<ShipId, Vec3> = {
  sloop: [-0.7, 0.3, 0],
  brigantine: [-0.77, 0.29, 0],
  frigate: [-0.97, 0.43, 0],
  galleon: [-0.8, 1.02, 0],
  'man-o-war': [-1.2, 0.88, 0],
}

function classicFleet(first: ShipId): Board {
  const order = [first, ...FLEET.map((s) => s.id).filter((id) => id !== first)]
  let board = createBoard()
  order.forEach((id, i) => {
    const spec = FLEET.find((s) => s.id === id)!
    board = placeShip(board, spec, { x: 0, y: i * 2 }, 'horizontal')
  })
  return board
}

function wreckFleet(count: number): PlacedShip[] {
  let board = createBoard()
  FLEET.forEach((spec, i) => {
    board = placeShip(board, spec, { x: 2, y: i * 2 }, 'horizontal')
  })
  return board.ships.slice(0, count).map((s) => ({ ...s, hits: s.cells }))
}

function EyeCamera({ ship, look, eye }: { ship: PlacedShip; look: Vec3; eye?: Vec3 }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const dir = useMemo(() => new THREE.Vector3(...look).normalize(), [look])
  const tmp = useRef(new THREE.Vector3())
  const { position } = shipWorldTransform(ship, BOARD_LAYOUT.player.origin, 1)
  const def = SHIPS[ship.spec.id]
  const helm = eye ?? def.anchors.deck?.spawn ?? HELM_GUESS[ship.spec.id]

  useEffect(() => {
    camera.near = DECK_NEAR
    camera.fov = DECK_FOV
    camera.updateProjectionMatrix()
  }, [camera])

  useFrame(({ clock }) => {
    const wave = sampleWaveHeight(position[0], position[2], clock.elapsedTime)
    camera.position.set(position[0] + helm[0], position[1] + wave + helm[1] + (eye ? 0 : EYE_HEIGHT), position[2] + helm[2])
    tmp.current.copy(camera.position).add(dir)
    camera.lookAt(tmp.current)
  })
  return null
}

export function DeckDemo() {
  const q = new URLSearchParams(window.location.search)
  const id = (q.get('ship') as ShipId | null) ?? 'man-o-war'
  const shipId: ShipId = SHIPS[id] ? id : 'man-o-war'
  const look = LOOKS[q.get('look') ?? 'fwd'] ?? LOOKS.fwd
  const lod = Math.min(2, Math.max(0, Number(q.get('lod') ?? 0))) as 0 | 1 | 2
  const wrecks = Math.min(5, Math.max(0, Number(q.get('wrecks') ?? 0)))
  const livery = (q.get('livery') as Livery) || 'pirate'
  const tod = q.get('tod') !== null ? Number(q.get('tod')) : undefined
  const weather = (q.get('weather') as Weather | null) ?? undefined
  const dressed = q.get('dressed') !== '0'
  const eyeParam = q.get('eye')?.split(',').map(Number)
  const eye = eyeParam && eyeParam.length === 3 && eyeParam.every(Number.isFinite) ? (eyeParam as Vec3) : undefined

  const board = useMemo(() => classicFleet(shipId), [shipId])
  const own = board.ships[0]
  const rest = board.ships.slice(1)
  const foe = useMemo(() => wreckFleet(wrecks), [wrecks])

  return (
    <OceanScene view="battle" interactive={false} cameraOverride timeOfDay={tod} weather={weather}>
      <Fleet ships={[own]} livery={livery} lod={lod} dressedUid={dressed ? own.uid : null} />
      <Fleet ships={rest} livery={livery} lod={1} />
      {foe.length > 0 && <Fleet ships={foe} livery={livery === 'pirate' ? 'navy' : 'pirate'} revealed={false} boardOrigin={BOARD_LAYOUT.enemy.origin} lod={1} />}
      <EyeCamera ship={own} look={look} eye={eye} />
    </OceanScene>
  )
}
