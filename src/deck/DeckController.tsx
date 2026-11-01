/**
 * "Third person" controller. Mounted inside `<OceanScene>` during the battle; while `deck.on` it owns the camera
 * (the rig's `'deck'` view stands down, `<CinematicCamera>` is not mounted): the player's pirate stands on one of their
 * own afloat ships, parented to the ship's wave motion, walks with WASD / arrows (Shift runs, Space hops), the mouse
 * drags to orbit, E at a glowing gun blends the camera into the gunner's eye, and a shot is picked by clicking a
 * square of the enemy chart (or a visible enemy cell in the world). The mouse is never locked and never aims: deck
 * mode is only a seat, every shot goes through `useBattleController().aim` exactly like the overview.
 *
 * Per frame, in order: ship pose (waves + sink pose, the very formula `<Fleet>`'s `Afloat` uses this frame) → walk /
 * jump pose on the deck polygons → third-person orbit + spring arm or gunner eye → blend → world. The pirate and the
 * gun markers live in a group whose matrix *is* the ship pose, so they can never lag the hull by a frame.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { director } from '../cinematics'
import { setPlayerDeck } from '../crew/playerPose'
import { isSunk } from '../engine'
import { BOARD_LAYOUT, boardCenter, type Vec3 } from '../scene/layout'
import { sampleWaveHeight } from '../scene/waves'
import { SHIPS, damageOf, shipWorldTransform } from '../ships'
import type { Livery } from '../ships/types'
import { ownBoardKey, useGameStore } from '../store/gameStore'
import { useUiStore } from '../ui/uiStore'
import { lastHitIndex, placedShipSeed, sinkPose } from '../vfx/sinking'
import { BLEND_SECONDS, TP_FOV, bestSpawnYaw, blendPose, blendProgress, blockersFor, clampOrbit, thirdPersonPose, type CameraPose, type OrbitLook } from './camera'
import { DECK_FOV, deckBus, type DeckBusEvent } from './contract'
import { resetDeckRuntime, useDeckStore } from './deckStore'
import { GunMarkers } from './GunMarkers'
import {
  ACCEL_TIME,
  GROUNDED,
  PITCH_LIMIT,
  RUN_SPEED,
  STATION_APPROACH,
  WALK_SPEED,
  afloatUids,
  angleDelta,
  approach,
  clamp,
  cycleShip,
  gunnerPose,
  lookForward,
  nearestStation,
  resolveDeckAnchors,
  sinkProgressFor,
  spawnPose,
  startJump,
  stationUsable,
  stationsOf,
  stepJump,
  stepOnDeck,
  type AirPose,
  type Station,
  type WalkPose,
} from './math'
import { Pirate, createGait } from './Pirate'

const DEFAULT_NEAR = 0.5
/** Near plane on deck (the default 0.5 would clip the pirate and the rail). */
const NEAR = 0.02
/** Seconds of the Tab fade-out, the abandon-ship fade-out and the overboard fade-out. */
const SWITCH_FADE = 0.3
const ABANDON_FADE = 1.2
const OVERBOARD_FADE = 0.9
const FADE_IN = 0.45
/** Screen radius (px) within which a click / tap on a gun mans it. */
const TAP_RADIUS = 44
/** Swing the manned gun this long before the shot resolves (the fleet's `firing` recoil). */
const SWING_MS = 220
/** Radians of orbit per pixel dragged at sensitivity 1 (mouse) / touch. */
const DRAG_PER_PIXEL = 0.005
const TOUCH_PER_PIXEL = 0.006
/** How far the gunner may glance away from the barrel while manning (radians). */
const GUN_GLANCE_YAW = 0.7
const GUN_GLANCE_PITCH = 0.35
/** The pirate is hidden once the camera is this close (spring arm pulled in) or the blend is past half way. */
const HIDE_ARM = 0.28
/** Critically-damped follow of the third-person camera (seconds to ~63 %); a boarding snaps. */
const FOLLOW_TAU = 0.07
/** First-entry hint. */
const HINT = 'Walk to a glowing gun and press E'
const HINT_MS = 3000

const tmp = {
  v: new THREE.Vector3(),
  w: new THREE.Vector3(),
  u: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  q2: new THREE.Quaternion(),
  e: new THREE.Euler(),
  m: new THREE.Matrix4(),
  s: new THREE.Vector3(1, 1, 1),
}
const tpPose: CameraPose = { position: [0, 0, 0], target: [0, 0, 0], arm: 1, slide: 0 }
const fpPose: CameraPose = { position: [0, 0, 0], target: [0, 0, 0], arm: 0, slide: 0 }
const outPose: CameraPose = { position: [0, 0, 0], target: [0, 0, 0], arm: 1, slide: 0 }

type Fade = { phase: 'out' | 'in'; t: number; seconds: number; then?: () => void } | null
type UsableStation = Station & { usable: boolean }

const isTypingTarget = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')
const focusIsFree = () => {
  const a = document.activeElement
  return !a || a === document.body || a.tagName === 'CANVAS'
}

export function DeckController() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const gl = useThree((s) => s.gl)
  const deck = useGameStore((s) => s.deck)
  const phase = useGameStore((s) => s.phase)
  const handoff = useGameStore((s) => s.handoff)
  const perspective = useGameStore((s) => s.perspective)
  const ownBoard = useGameStore((s) => s[ownBoardKey(s.perspective)])
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const ship = useMemo(() => ownBoard.ships.find((x) => x.uid === deck.shipUid) ?? null, [ownBoard, deck.shipUid])
  const active = deck.on && phase === 'battle' && !handoff && !!ship
  const livery: Livery = perspective === 'human' ? 'pirate' : 'navy'

  const ownOrigin = BOARD_LAYOUT[perspective === 'human' ? 'player' : 'enemy'].origin
  const foeBoard = BOARD_LAYOUT[perspective === 'human' ? 'enemy' : 'player']
  const foeCenter = useMemo(() => boardCenter(foeBoard), [foeBoard])

  const geometry = useMemo(() => {
    if (!ship) return null
    const anchors = SHIPS[ship.spec.id].anchors
    const deckA = resolveDeckAnchors(anchors, ship.spec.id)
    const transform = shipWorldTransform(ship, ownOrigin)
    const stations: UsableStation[] = stationsOf(anchors, deckA).map((s) => ({ ...s, usable: stationUsable(s, transform.rotationY, transform.position, foeCenter) }))
    const blockers = blockersFor(deckA, anchors.masts, ship.spec.id)
    return { anchors, deckA, transform, stations, blockers, hull: anchors.hull, seed: placedShipSeed(ship) }
  }, [ship, ownOrigin, foeCenter])

  // --- mutable per-frame state -------------------------------------------------------------------------------
  const pose = useRef<WalkPose>({ x: 0, z: 0, y: 0, level: 0 })
  const vel = useRef({ x: 0, z: 0 })
  const air = useRef<AirPose>(GROUNDED)
  const facing = useRef(0)
  const orbit = useRef<OrbitLook>({ yaw: 0, pitch: 0 })
  const glance = useRef({ yaw: 0, pitch: 0 })
  const blend = useRef({ t: 0, value: 0, to: 0 })
  const keys = useRef(new Set<string>())
  const shake = useRef(0)
  const shakeT = useRef(0)
  const lookAt = useRef<{ point: Vec3; seconds: number; t: number } | null>(null)
  const fade = useRef<Fade>(null)
  const abandoning = useRef(false)
  const standUid = useRef<string | null>(null)
  const hinted = useRef(false)
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean; touch: boolean } | null>(null)
  const tumble = useRef(0)
  const gait = useRef(createGait())
  const nearIndex = useRef(-1)
  const shipGroup = useRef<THREE.Group>(null)
  const pirateGroup = useRef<THREE.Group>(null)
  const fov = useRef(0)
  const smoothed = useRef<{ x: number; y: number; z: number; snap: boolean }>({ x: 0, y: 0, z: 0, snap: true })

  const activeRef = useRef(active)
  activeRef.current = active
  const geomRef = useRef(geometry)
  geomRef.current = geometry

  // --- boarding: spawn (or re-spawn on a new ship) -----------------------------------------------------------
  useEffect(() => {
    if (!active || !geometry || !ship) return
    if (standUid.current === ship.uid) return
    const first = standUid.current === null
    standUid.current = ship.uid
    // face the enemy waters, standing on their side of the deck (the camera orbits behind you over the centreline)
    const { rotationY, position } = geometry.transform
    const worldYaw = Math.atan2(-(foeCenter[0] - position[0]), -(foeCenter[2] - position[2]))
    const localYaw = worldYaw - rotationY
    let p = spawnPose(geometry.deckA)
    const side = lookForward(localYaw, 0)[2] >= 0 ? 1 : -1
    p = stepOnDeck({ ...p, z: side * Math.abs(p.z) }, 0, 0, geometry.deckA)
    pose.current = p
    vel.current = { x: 0, z: 0 }
    air.current = GROUNDED
    facing.current = localYaw
    orbit.current = { yaw: bestSpawnYaw([p.x, p.y, p.z], localYaw, geometry.blockers), pitch: 0 }
    blend.current = { t: 0, value: 0, to: 0 }
    smoothed.current.snap = true
    tpPose.slide = 0
    tumble.current = 0
    gait.current.tumble = 0
    gait.current.speed = 0
    gait.current.height = 0
    if (first && !hinted.current) {
      hinted.current = true
      useDeckStore.getState().showNudge(HINT, HINT_MS)
    }
  }, [active, geometry, ship, foeCenter])

  // --- camera lens + runtime flags while active ----------------------------------------------------------------
  useEffect(() => {
    if (!active) return
    camera.near = NEAR
    camera.fov = TP_FOV
    fov.current = TP_FOV
    camera.updateProjectionMatrix()
    useDeckStore.getState().setActive(true)
    const canvas = gl.domElement
    canvas.style.cursor = 'grab'
    return () => {
      camera.near = DEFAULT_NEAR
      camera.updateProjectionMatrix()
      canvas.style.cursor = ''
      standUid.current = null
      fade.current = null
      abandoning.current = false
      drag.current = null
      keys.current.clear()
      blend.current = { t: 0, value: 0, to: 0 }
      air.current = GROUNDED
      vel.current = { x: 0, z: 0 }
      resetDeckRuntime()
      setPlayerDeck(null)
      useUiStore.getState().setHover(null)
    }
  }, [active, camera, gl])

  // --- deckBus (session B emits; our own fallbacks also go through here) ------------------------------------
  useEffect(() => {
    const startFade = (seconds: number, then: () => void) => {
      fade.current = { phase: 'out', t: 0, seconds, then }
    }
    const leaveShip = (next: string | null | undefined, seconds: number) => {
      if (abandoning.current) return
      abandoning.current = true
      startFade(seconds, () => {
        const g = useGameStore.getState()
        const afloat = afloatUids(g[ownBoardKey(g.perspective)].ships)
        const target = next && afloat.includes(next) ? next : cycleShip(afloat, null)
        if (target && g.deck.shipUid !== target) g.boardShip(target)
        else if (!target) g.setDeck(false)
        else standUid.current = null // same ship: still respawn
        abandoning.current = false
        tumble.current = 0
      })
    }
    const handler = (e: DeckBusEvent | { type: string; nextUid?: string | null }) => {
      if (!activeRef.current) return
      const reduced = useGameStore.getState().settings.reducedMotion
      switch (e.type) {
        case 'shake':
          if (!reduced) shake.current = Math.min(1, shake.current + (e as Extract<DeckBusEvent, { type: 'shake' }>).intensity * 0.06)
          return
        case 'look-at': {
          const la = e as Extract<DeckBusEvent, { type: 'look-at' }>
          lookAt.current = { point: la.point, seconds: Math.max(0.05, la.seconds), t: 0 }
          return
        }
        case 'abandon-ship':
          leaveShip((e as Extract<DeckBusEvent, { type: 'abandon-ship' }>).nextUid, ABANDON_FADE)
          return
        case 'thrown-overboard':
          // session B: the hull cell under the player was hit — tumble, then wake on the next ship
          if (!reduced) {
            shake.current = Math.min(1, shake.current + 0.5)
            tumble.current = 1
          }
          useGameStore.getState().manStation(null)
          leaveShip(e.nextUid, OVERBOARD_FADE)
          return
        default:
          return
      }
    }
    return deckBus.on(handler as (e: DeckBusEvent) => void)
  }, [])

  // --- input -----------------------------------------------------------------------------------------------
  useEffect(() => {
    if (!active) return
    const canvas = gl.domElement
    const game = () => useGameStore.getState()
    const runtime = () => useDeckStore.getState()

    const nextShip = () => {
      const g = game()
      const afloat = afloatUids(g[ownBoardKey(g.perspective)].ships)
      const next = cycleShip(afloat, g.deck.shipUid)
      if (!next || next === g.deck.shipUid || fade.current) return
      fade.current = { phase: 'out', t: 0, seconds: SWITCH_FADE, then: () => game().boardShip(next) }
    }

    const man = (st: UsableStation) => {
      const g = game()
      pose.current = { ...pose.current, x: st.stand[0], z: st.stand[2], y: st.stand[1] }
      vel.current = { x: 0, z: 0 }
      air.current = GROUNDED
      facing.current = st.yaw
      glance.current = { yaw: 0, pitch: 0 }
      g.manStation(st.index)
    }

    const toggleStation = () => {
      const g = game()
      if (g.deck.station !== null) return g.manStation(null)
      const geom = geomRef.current
      if (!geom) return
      const near = nearestStation(geom.stations, pose.current.x, pose.current.z)
      if (!near) return runtime().showNudge('Walk to a glowing gun and press E')
      const st = geom.stations[near.index]
      if (!st.usable) return runtime().showNudge('No target that side')
      man(st)
    }

    /** The gun whose stand projects within TAP_RADIUS px of the pointer, if any. */
    const stationAtPixel = (clientX: number, clientY: number): UsableStation | null => {
      const geom = geomRef.current
      const group = shipGroup.current
      if (!geom || !group) return null
      const rect = canvas.getBoundingClientRect()
      let best: UsableStation | null = null
      let bestD = TAP_RADIUS
      for (const st of geom.stations) {
        if (!st.onDeck) continue
        tmp.v.set(st.stand[0], st.stand[1] + 0.08, st.stand[2]).applyMatrix4(group.matrix)
        tmp.v.project(camera)
        if (tmp.v.z > 1) continue
        const sx = rect.left + ((tmp.v.x + 1) / 2) * rect.width
        const sy = rect.top + ((1 - tmp.v.y) / 2) * rect.height
        const d = Math.hypot(sx - clientX, sy - clientY)
        if (d < bestD) {
          bestD = d
          best = st
        }
      }
      return best
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return
      const k = e.key === ' ' ? 'space' : e.key.toLowerCase()
      if (k === 'tab' && focusIsFree()) {
        e.preventDefault()
        nextShip()
        return
      }
      if (k === 'e') {
        if (!e.repeat) toggleStation()
        return
      }
      if (k === 'space') {
        if (!focusIsFree()) return
        e.preventDefault()
        if (game().deck.station === null && !fade.current && !e.repeat) air.current = startJump(air.current)
        return
      }
      if (['w', 'a', 's', 'd', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        if (k.startsWith('arrow') && !focusIsFree()) return
        if (k.startsWith('arrow')) e.preventDefault()
        keys.current.add(k)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.key === ' ' ? 'space' : e.key.toLowerCase())
    const onBlur = () => {
      keys.current.clear()
      drag.current = null
      canvas.style.cursor = 'grab'
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') onBlur()
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType !== 'touch') return
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, touch: e.pointerType === 'touch' }
      if (!drag.current.touch) canvas.style.cursor = 'grabbing'
    }
    const onPointerMove = (e: PointerEvent) => {
      const d = drag.current
      if (!d || e.pointerId !== d.id) return
      const dx = e.clientX - d.x
      const dy = e.clientY - d.y
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 6) d.moved = true
      if (!d.moved) return
      const g = game()
      const k = (d.touch ? TOUCH_PER_PIXEL : DRAG_PER_PIXEL) * g.settings.deckSensitivity
      const inv = g.settings.deckInvertY ? -1 : 1
      if (g.deck.station !== null) {
        glance.current.yaw = clamp(glance.current.yaw - dx * k, -GUN_GLANCE_YAW, GUN_GLANCE_YAW)
        glance.current.pitch = clamp(glance.current.pitch - dy * k * inv, -GUN_GLANCE_PITCH, GUN_GLANCE_PITCH)
      } else {
        orbit.current.yaw -= dx * k
        orbit.current.pitch = clampOrbit(orbit.current.pitch + dy * k * inv)
      }
      d.x = e.clientX
      d.y = e.clientY
    }
    const onPointerUp = (e: PointerEvent) => {
      const d = drag.current
      if (!d || e.pointerId !== d.id) return
      drag.current = null
      canvas.style.cursor = 'grab'
      if (d.moved || e.type === 'pointercancel') return
      // a plain click: man the gun under the pointer (any view); while manning, the chart / 3-D grid pick the target
      const st = stationAtPixel(e.clientX, e.clientY)
      if (st) {
        if (!st.usable) return runtime().showNudge('No target that side')
        if (game().deck.station !== st.index) man(st)
        return
      }
      if (d.touch && game().deck.station === null) runtime().showNudge('Tap a glowing gun to man it, then tap the chart to fire')
    }

    const onNextEvent = () => nextShip()
    // HUD "Man the gun": the gun within reach, else walk straight to the nearest gun that bears (touch / keyboard-only path)
    const onManEvent = () => {
      const geom = geomRef.current
      if (!geom) return
      const near = nearestStation(geom.stations, pose.current.x, pose.current.z)
      if (near && geom.stations[near.index].usable) return man(geom.stations[near.index])
      let best: UsableStation | null = null
      let bestD = Infinity
      for (const st of geom.stations) {
        if (!st.onDeck || !st.usable) continue
        const d = Math.hypot(st.stand[0] - pose.current.x, st.stand[2] - pose.current.z)
        if (d < bestD) {
          bestD = d
          best = st
        }
      }
      if (best) man(best)
      else runtime().showNudge('No gun on this ship bears on the enemy waters')
    }
    window.addEventListener('battleship:deck-man', onManEvent)
    window.addEventListener('battleship:deck-next', onNextEvent)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    canvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('battleship:deck-man', onManEvent)
      window.removeEventListener('battleship:deck-next', onNextEvent)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      keys.current.clear()
    }
  }, [active, gl, camera])

  // --- per frame ------------------------------------------------------------------------------------------------
  useFrame((state, delta) => {
    const group = shipGroup.current
    if (!active || !geometry || !ship || !group) return
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    const g = useGameStore.getState()
    const runtime = useDeckStore.getState()
    const manning = g.deck.station !== null ? geometry.stations[g.deck.station] : null

    // 1. ship world pose: exactly what <Fleet>'s Afloat group does this frame (wave height + sink pose)
    const { position, rotationY } = geometry.transform
    const sunk = isSunk(ship)
    const sink = sinkProgressFor(sunk, director.store.getState().sinkProgress[ship.uid])
    const sp = sinkPose(sink, { seed: geometry.seed, hull: geometry.hull, damage: damageOf(ship), lastHit: lastHitIndex(ship) })
    const y = position[1] - sp.depth + sampleWaveHeight(position[0], position[2], t)
    tmp.q.setFromEuler(tmp.e.set(0, rotationY + sp.yaw, 0))
    tmp.q.multiply(tmp.q2.setFromEuler(tmp.e.set(sp.roll, 0, sp.pitch)))
    tmp.m.compose(tmp.w.set(position[0], y, position[2]), tmp.q, tmp.s.set(1, 1, 1))
    group.matrix.copy(tmp.m)
    group.matrixWorldNeedsUpdate = true

    // 2. walking (any walk input steps away from a manned gun), frame-rate independent with a short acceleration
    const k = keys.current
    const fwd = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0) + (k.has('arrowup') ? 1 : 0) - (k.has('arrowdown') ? 1 : 0)
    const strafe = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0) + (k.has('arrowright') ? 1 : 0) - (k.has('arrowleft') ? 1 : 0)
    const wantsMove = (fwd !== 0 || strafe !== 0) && !fade.current && tumble.current === 0
    if (wantsMove && manning) g.manStation(null)
    let wx = 0
    let wz = 0
    if (wantsMove) {
      const speed = k.has('shift') ? RUN_SPEED : WALK_SPEED
      const f = lookForward(orbit.current.yaw, 0)
      const rx = Math.cos(orbit.current.yaw)
      const rz = -Math.sin(orbit.current.yaw)
      const len = Math.hypot(fwd, strafe) || 1
      wx = ((f[0] * fwd + rx * strafe) / len) * speed
      wz = ((f[2] * fwd + rz * strafe) / len) * speed
    }
    vel.current.x = approach(vel.current.x, wx, dt, ACCEL_TIME)
    vel.current.z = approach(vel.current.z, wz, dt, ACCEL_TIME)
    const speed = Math.hypot(vel.current.x, vel.current.z)
    if (speed < 0.005) {
      vel.current.x = 0
      vel.current.z = 0
    }
    const stillManning = g.deck.station !== null
    if (!stillManning && (vel.current.x !== 0 || vel.current.z !== 0)) {
      const before = pose.current.y
      pose.current = stepOnDeck(pose.current, vel.current.x * dt, vel.current.z * dt, geometry.deckA)
      if (air.current.airborne) air.current = stepJump(air.current, dt, before, pose.current.y)
      else if (speed > 0.02) facing.current += angleDelta(facing.current, Math.atan2(-vel.current.x, -vel.current.z)) * (1 - Math.exp(-dt / 0.08))
    } else if (air.current.airborne) air.current = stepJump(air.current, dt, pose.current.y, pose.current.y)
    if (air.current.airborne && speed > 0.02) facing.current += angleDelta(facing.current, Math.atan2(-vel.current.x, -vel.current.z)) * (1 - Math.exp(-dt / 0.08))
    if (!air.current.airborne && !wantsMove && speed === 0 && !stillManning) {
      // settle on the deck under the feet (the ramps blend; a ship switch snaps)
      pose.current = stepOnDeck(pose.current, 0, 0, geometry.deckA)
    }

    runtime.setAirborne(air.current.airborne)

    // the crew keeps clear of the player (src/crew)
    setPlayerDeck(ship.uid, pose.current.x, pose.current.z, g.deck.station ?? -1)

    // 3. station proximity → markers + HUD prompt
    const nearSt = stillManning ? null : nearestStation(geometry.stations, pose.current.x, pose.current.z)
    runtime.setNear(nearSt ? { index: nearSt.index, usable: geometry.stations[nearSt.index].usable } : null)
    nearIndex.current = nearSt && geometry.stations[nearSt.index].usable ? nearSt.index : -1
    let approachSt: UsableStation | null = null
    if (!stillManning) {
      let bestD = STATION_APPROACH
      for (const st of geometry.stations) {
        if (!st.onDeck || !st.usable) continue
        const d = Math.hypot(st.stand[0] - pose.current.x, st.stand[2] - pose.current.z)
        if (d < bestD) {
          bestD = d
          approachSt = st
        }
      }
    }
    runtime.setApproach(approachSt ? approachSt.index : null)

    // 4. look-at nudges (incoming ball, sinking ship) swing the orbit / glance toward a world point
    const la = lookAt.current
    if (la) {
      la.t += dt
      const wxp = la.point[0] - camera.position.x
      const wyp = la.point[1] - camera.position.y
      const wzp = la.point[2] - camera.position.z
      const worldYaw = Math.atan2(-wxp, -wzp)
      const wantYaw = worldYaw - (rotationY + sp.yaw)
      const f = 1 - Math.exp((-4 / la.seconds) * dt)
      if (stillManning) {
        const baseYaw = manning ? gunnerPose(manning).yaw : 0
        glance.current.yaw += (clamp(angleDelta(baseYaw, wantYaw), -GUN_GLANCE_YAW, GUN_GLANCE_YAW) - glance.current.yaw) * f
      } else {
        orbit.current.yaw += angleDelta(orbit.current.yaw, wantYaw) * f
        const wantPitch = clampOrbit(-Math.atan2(wyp, Math.hypot(wxp, wzp)) * 0.5)
        orbit.current.pitch += (wantPitch - orbit.current.pitch) * f
      }
      if (la.t >= la.seconds) lookAt.current = null
    }

    // 5. blend third ↔ first person (reduced motion cuts)
    const b = blend.current
    b.to = stillManning ? 1 : 0
    if (b.value !== b.to) {
      b.t += dt
      const p = blendProgress(b.t, reducedMotion ? 0 : BLEND_SECONDS)
      b.value = b.to === 1 ? p : 1 - p
      if (p >= 1) b.value = b.to
    } else b.t = 0

    // 6. the two poses in ship space
    const feet: Vec3 = [pose.current.x, pose.current.y + air.current.height, pose.current.z]
    const prevSlide = tpPose.slide
    thirdPersonPose(feet, orbit.current, geometry.blockers, tpPose)
    // damped follow in ship space (the spring arm and the deck steps never snap the camera; a boarding or a slide to
    // the other side of a mast does — the damped path would cut through it)
    const sm = smoothed.current
    if (sm.snap || tpPose.slide !== prevSlide) {
      sm.x = tpPose.position[0]
      sm.y = tpPose.position[1]
      sm.z = tpPose.position[2]
      sm.snap = false
    } else {
      sm.x = approach(sm.x, tpPose.position[0], dt, FOLLOW_TAU)
      sm.y = approach(sm.y, tpPose.position[1], dt, FOLLOW_TAU)
      sm.z = approach(sm.z, tpPose.position[2], dt, FOLLOW_TAU)
    }
    tpPose.position[0] = sm.x
    tpPose.position[1] = sm.y
    tpPose.position[2] = sm.z
    if (manning) {
      const gp = gunnerPose(manning)
      const dir = lookForward(gp.yaw + glance.current.yaw, clamp(gp.pitch + glance.current.pitch, -PITCH_LIMIT, PITCH_LIMIT))
      fpPose.position[0] = gp.position[0]
      fpPose.position[1] = gp.position[1]
      fpPose.position[2] = gp.position[2]
      fpPose.target[0] = gp.position[0] + dir[0]
      fpPose.target[1] = gp.position[1] + dir[1]
      fpPose.target[2] = gp.position[2] + dir[2]
    } else if (b.value > 0) {
      // stepping away: blend back from the eye over the feet
      fpPose.position[0] = feet[0]
      fpPose.position[1] = feet[1] + 0.15
      fpPose.position[2] = feet[2]
      const dir = lookForward(facing.current, 0)
      fpPose.target[0] = feet[0] + dir[0]
      fpPose.target[1] = feet[1] + 0.15 + dir[1]
      fpPose.target[2] = feet[2] + dir[2]
    }
    const cam = b.value <= 0 ? tpPose : b.value >= 1 ? fpPose : blendPose(tpPose, fpPose, b.value, outPose)

    // 7. shake: the director's impulses (CinematicCamera is not mounted on deck) + deckBus shakes
    const ds = director.store.getState()
    if (ds.shake > 0) {
      if (!reducedMotion) shake.current = Math.min(1, shake.current + ds.shake * 0.25)
      director.store.setState({ shake: 0 })
    }
    shake.current *= Math.exp(-dt * 5)
    shakeT.current += dt
    const amp = reducedMotion ? 0 : shake.current * 0.08
    const st = shakeT.current

    // 8. to world: the same ship matrix the hull uses this frame
    tmp.v.set(cam.position[0] + Math.sin(st * 37.1) * amp, cam.position[1] + Math.sin(st * 51.7 + 1.3) * amp * 0.8, cam.position[2] + Math.sin(st * 43.3 + 2.1) * amp * 0.6).applyMatrix4(tmp.m)
    tmp.w.set(cam.target[0], cam.target[1], cam.target[2]).applyMatrix4(tmp.m)
    camera.position.copy(tmp.v)
    // level horizon (the ship rolls under you); a gentle sway unless reduced motion
    tmp.u.set(0, 1, 0)
    camera.up.copy(tmp.u)
    camera.lookAt(tmp.w)
    if (!reducedMotion) camera.quaternion.multiply(tmp.q2.setFromEuler(tmp.e.set(Math.sin(t * 0.8 + 1) * 0.004, Math.sin(t * 0.5) * 0.006, 0, 'YXZ')))
    const wantFov = TP_FOV + (DECK_FOV - TP_FOV) * b.value
    if (Math.abs(fov.current - wantFov) > 0.01) {
      fov.current = wantFov
      camera.fov = wantFov
      camera.updateProjectionMatrix()
    }

    // 9. the pirate: feet on the deck in ship space, facing the walk direction; hidden in first person / when the arm is pulled in
    const pg = pirateGroup.current
    if (pg) {
      pg.position.set(feet[0], feet[1], feet[2])
      pg.rotation.set(0, facing.current + Math.PI, tumble.current * (1 + Math.sin(st * 9) * 0.3))
      pg.visible = b.value < 0.5 && cam.arm >= HIDE_ARM
      const gt = gait.current
      gt.speed = speed
      gt.height = air.current.height
      gt.tumble = tumble.current
    }

    // 10. the floating "E — Man the gun" label and the compass arrow (DOM, no React)
    const label = runtime.labelEl
    if (label) {
      if (approachSt && b.value < 0.5) {
        tmp.v.set(approachSt.stand[0], approachSt.stand[1] + 0.16, approachSt.stand[2]).applyMatrix4(tmp.m).project(camera)
        if (tmp.v.z < 1 && Math.abs(tmp.v.x) < 1.1 && Math.abs(tmp.v.y) < 1.1) {
          const sx = ((tmp.v.x + 1) / 2) * state.size.width
          const sy = ((1 - tmp.v.y) / 2) * state.size.height
          label.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`
          label.style.opacity = '1'
        } else label.style.opacity = '0'
      } else label.style.opacity = '0'
    }
    const compass = runtime.compassEl
    if (compass) {
      let target: UsableStation | null = null
      if (!stillManning) {
        let bestD = Infinity
        for (const s of geometry.stations) {
          if (!s.onDeck || !s.usable) continue
          const d = Math.hypot(s.stand[0] - pose.current.x, s.stand[2] - pose.current.z)
          if (d < bestD) {
            bestD = d
            target = s
          }
        }
      }
      if (target) {
        // angle from the camera's forward (screen up) to the gun, in ship space
        camera.getWorldDirection(tmp.u)
        const camYawWorld = Math.atan2(-tmp.u.x, -tmp.u.z)
        const toYawLocal = Math.atan2(-(target.stand[0] - pose.current.x), -(target.stand[2] - pose.current.z))
        const toYawWorld = toYawLocal + rotationY + sp.yaw
        const rel = angleDelta(camYawWorld, toYawWorld)
        compass.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`
        compass.style.opacity = '1'
      } else compass.style.opacity = '0'
    }

    // 11. standing ship went down and nobody played an abandon-ship beat: our own, once the director is done with the sink
    if (sunk && !abandoning.current && !fade.current && !ds.busy) {
      const afloat = afloatUids(g[ownBoardKey(g.perspective)].ships)
      deckBus.emit({ type: 'abandon-ship', nextUid: cycleShip(afloat, null) })
    }

    // 12. fades (Tab switch, abandon ship, overboard)
    const fd = fade.current
    if (fd) {
      fd.t += dt
      if (fd.phase === 'out') {
        runtime.setFade(Math.min(1, fd.t / fd.seconds))
        if (fd.t >= fd.seconds) {
          const then = fd.then
          fade.current = { phase: 'in', t: 0, seconds: FADE_IN }
          then?.()
        }
      } else {
        runtime.setFade(Math.max(0, 1 - fd.t / fd.seconds))
        if (fd.t >= fd.seconds) fade.current = null
      }
    }
  })

  if (!active || !geometry) return null
  return (
    <group ref={shipGroup} matrixAutoUpdate={false}>
      <group ref={pirateGroup}>
        <Pirate livery={livery} gait={gait} />
      </group>
      <GunMarkers stations={geometry.stations} near={nearIndex} />
    </group>
  )
}

/** Cannon index + side of the manned gun, for the fleet's `firing` recoil before a deck shot. */
export function mannedCannon(): { uid: string; cell: number; side: 'port' | 'starboard' } | null {
  const g = useGameStore.getState()
  if (!g.deck.on || g.deck.station === null || !g.deck.shipUid) return null
  const ship = g[ownBoardKey(g.perspective)].ships.find((x) => x.uid === g.deck.shipUid)
  if (!ship) return null
  const c = SHIPS[ship.spec.id].anchors.cannons[g.deck.station]
  return c ? { uid: ship.uid, cell: c.cell, side: c.side } : null
}

export const SWING_DELAY_MS = SWING_MS
