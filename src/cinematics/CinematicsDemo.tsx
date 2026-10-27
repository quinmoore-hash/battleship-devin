import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { FLEET, isSunk, randomPlacement, type Coord, type PlacedShip, type Player, type ShotResult } from '../engine'
import { OceanScene } from '../scene'
import { BOARD_LAYOUT } from '../scene/layout'
import { Fleet } from '../ships'
import { useGameStore, type CinematicsLevel } from '../store/gameStore'
import { GridBuoys } from '../vfx/markers/GridBuoys'
import { ShotMarkers } from '../vfx/markers/ShotMarkers'
import { seededRandom } from '../vfx/random'
import { CinematicCamera } from './CinematicCamera'
import { CinematicLayer } from './CinematicLayer'
import { Letterbox } from './Letterbox'
import { director } from './director'
import type { CinematicEvent } from './types'

interface Side {
  ships: PlacedShip[]
  shots: ShotResult[]
}

const applyShot = (side: Side, r: ShotResult): Side => ({
  shots: [...side.shots, r],
  ships: r.outcome === 'miss' ? side.ships : side.ships.map((s) => (s.uid === (r.shipUid ?? r.shipId) ? { ...s, hits: [...s.hits, r.coord] } : s)),
})

const panel: React.CSSProperties = {
  position: 'fixed',
  top: 12,
  left: 12,
  zIndex: 10,
  display: 'grid',
  gap: 6,
  padding: 12,
  background: 'rgba(12, 10, 8, 0.78)',
  color: '#f3e9d2',
  borderRadius: 8,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  minWidth: 220,
}
const btn: React.CSSProperties = { padding: '6px 10px', cursor: 'pointer', background: '#3b2a1a', color: '#f3e9d2', border: '1px solid #7a5a3a', borderRadius: 4 }

/**
 * `?cinematics-demo` — both fleets placed, buttons that fire a hit / miss / sink / enemy shot / victory through
 * the director, level selector and skip. Hidden Navy ships only show up where they are hit (burning wreckage)
 * and in full once sunk, exactly like the game. Damage and markers are applied when the ball lands.
 */
export function CinematicsDemo() {
  const [human, setHuman] = useState<Side>(() => ({ ships: randomPlacement(seededRandom(11), FLEET).ships, shots: [] }))
  const [enemy, setEnemy] = useState<Side>(() => ({ ships: randomPlacement(seededRandom(23), FLEET).ships, shots: [] }))
  const [level, setLevel] = useState<CinematicsLevel>('full')
  const [weather, setWeather] = useState<'calm' | 'stormy'>('calm')
  const [log, setLog] = useState<string[]>([])
  const busy = useStore(director.store, (s) => s.busy)
  const firing = useStore(director.store, (s) => s.firing)
  const sinkProgress = useStore(director.store, (s) => s.sinkProgress)
  const completed = useStore(director.store, (s) => s.completed)
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const updateSettings = useGameStore((s) => s.updateSettings)
  const rng = useRef(seededRandom(99))
  const fleets = useRef({ human: human.ships, enemy: enemy.ships })
  useEffect(() => {
    fleets.current = { human: human.ships, enemy: enemy.ships }
  }, [human.ships, enemy.ships])

  useEffect(() => {
    // the shared director reads the game store's boards by default; point it at the demo's fleets
    director.setFleets(() => fleets.current)
    return () => director.setFleets(null)
  }, [])

  const say = useCallback((s: string) => setLog((l) => [s, ...l].slice(0, 6)), [])

  const playShot = useCallback(
    (by: Player, result: ShotResult) => {
      const apply = () => (by === 'human' ? setEnemy((e) => applyShot(e, result)) : setHuman((h) => applyShot(h, result)))
      let applied = false
      const unsub = director.store.subscribe((s) => {
        if (s.impacted && !applied) {
          applied = true
          apply()
          unsub()
        }
      })
      const ev: CinematicEvent = { type: 'shot', by, target: result.coord, result }
      return director.play(ev, level).then(() => {
        unsub()
        if (!applied) {
          applied = true
          apply()
        }
      })
    },
    [level],
  )

  const pickTarget = (side: Side, outcome: 'hit' | 'miss' | 'sunk'): ShotResult | null => {
    const taken = new Set(side.shots.map((s) => `${s.coord.x},${s.coord.y}`))
    if (outcome === 'miss') {
      const occupied = new Set(side.ships.flatMap((s) => s.cells.map((c) => `${c.x},${c.y}`)))
      for (let i = 0; i < 200; i++) {
        const c: Coord = { x: Math.floor(rng.current() * 10), y: Math.floor(rng.current() * 10) }
        const k = `${c.x},${c.y}`
        if (!taken.has(k) && !occupied.has(k)) return { coord: c, outcome: 'miss' }
      }
      return null
    }
    const afloat = side.ships.filter((s) => !isSunk(s))
    if (!afloat.length) return null
    const remaining = (s: PlacedShip) => s.cells.filter((c) => !s.hits.some((h) => h.x === c.x && h.y === c.y))
    if (outcome === 'hit') {
      const ship = afloat.filter((s) => remaining(s).length > 1).sort((a, b) => remaining(b).length - remaining(a).length)[0]
      if (!ship) return null
      const cell = remaining(ship)[Math.floor(rng.current() * remaining(ship).length)]
      return { coord: cell, outcome: 'hit', shipId: ship.spec.id, shipUid: ship.uid }
    }
    const ship = afloat.sort((a, b) => remaining(a).length - remaining(b).length)[0]
    const left = remaining(ship)
    return { coord: left[left.length - 1], outcome: 'sunk', shipId: ship.spec.id, shipUid: ship.uid }
  }

  const fire = async (by: Player, outcome: 'hit' | 'miss' | 'sunk') => {
    const side = by === 'human' ? enemy : human
    let result = pickTarget(side, outcome)
    if (!result) return say('nothing left to shoot at')
    if (outcome === 'sunk') {
      // pre-damage every other cell of the doomed ship so the last ball sinks it
      const ship = side.ships.find((s) => s.uid === (result!.shipUid ?? result!.shipId))!
      const pre = ship.cells.filter((c) => !(c.x === result!.coord.x && c.y === result!.coord.y) && !ship.hits.some((h) => h.x === c.x && h.y === c.y))
      const preShots: ShotResult[] = pre.map((coord) => ({ coord, outcome: 'hit', shipId: ship.spec.id, shipUid: ship.uid }))
      const patch = (s: Side) => preShots.reduce(applyShot, s)
      if (by === 'human') setEnemy(patch)
      else setHuman(patch)
      fleets.current = by === 'human' ? { ...fleets.current, enemy: patch(enemy).ships } : { ...fleets.current, human: patch(human).ships }
      result = { ...result }
    }
    say(`${by} fires at ${String.fromCharCode(65 + result.coord.x)}${result.coord.y + 1}: ${result.outcome}`)
    await playShot(by, result)
    if (outcome === 'sunk' && result.shipId) {
      say(`${result.shipId} goes down`)
      await director.play({ type: 'sink', owner: by === 'human' ? 'enemy' : 'human', shipId: result.shipId }, level)
    }
  }

  const victory = async (winner: Player) => {
    setWeather(winner === 'human' ? 'calm' : 'stormy')
    say(winner === 'human' ? 'Victory!' : 'Defeat…')
    await director.play({ type: 'victory', winner }, level)
  }

  return (
    <>
      <OceanScene view="battle" interactive={!busy} cameraOverride={busy} weather={weather}>
        <GridBuoys origin={BOARD_LAYOUT.player.origin} />
        <GridBuoys origin={BOARD_LAYOUT.enemy.origin} color="#2b3a55" />
        <Fleet ships={human.ships} livery="pirate" boardOrigin={BOARD_LAYOUT.player.origin} firing={firing} sinkProgress={sinkProgress} />
        <Fleet ships={enemy.ships} livery="navy" revealed={false} boardOrigin={BOARD_LAYOUT.enemy.origin} firing={firing} sinkProgress={sinkProgress} />
        <ShotMarkers shots={enemy.shots} boardOrigin={BOARD_LAYOUT.enemy.origin} />
        <ShotMarkers shots={human.shots} boardOrigin={BOARD_LAYOUT.player.origin} />
        <CinematicLayer />
        <CinematicCamera />
      </OceanScene>
      <Letterbox />
      <div style={panel} data-testid="cinematics-panel" data-no-skip>
        <strong>Cinematics demo</strong>
        <label>
          Level{' '}
          <select value={level} onChange={(e) => setLevel(e.target.value as CinematicsLevel)} data-testid="level">
            <option value="full">full</option>
            <option value="fast">fast</option>
            <option value="off">off</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={reducedMotion} onChange={(e) => updateSettings({ reducedMotion: e.target.checked })} /> reduced motion
        </label>
        <button style={btn} onClick={() => fire('human', 'hit')} data-testid="fire-hit">
          Fire: hit
        </button>
        <button style={btn} onClick={() => fire('human', 'miss')} data-testid="fire-miss">
          Fire: miss
        </button>
        <button style={btn} onClick={() => fire('human', 'sunk')} data-testid="fire-sink">
          Fire: sink
        </button>
        <button style={btn} onClick={() => fire('enemy', human.shots.length % 2 ? 'miss' : 'hit')} data-testid="enemy-shot">
          Enemy shot
        </button>
        <button style={btn} onClick={() => director.play({ type: 'battle-start' }, level)} data-testid="battle-start">
          Battle start
        </button>
        <button style={btn} onClick={() => victory('human')} data-testid="victory">
          Victory
        </button>
        <button style={btn} onClick={() => victory('enemy')} data-testid="defeat">
          Defeat
        </button>
        <button style={{ ...btn, background: '#5a1f1f' }} onClick={() => director.skip()} disabled={!busy} data-testid="skip">
          Skip
        </button>
        <div data-testid="status" style={{ opacity: 0.8 }}>
          {busy ? 'playing…' : 'idle'} · {completed} done
        </div>
        <div style={{ opacity: 0.7, fontSize: 12, lineHeight: 1.4 }}>
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>
    </>
  )
}
