import { afterEach, describe, expect, it } from 'vitest'
import { setPlayerDeck } from '../crew/playerPose'
import { deckGun, resolveDeckAnchors, stationsOf, stationUsable } from '../deck/math'
import { FLEET, type PlacedShip, type ShotResult } from '../engine'
import { BOARD_LAYOUT, boardCenter } from '../scene/layout'
import { SHIPS, shipWorldTransform } from '../ships'
import { directionToWorld, localToWorld } from '../vfx/cannon/anchors'
import { ownBoardOrigin, planShot } from './battery'
import { deckGunIndex, povFor, stationBattery, stationMuzzle } from './pov'

const place = (id: PlacedShip['spec']['id'], x: number, y: number, orientation: 'horizontal' | 'vertical'): PlacedShip => {
  const s = FLEET.find((f) => f.id === id)!
  const cells = Array.from({ length: s.length }, (_, i) => (orientation === 'horizontal' ? { x: x + i, y } : { x, y: y + i }))
  return { spec: s, uid: s.id, origin: { x, y }, orientation, cells, hits: [] }
}
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const result: ShotResult = { coord: { x: 4, y: 5 }, outcome: 'miss' }
const foe = boardCenter(BOARD_LAYOUT.enemy)

/** What `director.play` does for an outgoing deck shot: the station battery, then the single station muzzle. */
const outgoing = (ship: PlacedShip, station: number | null) => {
  const pov = povFor({ type: 'shot', by: 'human', target: result.coord, result }, { on: true, shipUid: ship.uid, station }, { human: [ship], enemy: [] }, 'human')
  const battery = stationBattery(pov)!
  const plan = planShot('human', result, [ship], [], battery)
  const m = stationMuzzle(pov, plan.shooter)!
  plan.muzzles = [m]
  return { battery, plan }
}

afterEach(() => setPlayerDeck(null))

describe('deck shot origin', () => {
  for (const spec of FLEET) {
    const anchors = SHIPS[spec.id].anchors
    const stations = stationsOf(anchors, resolveDeckAnchors(anchors, spec.id))
    for (const orientation of ['horizontal', 'vertical'] as const) {
      const ship = place(spec.id, 1, 3, orientation)
      const pose = shipWorldTransform(ship, ownBoardOrigin('human'))
      it(`${spec.id} (${orientation}): every manned station fires one ball from its own world muzzle`, () => {
        expect(stations.length).toBe(anchors.cannons.length)
        for (const s of stations) {
          const { battery, plan } = outgoing(ship, s.index)
          const c = anchors.cannons[s.index]
          expect(battery).toMatchObject({ uid: ship.uid, side: c.side, cells: [c.cell] })
          expect(plan.muzzles).toHaveLength(1)
          expect(dist(plan.muzzles[0].position, localToWorld(c.muzzle, pose))).toBeLessThan(0.03)
          expect(dist(plan.muzzles[0].direction, directionToWorld(c.direction, pose.rotationY))).toBeLessThan(1e-6)
          expect(plan.shooter?.position).toEqual(pose.position)
        }
      })
      it(`${spec.id} (${orientation}): walking fires the usable gun nearest the feet, never from thin air`, () => {
        const usable = stations.filter((s) => stationUsable(s, pose.rotationY, pose.position, foe))
        expect(usable.length).toBeGreaterThan(0)
        for (const near of usable) {
          setPlayerDeck(ship.uid, near.stand[0], near.stand[2])
          expect(deckGunIndex(ship, { on: true, shipUid: ship.uid, station: null }, 'human')).toBe(near.index)
          const { plan } = outgoing(ship, null)
          expect(dist(plan.muzzles[0].position, localToWorld(anchors.cannons[near.index].muzzle, pose))).toBeLessThan(0.03)
        }
        setPlayerDeck(null)
        const any = deckGun(stations, null, pose.rotationY, pose.position, foe)!
        expect(usable.map((s) => s.index)).toContain(any.index)
        expect(deckGunIndex(ship, { on: true, shipUid: ship.uid, station: null }, 'human')).toBe(any.index)
      })
    }
  }
  it('the other captain / the enemy keep the overview battery', () => {
    const ship = place('frigate', 1, 3, 'horizontal')
    const deck = { on: true, shipUid: ship.uid, station: 0 }
    expect(stationBattery(povFor({ type: 'shot', by: 'enemy', target: result.coord, result }, deck, { human: [ship], enemy: [] }, 'human'))).toBeNull()
    expect(stationBattery(povFor({ type: 'shot', by: 'human', target: result.coord, result }, { ...deck, on: false }, { human: [ship], enemy: [] }, 'human'))).toBeNull()
  })
})
