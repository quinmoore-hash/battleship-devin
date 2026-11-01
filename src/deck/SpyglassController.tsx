/**
 * Raises the first-person Spyglass while on deck (Black Flag, glass unused): a 0.4 s blend from whatever the deck camera
 * is doing (third person / manned gun) to an eye pose at the rail facing the enemy waters, FOV 70 → 22, mouse pans,
 * slight hand sway (none under reduced motion). Mounted inside <OceanScene> AFTER <DeckController>, so its useFrame runs
 * later in the same priority-0 pass and overrides the camera only while the glass is up — the controller's camera maths
 * is untouched and takes over again as soon as the blend reaches 0 (it re-asserts DECK_FOV itself).
 * A click while the glass is up goes to the SAME `useBattleController().aim(coord)` as the chart.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { playSfx, playSfxAt } from '../audio'
import { isSunk, shipAt } from '../engine'
import { BOARD_LAYOUT, boardCenter, cellToWorld } from '../scene/layout'
import { sampleWaveHeight } from '../scene/waves'
import { SHIPS, shipWorldTransform } from '../ships'
import { ownBoardKey, targetBoardKey, useGameStore } from '../store/gameStore'
import { useBattleController } from '../ui/battleController'
import { useUiStore } from '../ui/uiStore'
import { crewVoice, useDeckAudioStore } from './audio'
import { DECK_FOV } from './contract'
import { useDeckStore } from './deckStore'
import { resolveDeckAnchors } from './math'
import { SPYGLASS_BLEND_S, SPYGLASS_FOV, SPYGLASS_LOOK_PER_PIXEL, cellUnderGlass, clampPitch, handSway, pointerPan, spyglassEye, useSpyglassStore } from './Spyglass'

const tmp = { v: new THREE.Vector3(), q: new THREE.Quaternion(), e: new THREE.Euler(0, 0, 0, 'YXZ') }
const smooth = (x: number) => x * x * (3 - 2 * x)

export function SpyglassController() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const deckActive = useDeckStore((s) => s.active)
  const armed = useUiStore((s) => s.armed)
  const blackFlag = useGameStore((s) => s.modes.blackFlag)
  const unused = useGameStore((s) => s.powerShots[s.perspective].spyglass)
  const wantUp = deckActive && blackFlag && armed === 'spyglass' && unused

  const blend = useRef(0)
  const pan = useRef({ yaw: 0, pitch: 0 })
  const hovering = useRef(false)

  // raise / lower + sounds
  useEffect(() => {
    const st = useSpyglassStore.getState()
    if (st.up === wantUp) return
    st.setUp(wantUp)
    const log = useDeckAudioStore.getState().log
    if (wantUp) {
      pan.current = { yaw: 0, pitch: 0 }
      log('spyglass-raise')
      playSfx('spyglass-raise', { noDuck: true })
    } else {
      st.setCell(null)
      log('spyglass-lower')
      playSfx('spyglass-lower', { noDuck: true })
    }
  }, [wantUp])

  // the reveal: a new spy mark for the active side while the glass is up → 3D flash + "Land ho!"
  useEffect(() => {
    if (!wantUp) return
    return useGameStore.subscribe((s, prev) => {
      const marks = s.spied[s.perspective]
      if (marks === prev.spied[prev.perspective] || marks.length === 0) return
      const mark = marks[marks.length - 1]
      const seen = mark.ship ? 'ship' : 'water'
      useSpyglassStore.getState().setReveal({ coord: mark.coord, seen, at: performance.now() })
      const foe = s[targetBoardKey(s.perspective)]
      const where = cellToWorld(mark.coord, BOARD_LAYOUT[s.perspective === 'human' ? 'enemy' : 'player'].origin)
      const log = useDeckAudioStore.getState().log
      log('spyglass-reveal', `${seen} ${mark.coord.x},${mark.coord.y}`)
      if (seen === 'ship' && shipAt(foe, mark.coord) && crewVoice.request('land-ho', performance.now())) {
        log('land-ho', 'ship sighted')
        playSfxAt('land-ho', where, { noDuck: true })
      }
    })
  }, [wantUp])

  // input: pan + click → aim(cell) (capture phase, so the DeckController's own canvas handler never sees the click)
  useEffect(() => {
    if (!wantUp) return
    const canvas = gl.domElement
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement === canvas) {
        const invert = useGameStore.getState().settings.deckInvertY ? -1 : 1
        pan.current.yaw -= e.movementX * SPYGLASS_LOOK_PER_PIXEL
        pan.current.pitch = clampPitch(pan.current.pitch - e.movementY * SPYGLASS_LOOK_PER_PIXEL * invert)
      } else {
        const p = pointerPan(e.clientX / window.innerWidth - 0.5, e.clientY / window.innerHeight - 0.5)
        pan.current.yaw = p.yaw
        pan.current.pitch = p.pitch
      }
    }
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      e.stopImmediatePropagation()
      e.preventDefault()
      const cell = useSpyglassStore.getState().cell
      if (!cell) return playSfx('miss')
      useBattleController.getState().aim(cell, e.pointerType)
    }
    window.addEventListener('mousemove', onMove)
    canvas.addEventListener('pointerdown', onDown, { capture: true })
    return () => {
      window.removeEventListener('mousemove', onMove)
      canvas.removeEventListener('pointerdown', onDown, { capture: true })
    }
  }, [wantUp, gl])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.25)
    const target = wantUp ? 1 : 0
    if (blend.current === target && target === 0) return
    blend.current = target > blend.current ? Math.min(1, blend.current + dt / SPYGLASS_BLEND_S) : Math.max(0, blend.current - dt / SPYGLASS_BLEND_S)
    const s = smooth(blend.current)
    const store = useSpyglassStore.getState()
    const g = useGameStore.getState()
    const ship = g[ownBoardKey(g.perspective)].ships.find((x) => x.uid === g.deck.shipUid)
    if (s <= 0 || !ship || isSunk(ship)) {
      if (hovering.current) {
        hovering.current = false
        const h = useUiStore.getState().hover
        if (h?.side === 'enemy') useUiStore.getState().setHover(null)
      }
      store.setCell(null)
      if (!ship || isSunk(ship)) {
        blend.current = 0
        if (store.up) useUiStore.getState().setArmed('shot')
      }
      return
    }
    const ownKey = g.perspective === 'human' ? 'player' : 'enemy'
    const foeBoard = BOARD_LAYOUT[g.perspective === 'human' ? 'enemy' : 'player']
    const transform = shipWorldTransform(ship, BOARD_LAYOUT[ownKey].origin)
    const hullY = transform.position[1] + sampleWaveHeight(transform.position[0], transform.position[2], state.clock.elapsedTime)
    const pose = spyglassEye(resolveDeckAnchors(SHIPS[ship.spec.id].anchors), transform, hullY, boardCenter(foeBoard))
    const sway = handSway(state.clock.elapsedTime, g.settings.reducedMotion)
    const yaw = pose.yaw + pan.current.yaw + sway.yaw
    const pitch = clampPitch(pose.pitch + pan.current.pitch + sway.pitch)

    // the DeckController has already written this frame's deck pose: blend from it toward the glass
    tmp.v.set(pose.eye[0], pose.eye[1], pose.eye[2])
    camera.position.lerp(tmp.v, s)
    tmp.q.setFromEuler(tmp.e.set(pitch, yaw, 0, 'YXZ'))
    camera.quaternion.slerp(tmp.q, s)
    const fov = DECK_FOV + (SPYGLASS_FOV - DECK_FOV) * s
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }

    // cell under the crosshair (only once the glass is up)
    const cell = blend.current >= 1 && wantUp ? cellUnderGlass(pose.eye, yaw, pitch, foeBoard) : null
    store.setCell(cell)
    const ui = useUiStore.getState()
    const h = ui.hover
    if (cell) {
      hovering.current = true
      if (h?.side !== 'enemy' || h.coord.x !== cell.x || h.coord.y !== cell.y) ui.setHover({ side: 'enemy', coord: cell })
    } else if (hovering.current) {
      hovering.current = false
      if (h?.side === 'enemy') ui.setHover(null)
    }
  })
  return null
}
