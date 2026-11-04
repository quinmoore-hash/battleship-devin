/**
 * "On deck" first-person controller. Mounted inside `<OceanScene>` during the battle; while `deck.on` it owns the
 * camera (the rig's `'deck'` view stands down, `<CinematicCamera>` is not mounted): the player stands at eye height on
 * one of their own afloat ships, parented to the ship's wave motion, walks with WASD / arrows (Shift runs, Space hops),
 * the mouse drags to look (never locked), E at a glowing gun puts them at the gunner's eye, and a shot is picked by
 * clicking a square of the enemy chart (or a visible enemy cell in the world). The mouse never aims: deck mode is only
 * a seat, every shot goes through `useBattleController().aim` exactly like the overview. The director may borrow the
 * camera (`deckCameraLease`, session B): the controller then keeps walking but skips its camera write.
 *
 * Per frame, in order: ship pose (waves + sink pose, the very formula `<Fleet>`'s `Afloat` uses this frame) → walk /
 * jump pose on the deck polygons → eye (walking) or gunner eye (manning) → world. The gun markers live in a group
 * whose matrix *is* the ship pose, so they can never lag the hull by a frame.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { director } from '../cinematics'
import { deckGunIndex } from '../cinematics/pov'
import { setPlayerDeck } from '../crew/playerPose'
import { isSunk } from '../engine'
import { BOARD_LAYOUT, boardCenter, type Vec3 } from '../scene/layout'
import { sampleWaveHeight } from '../scene/waves'
import { SHIPS, damageOf, shipWorldTransform } from '../ships'
import { ownBoardKey, useGameStore } from '../store/gameStore'
import { useUiStore } from '../ui/uiStore'
import { lastHitIndex, placedShipSeed, sinkPose } from '../vfx/sinking'
import { DECK_FOV, deckBus, deckCameraLease, type DeckBusEvent } from './contract'
import { applyDeckLens, applyOverviewLens, hasDeckLens } from './lens'
import { resetDeckRuntime, useDeckStore } from './deckStore'
import { GunMarkers } from './GunMarkers'
import {
  ACCEL_TIME,
  GROUNDED,
  NO_PICK,
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
  pickStation,
  resolveDeckAnchors,
  sinkProgressFor,
  spawnPose,
  startJump,
  stationUsable,
  stationsOf,
  stepJump,
  stepOnDeck,
  walkEyeHeight,
  type AirPose,
  type Station,
  type StationPick,
  type WalkPose,
} from './math'

/** Seconds of the Tab fade-out, the abandon-ship fade-out and the overboard fade-out. */
const SWITCH_FADE = 0.3
const ABANDON_FADE = 1.2
/** Thrown overboard: the director's tumble / swim beat plays for `seconds`, then this fade and the climb aboard the next ship. */
const OVERBOARD_FADE = 0.35
/** The fade is black this long before the beat ends, so the camera never hands back on a frame that is not black yet (BUG-723). */
const OVERBOARD_LEAD = 0.2
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
const eye = { position: [0, 0, 0] as Vec3, target: [0, 0, 0] as Vec3 }

/** `hold`: black, waiting for the director to hand the camera back (thrown overboard) — the fade-in starts on the `camera` event. */
type Fade = { phase: 'out' | 'in' | 'hold'; t: number; seconds: number; then?: () => void } | null
/** Longest the screen stays black waiting for the camera hand-back before fading in anyway (a skipped / cancelled beat). */
const HOLD_MAX = 2.5
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

  const ownOrigin = BOARD_LAYOUT[perspective === 'human' ? 'player' : 'enemy'].origin
  const foeBoard = BOARD_LAYOUT[perspective === 'human' ? 'enemy' : 'player']
  const foeCenter = useMemo(() => boardCenter(foeBoard), [foeBoard])

  const geometry = useMemo(() => {
    if (!ship) return null
    const anchors = SHIPS[ship.spec.id].anchors
    const deckA = resolveDeckAnchors(anchors, ship.spec.id)
    const transform = shipWorldTransform(ship, ownOrigin)
    const stations: UsableStation[] = stationsOf(anchors, deckA).map((s) => ({ ...s, usable: stationUsable(s, transform.rotationY, transform.position, foeCenter) }))
    return { anchors, deckA, transform, stations, hull: anchors.hull, seed: placedShipSeed(ship), eyeHeight: walkEyeHeight(deckA, stations) }
  }, [ship, ownOrigin, foeCenter])

  // --- mutable per-frame state -------------------------------------------------------------------------------
  const pose = useRef<WalkPose>({ x: 0, z: 0, y: 0, level: 0 })
  const vel = useRef({ x: 0, z: 0 })
  const air = useRef<AirPose>(GROUNDED)
  const look = useRef({ yaw: 0, pitch: 0 })
  const glance = useRef({ yaw: 0, pitch: 0 })
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
  const nearIndex = useRef(-1)
  const mannedIndex = useRef(-1)
  const pick = useRef<StationPick>(NO_PICK)
  const shipGroup = useRef<THREE.Group>(null)

  const activeRef = useRef(active)
  activeRef.current = active
  const geomRef = useRef(geometry)
  geomRef.current = geometry

  // --- boarding: spawn (or re-spawn on a new ship) -----------------------------------------------------------
  const spawn = useCallback(() => {
    const geometry = geomRef.current
    if (!geometry) return
    // face the enemy waters, standing on their side of the deck
    const { rotationY, position } = geometry.transform
    const worldYaw = Math.atan2(-(foeCenter[0] - position[0]), -(foeCenter[2] - position[2]))
    const localYaw = worldYaw - rotationY
    let p = spawnPose(geometry.deckA)
    const side = lookForward(localYaw, 0)[2] >= 0 ? 1 : -1
    p = stepOnDeck({ ...p, z: side * Math.abs(p.z) }, 0, 0, geometry.deckA)
    pose.current = p
    vel.current = { x: 0, z: 0 }
    air.current = GROUNDED
    look.current = { yaw: localYaw, pitch: 0 }
    glance.current = { yaw: 0, pitch: 0 }
    tumble.current = 0
  }, [foeCenter])
  useEffect(() => {
    if (!active || !geometry || !ship) return
    if (standUid.current === ship.uid) return
    const first = standUid.current === null
    standUid.current = ship.uid
    spawn()
    if (first && !hinted.current) {
      hinted.current = true
      useDeckStore.getState().showNudge(HINT, HINT_MS)
    }
  }, [active, geometry, ship, spawn])

  // --- camera lens + runtime flags while active ----------------------------------------------------------------
  useEffect(() => {
    if (!active) return
    const pressed = keys.current
    applyDeckLens(camera)
    useDeckStore.getState().setActive(true)
    const canvas = gl.domElement
    canvas.style.cursor = 'grab'
    return () => {
      applyOverviewLens(camera)
      canvas.style.cursor = ''
      standUid.current = null
      fade.current = null
      abandoning.current = false
      drag.current = null
      pressed.clear()
      air.current = GROUNDED
      vel.current = { x: 0, z: 0 }
      resetDeckRuntime()
      setPlayerDeck(null)
      useUiStore.getState().setHover(null)
    }
  }, [active, camera, gl])

  // --- deckBus (session B emits; our own fallbacks also go through here) ------------------------------------
  useEffect(() => {
    /** `delay` > 0 holds the fade-out back that long (t starts negative) while the director's beat still plays. */
    const startFade = (seconds: number, then: () => void, delay = 0) => {
      fade.current = { phase: 'out', t: -delay, seconds, then }
    }
    const leaveShip = (next: string | null | undefined, seconds: number, delay = 0) => {
      if (abandoning.current) return
      abandoning.current = true
      startFade(seconds, () => {
        const g = useGameStore.getState()
        const afloat = afloatUids(g[ownBoardKey(g.perspective)].ships)
        const target = next && afloat.includes(next) ? next : cycleShip(afloat, null)
        if (target && g.deck.shipUid !== target) g.boardShip(target)
        else if (!target) g.setDeck(false)
        else spawn() // same ship (the last one afloat): climb back aboard at the spawn anchor
        abandoning.current = false
        tumble.current = 0
      }, delay)
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
          // the fade is black OVERBOARD_LEAD before the beat ends; the director hands the camera back once it reads black
          const ob = e as Extract<DeckBusEvent, { type: 'thrown-overboard' }>
          leaveShip(ob.nextUid, OVERBOARD_FADE, Math.max(0, (ob.seconds ?? 0) - OVERBOARD_FADE - OVERBOARD_LEAD))
          return
        case 'camera': {
          // the director handed the camera back early (skip, V mid-beat): a pending overboard fade starts right away
          const fd = fade.current
          if ((e as Extract<DeckBusEvent, { type: 'camera' }>).owner !== 'deck' || !fd) return
          if (fd.phase === 'out' && fd.t < 0) fd.t = 0
          // black and already aboard: the camera is ours again, lift the fade
          if (fd.phase === 'hold') fade.current = { phase: 'in', t: 0, seconds: FADE_IN }
          return
        }
        default:
          return
      }
    }
    return deckBus.on(handler as (e: DeckBusEvent) => void)
  }, [spawn])

  // --- input -----------------------------------------------------------------------------------------------
  useEffect(() => {
    if (!active) return
    const canvas = gl.domElement
    const pressed = keys.current
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
      look.current = { yaw: st.yaw, pitch: 0 }
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
        look.current.yaw -= dx * k
        look.current.pitch = clamp(look.current.pitch - dy * k * inv, -PITCH_LIMIT, PITCH_LIMIT)
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
      pressed.clear()
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
      const f = lookForward(look.current.yaw, 0)
      const rx = Math.cos(look.current.yaw)
      const rz = -Math.sin(look.current.yaw)
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
    } else if (air.current.airborne) air.current = stepJump(air.current, dt, pose.current.y, pose.current.y)
    if (!air.current.airborne && !wantsMove && speed === 0 && !stillManning) {
      // settle on the deck under the feet (the ramps blend; a ship switch snaps)
      pose.current = stepOnDeck(pose.current, 0, 0, geometry.deckA)
    }

    runtime.setAirborne(air.current.airborne)
    runtime.setRunning(wantsMove && k.has('shift'))

    // the crew keeps clear of the player (src/crew)
    setPlayerDeck(ship.uid, pose.current.x, pose.current.z, g.deck.station ?? -1)

    // 3. station proximity → markers + HUD prompt (a hysteresis pick: two equidistant stands used to flip it every frame)
    pick.current = stillManning ? NO_PICK : pickStation(geometry.stations, pose.current.x, pose.current.z, pick.current, t)
    const nearSt = pick.current.index >= 0 ? geometry.stations[pick.current.index] : null
    runtime.setNear(nearSt ? { index: nearSt.index, usable: nearSt.usable } : null)
    nearIndex.current = nearSt?.usable ? nearSt.index : -1
    mannedIndex.current = g.deck.station ?? -1
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

    // 4. look-at nudges (incoming ball, sinking ship) swing the look / glance toward a world point
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
        look.current.yaw += angleDelta(look.current.yaw, wantYaw) * f
        const wantPitch = clamp(Math.atan2(wyp, Math.hypot(wxp, wzp)) * 0.5, -PITCH_LIMIT, PITCH_LIMIT)
        look.current.pitch += (wantPitch - look.current.pitch) * f
      }
      if (la.t >= la.seconds) lookAt.current = null
    }

    // 5. the eye in ship space: the gunner's eye (+ glance) while manning, else `walkEyeHeight` over the feet looking along `look`
    if (manning) {
      const gp = gunnerPose(manning)
      const dir = lookForward(gp.yaw + glance.current.yaw, clamp(gp.pitch + glance.current.pitch, -PITCH_LIMIT, PITCH_LIMIT))
      eye.position[0] = gp.position[0]
      eye.position[1] = gp.position[1]
      eye.position[2] = gp.position[2]
      eye.target[0] = gp.position[0] + dir[0]
      eye.target[1] = gp.position[1] + dir[1]
      eye.target[2] = gp.position[2] + dir[2]
    } else {
      const dir = lookForward(look.current.yaw, look.current.pitch)
      eye.position[0] = pose.current.x
      eye.position[1] = pose.current.y + air.current.height + geometry.eyeHeight
      eye.position[2] = pose.current.z
      eye.target[0] = eye.position[0] + dir[0]
      eye.target[1] = eye.position[1] + dir[1]
      eye.target[2] = eye.position[2] + dir[2]
    }

    // 6. shake: the director's impulses (CinematicCamera is not mounted on deck) + deckBus shakes
    const ds = director.store.getState()
    if (ds.shake > 0) {
      if (!reducedMotion) shake.current = Math.min(1, shake.current + ds.shake * 0.25)
      director.store.setState({ shake: 0 })
    }
    shake.current *= Math.exp(-dt * 5)
    shakeT.current += dt
    const amp = reducedMotion ? 0 : shake.current * 0.08
    const st = shakeT.current

    // 7. to world: the same ship matrix the hull uses this frame. Skipped while the director has borrowed the camera
    // for a follow-cam / overboard beat (session B, `deckCameraLease`): the walk state keeps updating underneath.
    if (deckCameraLease.owner !== 'director') {
      // a borrowed sequence that ended before its return beat finished (skip, slow frame) can leave its lens behind
      if (camera.fov !== DECK_FOV || !hasDeckLens(camera)) applyDeckLens(camera)
      tmp.v.set(eye.position[0] + Math.sin(st * 37.1) * amp, eye.position[1] + Math.sin(st * 51.7 + 1.3) * amp * 0.8, eye.position[2] + Math.sin(st * 43.3 + 2.1) * amp * 0.6).applyMatrix4(tmp.m)
      tmp.w.set(eye.target[0], eye.target[1], eye.target[2]).applyMatrix4(tmp.m)
      camera.position.copy(tmp.v)
      // level horizon (the ship rolls under you); a gentle sway unless reduced motion; going overboard rolls the view
      tmp.u.set(0, 1, 0)
      camera.up.copy(tmp.u)
      camera.lookAt(tmp.w)
      if (!reducedMotion) camera.quaternion.multiply(tmp.q2.setFromEuler(tmp.e.set(Math.sin(t * 0.8 + 1) * 0.004, Math.sin(t * 0.5) * 0.006, tumble.current * (0.9 + Math.sin(st * 9) * 0.3), 'YXZ')))
    }

    // 8. the floating "E — Man the gun" label and the compass arrow (DOM, no React)
    const label = runtime.labelEl
    if (label) {
      if (approachSt && !stillManning) {
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

    // 9. standing ship went down and nobody played an abandon-ship beat: our own, once the director is done with the sink
    if (sunk && !abandoning.current && !fade.current && !ds.busy) {
      const afloat = afloatUids(g[ownBoardKey(g.perspective)].ships)
      deckBus.emit({ type: 'abandon-ship', nextUid: cycleShip(afloat, null) })
    }

    // 10. fades (Tab switch, abandon ship, overboard) — wall-clock like the director's beats, so a slow frame cannot
    // leave the overboard fade behind the camera hand-back; they run while the director has the camera too
    const fd = fade.current
    if (fd) {
      fd.t += delta
      if (fd.phase === 'out') {
        runtime.setFade(Math.max(0, Math.min(1, fd.t / fd.seconds)))
        if (fd.t >= fd.seconds) {
          const then = fd.then
          // while the director still has the camera (overboard beat) stay black until it hands it back (BUG-726)
          fade.current = deckCameraLease.owner === 'director' ? { phase: 'hold', t: 0, seconds: HOLD_MAX } : { phase: 'in', t: 0, seconds: FADE_IN }
          then?.()
        }
      } else if (fd.phase === 'hold') {
        runtime.setFade(1)
        if (fd.t >= fd.seconds || deckCameraLease.owner !== 'director') fade.current = { phase: 'in', t: 0, seconds: FADE_IN }
      } else {
        runtime.setFade(Math.max(0, 1 - fd.t / fd.seconds))
        if (fd.t >= fd.seconds) fade.current = null
      }
    }
  })

  if (!active || !geometry) return null
  return (
    <group ref={shipGroup} matrixAutoUpdate={false}>
      <GunMarkers stations={geometry.stations} near={nearIndex} manned={mannedIndex} eye={eye} />
    </group>
  )
}

/**
 * Cannon + side of the gun a deck chart shot fires from (the manned gun, else the usable gun beside you — the same
 * `deckGunIndex` pick the cinematic uses), for the fleet's `firing` recoil before the shot. Null when no gun bears.
 */
export function mannedCannon(): { uid: string; cell: number; side: 'port' | 'starboard' } | null {
  const g = useGameStore.getState()
  if (!g.deck.on || !g.deck.shipUid) return null
  const ship = g[ownBoardKey(g.perspective)].ships.find((x) => x.uid === g.deck.shipUid)
  if (!ship || isSunk(ship)) return null
  const index = deckGunIndex(ship, g.deck, g.perspective)
  const c = index === null ? undefined : SHIPS[ship.spec.id].anchors.cannons[index]
  return c ? { uid: ship.uid, cell: c.cell, side: c.side } : null
}

export const SWING_DELAY_MS = SWING_MS
