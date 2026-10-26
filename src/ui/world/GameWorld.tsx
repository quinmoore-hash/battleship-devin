import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { FLEET_BY_ID, hasBeenShot, isSunk, type Coord, type PlacedShip } from '../../engine'
import { useDirector } from '../../cinematics'
import { usePerf } from '../../perf/store'
import { BoardGrid } from '../../scene/BoardGrid'
import { BOARD_LAYOUT, cellToWorld } from '../../scene/layout'
import { Fleet, Ship } from '../../ships'
import { useGameStore } from '../../store/gameStore'
import { DamageLayer } from '../../vfx/damage'
import { ShotMarkers } from '../../vfx/markers'
import { Flotsam, placedShipSeed } from '../../vfx/sinking'
import { maskPendingHit, settledWrecks, visibleShots, type PendingShot } from './pending'
import { useBattleController } from '../battleController'
import { footprintAt } from '../placementUtils'
import { useUiStore } from '../uiStore'
import type { Lod } from '../../ships/types'
import { FireLights } from '../../vfx/damage/Fire'
import { FlashLights } from '../../vfx/flashLights'

const PLAYER = BOARD_LAYOUT.player
const ENEMY = BOARD_LAYOUT.enemy
const PLAYER_ROPE = '#d9b25f'
const ENEMY_ROPE = '#9fd3d0'
const VALID = '#4cc98a'
const INVALID = '#e2473b'
const LIFT = 0.45

/**
 * Everything the game adds to the shared ocean: both board grids, the fleets, shot markers and
 * damage, plus the placement ghost. Mounted as a child of `<OceanScene>` so it shares lights,
 * water and camera. All pointer logic goes through the `uiStore` so the HTML HUD stays in sync.
 */
export function GameWorld() {
  const phase = useGameStore((s) => s.phase)
  const quality = useGameStore((s) => s.settings.quality)
  // low = cheap ocean + low ship detail; medium = cheap ocean, full ships; high/auto = everything.
  const shipQuality = quality === 'low' ? 'low' : 'high'
  return (
    <group>
      <ReadyProbe />
      {phase === 'placement' && <PlacementWorld quality={shipQuality} />}
      {(phase === 'battle' || phase === 'gameover') && <BattleWorld quality={shipQuality} over={phase === 'gameover'} />}
    </group>
  )
}

/** Flags the first rendered frame so the loading screen can lift. */
/** Placement shares the battle budget: never lod 0 (lod 0 is reserved for the one cinematic-focused ship). */
function usePlacementLod(): Lod {
  return Math.max(1, usePerf().lod) as Lod
}

/** Only the sink entries that belong to ships of this fleet that are actually sunk. */
export function sinkFor(ships: PlacedShip[], sink: Partial<Record<ShipId, number>>): Partial<Record<ShipId, number>> {
  const out: Partial<Record<ShipId, number>> = {}
  for (const ship of ships) {
    const p = sink[ship.spec.id]
    if (p !== undefined && ship.hits.length >= ship.spec.length) out[ship.spec.id] = p
  }
  return out
}

function ReadyProbe() {
  const setWorldReady = useUiStore((s) => s.setWorldReady)
  const done = useRef(false)
  useFrame(() => {
    if (!done.current) {
      done.current = true
      setWorldReady(true)
    }
  })
  return null
}

function PlacementWorld({ quality }: { quality: 'low' | 'high' }) {
  const placementLod = usePlacementLod()
  const playerBoard = useGameStore((s) => s.playerBoard)
  const removePlayerShip = useGameStore((s) => s.removePlayerShip)
  const placePlayerShip = useGameStore((s) => s.placePlayerShip)
  const hover = useUiStore((s) => s.hover)
  const carrying = useUiStore((s) => s.carrying)
  const orientation = useUiStore((s) => s.orientation)
  const dragging = useUiStore((s) => s.dragging)
  const setHover = useUiStore((s) => s.setHover)
  const setCarrying = useUiStore((s) => s.setCarrying)
  const setDragging = useUiStore((s) => s.setDragging)
  const [grab, setGrab] = useState(0)
  // Where the ship was grabbed and when: a release on the same cell without moving is a click → keep carrying.
  const grabRef = useRef<{ cell: Coord; at: number; moved: boolean } | null>(null)

  const spec = carrying ? FLEET_BY_ID[carrying] : null
  const cell = hover?.side === 'player' ? hover.coord : null
  const footprint = useMemo(() => (spec && cell ? footprintAt(playerBoard, spec, cell, orientation, grab) : null), [spec, cell, playerBoard, orientation, grab])

  const drop = () => {
    const f = footprint
    if (spec && f?.valid) {
      placePlayerShip(spec, f.origin, orientation)
      setCarrying(null)
    }
  }

  // Drag ends anywhere on the page: drop if over a valid spot, otherwise keep carrying (click mode).
  useEffect(() => {
    if (!dragging) return
    const move = () => {
      const g = grabRef.current
      const h = useUiStore.getState().hover
      if (g && h?.side === 'player' && (h.coord.x !== g.cell.x || h.coord.y !== g.cell.y)) g.moved = true
    }
    const up = () => {
      setDragging(false)
      const g = grabRef.current
      const { hover: h, carrying: c, orientation: o } = useUiStore.getState()
      const s = c ? FLEET_BY_ID[c] : null
      if (g && !g.moved) {
        g.at = performance.now()
        return
      }
      if (s && h?.side === 'player') {
        const f = footprintAt(useGameStore.getState().playerBoard, s, h.coord, o, grab)
        if (f.valid) {
          placePlayerShip(s, f.origin, o)
          setCarrying(null)
        }
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [dragging, grab, placePlayerShip, setCarrying, setDragging])

  const pickUp = (ship: PlacedShip, e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const idx = Math.max(0, ship.cells.findIndex((c) => c.x === Math.floor(e.point.x - PLAYER.origin[0]) && c.y === Math.floor(e.point.z - PLAYER.origin[2])))
    setGrab(idx)
    grabRef.current = { cell: ship.cells[idx], at: performance.now(), moved: false }
    removePlayerShip(ship.spec.id)
    setCarrying(ship.spec.id, ship.orientation)
    setDragging(true)
    setHover({ side: 'player', coord: ship.cells[idx] })
  }

  return (
    <group>
      <BoardGrid
        origin={PLAYER.origin}
        highlight={cell}
        color={PLAYER_ROPE}
        highlightColor={footprint ? (footprint.valid ? VALID : INVALID) : '#ffd98a'}
        onCellPointerMove={(c) => setHover(c ? { side: 'player', coord: c } : null)}
        onCellClick={() => {
          // the click that ends a lift lands here too; don't drop the ship straight back
          const g = grabRef.current
          if (g && !g.moved && performance.now() - g.at < 300) return
          if (carrying && !dragging) drop()
        }}
      />
      {playerBoard.ships.map((ship) => (
        <group key={ship.spec.id} onPointerDown={(e) => pickUp(ship, e)} onPointerOver={() => (document.body.style.cursor = 'grab')} onPointerOut={() => (document.body.style.cursor = '')}>
          <Fleet ships={[ship]} livery="pirate" boardOrigin={PLAYER.origin} quality={quality} lod={placementLod} />
        </group>
      ))}
      {spec && footprint && <Ghost id={spec.id} footprint={footprint} orientation={orientation} quality={quality} />}
    </group>
  )
}

interface GhostProps {
  id: PlacedShip['spec']['id']
  footprint: ReturnType<typeof footprintAt>
  orientation: 'horizontal' | 'vertical'
  quality: 'low' | 'high'
}

/** The carried ship, floating above the water with a tinted footprint showing whether it can be dropped. */
function Ghost({ id, footprint, orientation, quality }: GhostProps) {
  const placementLod = usePlacementLod()
  const ref = useRef<THREE.Group>(null)
  const cells = footprint.cells
  const a = cellToWorld(cells[0], PLAYER.origin, PLAYER.cellSize)
  const b = cellToWorld(cells[cells.length - 1], PLAYER.origin, PLAYER.cellSize)
  const x = (a[0] + b[0]) / 2
  const z = (a[2] + b[2]) / 2
  const rotationY = orientation === 'horizontal' ? 0 : -Math.PI / 2
  const tint = footprint.valid ? VALID : INVALID
  const spec = FLEET_BY_ID[id]
  const cellGeo = useMemo(() => new THREE.PlaneGeometry(0.92, 0.92), [])
  const cellMat = useMemo(() => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }), [])
  useEffect(() => () => void (cellGeo.dispose(), cellMat.dispose()), [cellGeo, cellMat])
  cellMat.color.set(tint)

  useFrame((state) => {
    const g = ref.current
    if (!g) return
    g.position.y = PLAYER.origin[1] + LIFT + Math.sin(state.clock.elapsedTime * 2.2) * 0.05
  })

  return (
    <group>
      <group ref={ref} position={[x, PLAYER.origin[1] + LIFT, z]} rotation-y={rotationY}>
        <Ship id={id} livery="pirate" damage={Array.from({ length: spec.length }, () => 'intact' as const)} quality={quality} lod={placementLod} sails={0.4} />
      </group>
      {cells.map((c) => {
        const p = cellToWorld(c, PLAYER.origin, PLAYER.cellSize)
        return <mesh key={`${c.x},${c.y}`} geometry={cellGeo} material={cellMat} position={[p[0], PLAYER.origin[1] + 0.06, p[2]]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2} />
      })}
    </group>
  )
}

function BattleWorld({ quality, over }: { quality: 'low' | 'high'; over: boolean }) {
  const playerBoard = useGameStore((s) => s.playerBoard)
  const enemyBoard = useGameStore((s) => s.enemyBoard)
  const events = useGameStore((s) => s.events)
  const turn = useGameStore((s) => s.turn)
  const hover = useUiStore((s) => s.hover)
  const pending = useUiStore((s) => s.pendingTarget)
  const setHover = useUiStore((s) => s.setHover)
  const requestFire = useBattleController((s) => s.requestFire)
  const busy = useBattleController((s) => s.busy)
  const firing = useDirector((s) => s.firing)
  const sinkProgress = useDirector((s) => s.sinkProgress)
  // the director keys sink progress by ShipId only; give each fleet just its own sunk ships' entries so the
  // player's man-o'-war does not go under when the enemy's does (BUG-361)
  const playerSink = useMemo(() => sinkFor(playerShips, sinkProgress), [playerShips, sinkProgress])
  const enemySink = useMemo(() => sinkFor(enemyShips, sinkProgress), [enemyShips, sinkProgress])
  const active = useDirector((s) => s.active)
  const impacted = useDirector((s) => s.impacted)
  const perf = usePerf()

  // while the director flies a ball, the world shows the board as it was before that shot
  const inFlight: PendingShot | null = active?.event.type === 'shot' && !impacted ? { by: active.event.by, target: active.event.target } : null
  const pendingKey = inFlight ? `${inFlight.by}:${inFlight.target.x},${inFlight.target.y}` : ''
  /* eslint-disable react-hooks/exhaustive-deps -- pendingKey stands in for the pending object */
  const myShots = useMemo(() => visibleShots(events, 'human', inFlight), [events, pendingKey])
  const theirShots = useMemo(() => visibleShots(events, 'enemy', inFlight), [events, pendingKey])
  const playerShips = useMemo(() => maskPendingHit(playerBoard.ships, inFlight?.by === 'enemy' ? inFlight.target : null), [playerBoard, pendingKey])
  const enemyShips = useMemo(() => maskPendingHit(enemyBoard.ships, inFlight?.by === 'human' ? inFlight.target : null), [enemyBoard, pendingKey])
  /* eslint-enable react-hooks/exhaustive-deps */
  const sunkEnemy = useMemo(() => enemyShips.filter(isSunk), [enemyShips])
  const playerWrecks = useMemo(() => settledWrecks(playerShips, sinkProgress), [playerShips, sinkProgress])
  const enemyWrecks = useMemo(() => settledWrecks(enemyShips, sinkProgress), [enemyShips, sinkProgress])
  // distance LOD, capped by the perf tier (medium shows at most one lod-0 ship per board unless the camera is close)
  const lod = perf.lod === 2 ? 2 : 'auto'
  const canAim = !over && turn === 'human' && !busy
  const target = pending ?? (hover?.side === 'enemy' ? hover.coord : null)
  const targetShot = target ? hasBeenShot(enemyBoard, target) : false

  useEffect(() => () => void (document.body.style.cursor = ''), [])

  return (
    <group>
      <BoardGrid origin={PLAYER.origin} color={PLAYER_ROPE} labels />
      <BoardGrid
        origin={ENEMY.origin}
        color={ENEMY_ROPE}
        highlight={canAim ? target : null}
        highlightColor={targetShot ? '#8a8a8a' : pending ? '#ffcc33' : '#e2473b'}
        onCellPointerMove={(c) => {
          setHover(c ? { side: 'enemy', coord: c } : null)
          document.body.style.cursor = c && canAim ? 'crosshair' : ''
        }}
        onCellClick={(c: Coord) => {
          if (canAim && !hasBeenShot(enemyBoard, c)) requestFire(c, lastPointerType)
        }}
      />
      <Fleet ships={playerShips} livery="pirate" boardOrigin={PLAYER.origin} quality={quality} lod={lod} firing={firing} sinkProgress={playerSink} />
      <Fleet ships={enemyShips} livery="navy" revealed={over} boardOrigin={ENEMY.origin} quality={quality} lod={lod} firing={firing} sinkProgress={enemySink} />
      <ShotMarkers shots={theirShots} boardOrigin={PLAYER.origin} fires={false} />
      <ShotMarkers shots={myShots} boardOrigin={ENEMY.origin} fires={!over} />
      {/* permanent light slots: fires + muzzle/impact flashes borrow these so the scene's light count never changes (no shader recompiles mid-battle) */}
      <FireLights />
      <FlashLights />
      <DamageLayer ships={playerShips} boardOrigin={PLAYER.origin} fires smoke breachSide="both" />
      <DamageLayer ships={over ? enemyShips : sunkEnemy} boardOrigin={ENEMY.origin} fires={false} smoke breachSide={null} />
      {playerWrecks.map((s) => (
        <Flotsam key={`p-${s.spec.id}`} cells={s.cells} boardOrigin={PLAYER.origin} seed={placedShipSeed(s)} livery="pirate" />
      ))}
      {enemyWrecks.map((s) => (
        <Flotsam key={`e-${s.spec.id}`} cells={s.cells} boardOrigin={ENEMY.origin} seed={placedShipSeed(s)} livery="navy" />
      ))}
    </group>
  )
}

// R3F's click handler doesn't expose the pointer type reliably for synthetic taps, so remember the last one.
let lastPointerType: string | undefined
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => void (lastPointerType = e.pointerType), { capture: true, passive: true })
}
