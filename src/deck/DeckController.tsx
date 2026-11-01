/**
 * "On deck" first-person controller. Mounted inside `<OceanScene>` during the battle; while `deck.on` it owns the
 * camera (the rig's `'deck'` view stands down, `<CinematicCamera>` is not mounted): the player stands on one of their
 * own afloat ships, parented to the ship's wave motion, walks with WASD / arrows, looks with the pointer lock, mans a
 * cannon with E and fires by clicking a square (the crosshair over the enemy waters, or the 2-D chart). Deck mode is
 * only a seat: every shot goes through `useBattleController().aim` exactly like the overview.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { director } from '../cinematics'
import { isSunk } from '../engine'
import { BOARD_LAYOUT, boardCenter, type Vec3 } from '../scene/layout'
import { sampleWaveHeight } from '../scene/waves'
import { SHIPS, damageOf, shipWorldTransform } from '../ships'
import { ownBoardKey, useGameStore } from '../store/gameStore'
import { useBattleController } from '../ui/battleController'
import { useUiStore } from '../ui/uiStore'
import { lastHitIndex, placedShipSeed, sinkPose } from '../vfx/sinking'
import { DECK_FOV, DECK_NEAR, deckBus, type DeckBusEvent } from './contract'
import { resetDeckRuntime, useDeckStore } from './deckStore'
import {
  KEY_LOOK_SPEED,
  LOOK_PER_PIXEL,
  PITCH_LIMIT,
  RUN_SPEED,
  WALK_SPEED,
  afloatUids,
  angleDelta,
  clamp,
  cycleShip,
  eyeFor,
  isFallbackDeck,
  gunnerPose,
  lookForward,
  nearestStation,
  rayToCell,
  resolveDeckAnchors,
  sinkProgressFor,
  spawnPose,
  stationUsable,
  stationsOf,
  stepOnDeck,
  type Station,
  type WalkPose,
} from './math'

const DEFAULT_NEAR = 0.5
/** Seconds of the Tab fade-out and of the abandon-ship fade-out. */
const SWITCH_FADE = 0.3
const ABANDON_FADE = 1.2
const FADE_IN = 0.45
/** Screen radius (px) within which a click / tap on a gun mans it. */
const TAP_RADIUS = 44
/** Swing the manned gun this long before the shot resolves (the fleet's `firing` recoil). */
const SWING_MS = 220

const tmp = {
  v: new THREE.Vector3(),
  w: new THREE.Vector3(),
  q: new THREE.Quaternion(),
  q2: new THREE.Quaternion(),
  e: new THREE.Euler(),
  m: new THREE.Matrix4(),
  s: new THREE.Vector3(1, 1, 1),
}

interface Look {
  yaw: number
  pitch: number
}

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

  const ownOrigin = BOARD_LAYOUT[perspective === 'human' ? 'player' : 'enemy'].origin
  const foeBoard = BOARD_LAYOUT[perspective === 'human' ? 'enemy' : 'player']
  const foeCenter = useMemo(() => boardCenter(foeBoard), [foeBoard])

  const geometry = useMemo(() => {
    if (!ship) return null
    const anchors = SHIPS[ship.spec.id].anchors
    const deckA = resolveDeckAnchors(anchors)
    const transform = shipWorldTransform(ship, ownOrigin)
    const stations = stationsOf(anchors, deckA).map((s) => ({ ...s, usable: stationUsable(s, transform.rotationY, transform.position, foeCenter) }))
    return { anchors, deckA, transform, stations, hull: anchors.hull, seed: placedShipSeed(ship) }
  }, [ship, ownOrigin, foeCenter])

  // --- mutable per-frame state -------------------------------------------------------------------------------
  const pose = useRef<WalkPose>({ x: 0, z: 0, y: 0, level: 0 })
  const look = useRef<Look>({ yaw: 0, pitch: 0 })
  const camLocal = useRef(new THREE.Vector3())
  const keys = useRef(new Set<string>())
  const shake = useRef(0)
  const shakeT = useRef(0)
  const lookAt = useRef<{ point: Vec3; seconds: number; t: number } | null>(null)
  const fade = useRef<Fade>(null)
  const abandoning = useRef(false)
  const standUid = useRef<string | null>(null)
  const swing = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touch = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)
  const lockRefused = useRef(false)

  const activeRef = useRef(active)
  activeRef.current = active
  const geomRef = useRef(geometry)
  geomRef.current = geometry
  const shipRef = useRef(ship)
  shipRef.current = ship

  // --- boarding: spawn (or re-spawn on a new ship) -----------------------------------------------------------
  useEffect(() => {
    if (!active || !geometry || !ship) return
    if (standUid.current === ship.uid) return
    standUid.current = ship.uid
    let p = spawnPose(geometry.deckA)
    // face the enemy waters; on the fallback rectangle also stand at the rail on that side (no mast / cabin in the way)
    const { rotationY, position } = geometry.transform
    const worldYaw = Math.atan2(-(foeCenter[0] - position[0]), -(foeCenter[2] - position[2]))
    let localYaw = worldYaw - rotationY
    if (isFallbackDeck(geometry.deckA)) {
      // stand at the rail nearer the enemy and look out over it (a bow-on ship would otherwise stare at its own masts / cabin)
      const f = lookForward(localYaw, 0)
      const side = f[2] >= 0 ? 1 : -1
      p = stepOnDeck(p, 0, side * geometry.hull.beam, geometry.deckA)
      if (Math.abs(f[2]) <= 0.5) localYaw = side > 0 ? Math.PI : 0
    }
    pose.current = p
    look.current = { yaw: localYaw, pitch: -0.05 }
    camLocal.current.set(p.x, p.y + eyeFor(geometry.deckA), p.z)
  }, [active, geometry, ship, foeCenter])

  // --- camera lens + runtime flags while active ----------------------------------------------------------------
  useEffect(() => {
    if (!active) return
    camera.near = DECK_NEAR
    camera.fov = DECK_FOV
    camera.updateProjectionMatrix()
    useDeckStore.getState().setActive(true)
    return () => {
      camera.near = DEFAULT_NEAR
      camera.updateProjectionMatrix()
      if (document.pointerLockElement === gl.domElement) document.exitPointerLock?.()
      standUid.current = null
      fade.current = null
      abandoning.current = false
      resetDeckRuntime()
      useUiStore.getState().setHover(null)
    }
  }, [active, camera, gl])

  // --- deckBus (session B emits; our own fallbacks also go through here) ------------------------------------
  useEffect(() => {
    const startFade = (seconds: number, then: () => void) => {
      fade.current = { phase: 'out', t: 0, seconds, then }
    }
    const handler = (e: DeckBusEvent) => {
      if (!activeRef.current) return
      if (e.type === 'shake') {
        if (!useGameStore.getState().settings.reducedMotion) shake.current = Math.min(1, shake.current + e.intensity * 0.06)
      } else if (e.type === 'look-at') {
        lookAt.current = { point: e.point, seconds: Math.max(0.05, e.seconds), t: 0 }
      } else if (e.type === 'abandon-ship') {
        if (abandoning.current) return
        abandoning.current = true
        const next = e.nextUid
        startFade(ABANDON_FADE, () => {
          const g = useGameStore.getState()
          if (next && g.deck.shipUid !== next) g.boardShip(next)
          else if (!next) g.setDeck(false)
          abandoning.current = false
        })
      }
    }
    return deckBus.on(handler)
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

    const toggleStation = () => {
      const g = game()
      if (g.deck.station !== null) return g.manStation(null)
      const geom = geomRef.current
      if (!geom) return
      const near = nearestStation(geom.stations, pose.current.x, pose.current.z)
      if (!near) return runtime().showNudge('Walk up to a gun on the enemy side and press E')
      const st = geom.stations[near.index]
      if (!st.usable) return runtime().showNudge('No target that side')
      man(st)
    }

    const man = (st: UsableStation) => {
      const g = game()
      pose.current = { ...pose.current, x: st.stand[0], z: st.stand[2] }
      const gp = gunnerPose(st)
      look.current = { yaw: gp.yaw, pitch: gp.pitch }
      g.manStation(st.index)
    }

    const fireAtCrosshair = () => {
      const g = game()
      if (g.deck.station === null) return runtime().showNudge('Man a gun to fire')
      const cell = runtime().aim
      if (!cell) return runtime().showNudge('Aim at the enemy waters, or click the chart')
      useBattleController.getState().aim(cell)
    }

    /** The gun whose stand projects within TAP_RADIUS px of the pointer, if any. */
    const stationAtPixel = (clientX: number, clientY: number): UsableStation | null => {
      const geom = geomRef.current
      if (!geom) return null
      const rect = canvas.getBoundingClientRect()
      let best: UsableStation | null = null
      let bestD = TAP_RADIUS
      for (const st of geom.stations) {
        if (!st.onDeck) continue
        tmp.v.set(st.stand[0], st.stand[1] + 0.08, st.stand[2]).applyMatrix4(tmp.m)
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
      const k = e.key.toLowerCase()
      if (k === 'tab' && focusIsFree()) {
        e.preventDefault()
        nextShip()
        return
      }
      if (k === 'e') return toggleStation()
      if (k === 'enter' && focusIsFree()) {
        e.preventDefault()
        return fireAtCrosshair()
      }
      if (['w', 'a', 's', 'd', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        if (k.startsWith('arrow') && !focusIsFree()) return
        if (k.startsWith('arrow')) e.preventDefault()
        keys.current.add(k)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase())
    const onBlur = () => keys.current.clear()

    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return
      const g = game()
      const k = LOOK_PER_PIXEL * g.settings.deckSensitivity
      look.current.yaw -= e.movementX * k
      look.current.pitch = clamp(look.current.pitch - e.movementY * k * (g.settings.deckInvertY ? -1 : 1), -PITCH_LIMIT, PITCH_LIMIT)
    }

    const onLockChange = () => {
      const locked = document.pointerLockElement === canvas
      runtime().setLocked(locked)
      if (locked) {
        lockRefused.current = false
        runtime().setKeyboardLook(false)
      }
    }
    const onLockError = () => {
      lockRefused.current = true
      runtime().setKeyboardLook(true)
    }

    const requestLock = () => {
      if (lockRefused.current || !canvas.requestPointerLock) return runtime().setKeyboardLook(true)
      try {
        const r = canvas.requestPointerLock() as unknown
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(onLockError)
      } catch {
        onLockError()
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (e.pointerType === 'touch') {
        touch.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false }
        return
      }
      if (document.pointerLockElement === canvas) {
        if (game().deck.station !== null) fireAtCrosshair()
        return
      }
      const st = stationAtPixel(e.clientX, e.clientY)
      if (st) {
        if (!st.usable) return runtime().showNudge('No target that side')
        return man(st)
      }
      requestLock()
    }
    const onPointerMove = (e: PointerEvent) => {
      const t = touch.current
      if (!t || e.pointerId !== t.id) return
      const dx = e.clientX - t.x
      const dy = e.clientY - t.y
      if (Math.abs(dx) + Math.abs(dy) > 6) t.moved = true
      const k = 0.004 * game().settings.deckSensitivity
      look.current.yaw -= dx * k
      look.current.pitch = clamp(look.current.pitch - dy * k * (game().settings.deckInvertY ? -1 : 1), -PITCH_LIMIT, PITCH_LIMIT)
      t.x = e.clientX
      t.y = e.clientY
    }
    const onPointerUp = (e: PointerEvent) => {
      const t = touch.current
      if (!t || e.pointerId !== t.id) return
      touch.current = null
      if (t.moved) return
      const st = stationAtPixel(e.clientX, e.clientY)
      if (st) {
        if (!st.usable) return runtime().showNudge('No target that side')
        man(st)
      } else if (game().deck.station === null) runtime().showNudge('Tap a gun to man it, then tap the chart to fire')
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
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('pointerlockchange', onLockChange)
    document.addEventListener('pointerlockerror', onLockError)
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
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('pointerlockchange', onLockChange)
      document.removeEventListener('pointerlockerror', onLockError)
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      keys.current.clear()
      if (swing.current) clearTimeout(swing.current)
    }
  }, [active, gl, camera])

  // --- per frame ------------------------------------------------------------------------------------------------
  useFrame((state, delta) => {
    if (!active || !geometry || !ship) return
    const dt = Math.min(delta, 0.25)
    const t = state.clock.elapsedTime
    const g = useGameStore.getState()
    const runtime = useDeckStore.getState()
    const manning = g.deck.station !== null ? geometry.stations[g.deck.station] : null

    // ship world pose: exactly what <Fleet>'s Afloat group does (wave height + sink pose)
    const { position, rotationY } = geometry.transform
    const sunk = isSunk(ship)
    const sink = sinkProgressFor(sunk, director.store.getState().sinkProgress[ship.uid])
    const sp = sinkPose(sink, { seed: geometry.seed, hull: geometry.hull, damage: damageOf(ship), lastHit: lastHitIndex(ship) })
    const y = position[1] - sp.depth + sampleWaveHeight(position[0], position[2], t)
    tmp.q.setFromEuler(tmp.e.set(0, rotationY + sp.yaw, 0))
    tmp.q.multiply(tmp.q2.setFromEuler(tmp.e.set(sp.roll, 0, sp.pitch)))
    tmp.m.compose(tmp.w.set(position[0], y, position[2]), tmp.q, tmp.s)

    // walking (any walk input steps away from a manned gun)
    const k = keys.current
    const locked = document.pointerLockElement === gl.domElement
    const arrowsWalk = locked || !runtime.keyboardLook
    const fwd = (k.has('w') ? 1 : 0) - (k.has('s') ? 1 : 0) + (arrowsWalk ? (k.has('arrowup') ? 1 : 0) - (k.has('arrowdown') ? 1 : 0) : 0)
    const strafe = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0) + (arrowsWalk ? (k.has('arrowright') ? 1 : 0) - (k.has('arrowleft') ? 1 : 0) : 0)
    if (!arrowsWalk) {
      const r = KEY_LOOK_SPEED * dt
      look.current.yaw += ((k.has('arrowleft') ? 1 : 0) - (k.has('arrowright') ? 1 : 0)) * r
      look.current.pitch = clamp(look.current.pitch + ((k.has('arrowup') ? 1 : 0) - (k.has('arrowdown') ? 1 : 0)) * r, -PITCH_LIMIT, PITCH_LIMIT)
    }
    if ((fwd || strafe) && !fade.current) {
      if (manning) g.manStation(null)
      const speed = k.has('shift') ? RUN_SPEED : WALK_SPEED
      const f = lookForward(look.current.yaw, 0)
      const rx = Math.cos(look.current.yaw)
      const rz = -Math.sin(look.current.yaw)
      const len = Math.hypot(fwd, strafe) || 1
      const dx = ((f[0] * fwd + rx * strafe) / len) * speed * dt
      const dz = ((f[2] * fwd + rz * strafe) / len) * speed * dt
      pose.current = stepOnDeck(pose.current, dx, dz, geometry.deckA)
    }

    // station proximity → HUD prompt
    const near = manning ? null : nearestStation(geometry.stations, pose.current.x, pose.current.z)
    runtime.setNear(near ? { index: near.index, usable: geometry.stations[near.index].usable } : null)

    // look-at nudges (incoming ball, sinking ship)
    const la = lookAt.current
    if (la) {
      la.t += dt
      tmp.v.copy(camera.position)
      const wx = la.point[0] - tmp.v.x
      const wy = la.point[1] - tmp.v.y
      const wz = la.point[2] - tmp.v.z
      const worldYaw = Math.atan2(-wx, -wz)
      const wantYaw = worldYaw - (rotationY + sp.yaw)
      const wantPitch = clamp(Math.atan2(wy, Math.hypot(wx, wz)), -PITCH_LIMIT, PITCH_LIMIT)
      const f = 1 - Math.exp((-4 / la.seconds) * dt)
      look.current.yaw += angleDelta(look.current.yaw, wantYaw) * f
      look.current.pitch += (wantPitch - look.current.pitch) * f
      if (la.t >= la.seconds) lookAt.current = null
    }

    // camera in ship space: eye over the feet, or eased in behind the breech while manning
    const target = manning ? gunnerPose(manning).position : [pose.current.x, pose.current.y + eyeFor(geometry.deckA), pose.current.z]
    const ease = 1 - Math.exp(-10 * dt)
    camLocal.current.x += (target[0] - camLocal.current.x) * ease
    camLocal.current.y += (target[1] - camLocal.current.y) * ease
    camLocal.current.z += (target[2] - camLocal.current.z) * ease

    // shake: the director's impulses (CinematicCamera is not mounted while on deck) + deckBus shakes
    const ds = director.store.getState()
    if (ds.shake > 0) {
      if (!reducedMotion) shake.current = Math.min(1, shake.current + ds.shake * 0.25)
      director.store.setState({ shake: 0 })
    }
    shake.current *= Math.exp(-dt * 5)
    shakeT.current += dt
    const amp = reducedMotion ? 0 : shake.current * 0.08
    const st = shakeT.current
    tmp.v.copy(camLocal.current)
    tmp.v.x += Math.sin(st * 37.1) * amp
    tmp.v.y += Math.sin(st * 51.7 + 1.3) * amp * 0.8
    tmp.v.z += Math.sin(st * 43.3 + 2.1) * amp * 0.6
    tmp.v.applyMatrix4(tmp.m)
    camera.position.copy(tmp.v)

    // orientation = ship pose × look (+ a gentle sway unless reduced motion)
    const swayYaw = reducedMotion ? 0 : Math.sin(t * 0.5) * 0.006
    const swayPitch = reducedMotion ? 0 : Math.sin(t * 0.8 + 1) * 0.004
    camera.quaternion.copy(tmp.q).multiply(tmp.q2.setFromEuler(tmp.e.set(look.current.pitch + swayPitch, look.current.yaw + swayYaw, 0, 'YXZ')))
    if (camera.fov !== DECK_FOV) {
      camera.fov = DECK_FOV
      camera.updateProjectionMatrix()
    }

    // crosshair aim while manning (pointer locked or keyboard look): the enemy cell under the centre of the screen
    if (manning && (locked || runtime.keyboardLook || touch.current)) {
      camera.getWorldDirection(tmp.w)
      const cell = rayToCell([camera.position.x, camera.position.y, camera.position.z], [tmp.w.x, tmp.w.y, tmp.w.z], BOARD_LAYOUT.surfaceY, foeBoard.origin, foeBoard.size, foeBoard.cellSize)
      runtime.setAim(cell)
      const hover = useUiStore.getState().hover
      if ((hover?.coord.x ?? -1) !== (cell?.x ?? -1) || (hover?.coord.y ?? -1) !== (cell?.y ?? -1) || (hover && hover.side !== 'enemy')) useUiStore.getState().setHover(cell ? { side: 'enemy', coord: cell } : null)
    } else if (runtime.aim) runtime.setAim(null)

    // standing ship went down and nobody played an abandon-ship beat: our own, once the director is done with the sink
    if (sunk && !abandoning.current && !fade.current && !ds.busy) {
      const afloat = afloatUids(g[ownBoardKey(g.perspective)].ships)
      deckBus.emit({ type: 'abandon-ship', nextUid: cycleShip(afloat, null) })
    }

    // fades (Tab switch, abandon ship)
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

  return null
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
