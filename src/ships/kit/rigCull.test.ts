import { describe, expect, it } from 'vitest'
import { SHIPS, standingShipLod } from '..'
import { RIG_CULL_RADIUS, rigCulled, spanCulled } from './rigCull'
import { resolveDeckAnchors } from '../../deck/math'

describe('standing-rigging cull while manning (BUG-800)', () => {
  it('culls only masts within RIG_CULL_RADIUS of the manned cannon; nothing while walking', () => {
    expect(rigCulled(0.05, -0.55)).toBe(true)
    expect(rigCulled(1.4, -0.55)).toBe(false)
    expect(rigCulled(-1.3, -0.55)).toBe(true)
    expect(rigCulled(0, null)).toBe(false)
    expect(rigCulled(0, undefined)).toBe(false)
  })

  it("the man-o'-war waist cannon 10 (owner's station) culls the main + mizzen rigging (their shroud fans cross the cone) and keeps the foremast", () => {
    const a = SHIPS['man-o-war'].anchors
    const x = a.cannons[10].muzzle[0]
    const culled = a.masts.map((m) => rigCulled(m.base[0], x))
    expect(culled).toEqual([false, true, true])
  })

  it('every class: each cannon culls only masts within RIG_CULL_RADIUS of it', () => {
    for (const id of Object.keys(SHIPS) as (keyof typeof SHIPS)[]) {
      const a = SHIPS[id].anchors
      for (const c of a.cannons) {
        const culled = a.masts.filter((m) => rigCulled(m.base[0], c.muzzle[0]))
        for (const m of culled) expect(Math.abs(m.base[0] - c.muzzle[0]), `${id} cannon ${c.cell}`).toBeLessThan(RIG_CULL_RADIUS)
      }
    }
  })
})

describe('standing ship lod while manning', () => {
  it('the dressed ship goes live (lod 0) only while a cannon is manned; other ships keep the tier lod', () => {
    expect(standingShipLod(1, true, true)).toBe(0)
    expect(standingShipLod(2, true, true)).toBe(0)
    expect(standingShipLod(1, true, false)).toBe(1)
    expect(standingShipLod(1, false, true)).toBe(1)
    expect(standingShipLod('auto', false, false)).toBe(2)
  })
})

describe('first look after V / Tab / respawn (BUG-802) and the brigantine netting (BUG-803)', () => {
  it('every class: masts whose shroud fan can cross the spawn view cone (within RIG_CULL_RADIUS of the spawn x) are culled', () => {
    for (const id of Object.keys(SHIPS) as (keyof typeof SHIPS)[]) {
      const a = SHIPS[id].anchors
      const spawnX = resolveDeckAnchors(a, id).spawn[0]
      for (const m of a.masts) expect(rigCulled(m.base[0], spawnX), `${id} mast at ${m.base[0]}`).toBe(Math.abs(m.base[0] - spawnX) < RIG_CULL_RADIUS)
    }
  })

  it('brigantine: the netting panel beside the manned cannon is hidden, the other panel stays', () => {
    const a = SHIPS.brigantine.anchors
    for (const c of a.cannons) {
      const aft = spanCulled(-1.0, -0.65, c.muzzle[0])
      const fore = spanCulled(0.0, 0.5, c.muzzle[0])
      expect(aft === (c.muzzle[0] > -1.3 && c.muzzle[0] < -0.35), `cannon ${c.cell} aft panel`).toBe(true)
      expect(fore === (c.muzzle[0] > -0.3 && c.muzzle[0] < 0.8), `cannon ${c.cell} fore panel`).toBe(true)
    }
    expect(spanCulled(0, 0.5, null)).toBe(false)
  })
})
