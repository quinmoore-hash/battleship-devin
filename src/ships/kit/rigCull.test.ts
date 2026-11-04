import { describe, expect, it } from 'vitest'
import { SHIPS, standingShipLod } from '..'
import { RIG_CULL_RADIUS, rigCulled, spanCulled, WALK_CULL_STEP, walkCullX, partCulled, rigPart, spanPart } from './rigCull'
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

describe('standing ship lod', () => {
  it('keeps the tier lod — the cull works on the baked copy, never forces a live model (BUG-894)', () => {
    expect(standingShipLod(1)).toBe(1)
    expect(standingShipLod(2)).toBe(2)
    expect(standingShipLod(0)).toBe(0)
    expect(standingShipLod('auto')).toBe(2)
  })
  it('partCulled applies the live rule to a baked part tag', () => {
    expect(partCulled(rigPart(1.4), 0.9)).toBe(true)
    expect(partCulled(rigPart(1.4), -0.5)).toBe(false)
    expect(partCulled(rigPart(1.4), null)).toBe(false)
    expect(partCulled(spanPart(-1, -0.65), -0.8)).toBe(true)
    expect(partCulled(spanPart(-1, -0.65), 1.5)).toBe(false)
    expect(partCulled('deck', 0)).toBe(false)
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

  it('galleon spawn (waist, BUG-893): the fore and main fans beside the stand are culled on the first look, the mizzen is not', () => {
    const a = SHIPS.galleon.anchors
    const spawnX = resolveDeckAnchors(a, 'galleon').spawn[0]
    const culled = a.masts.map((m) => rigCulled(m.base[0], spawnX))
    expect(culled).toEqual([true, true, false])
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

describe('walking cull follows the player, nothing pops while standing still (BUG-894)', () => {
  const masts = [0.5, -0.6]
  it('seeds from the spawn x only when a mast is within RIG_CULL_RADIUS', () => {
    expect(walkCullX(null, 0.1, masts)).toBe(0.1)
    expect(walkCullX(null, 2.0, masts)).toBeNull()
    expect(walkCullX(null, 0, [])).toBeNull()
  })
  it('holds the committed x through sub-step drift (standing still, settling), re-commits after WALK_CULL_STEP', () => {
    expect(walkCullX(0.1, 0.1 + WALK_CULL_STEP * 0.9, masts)).toBe(0.1)
    expect(walkCullX(0.1, 0.1 - WALK_CULL_STEP * 0.9, masts)).toBe(0.1)
    expect(walkCullX(0.1, 0.1 + WALK_CULL_STEP, masts)).toBe(0.1 + WALK_CULL_STEP)
  })
  it('hysteresis: live until the nearest mast is RIG_CULL_RADIUS + WALK_CULL_STEP away, back when it is within RIG_CULL_RADIUS', () => {
    expect(walkCullX(1.3, 1.6, masts)).toBe(1.6) // 1.1 from the fore mast: still live
    expect(walkCullX(1.6, 1.85, masts)).toBeNull() // 1.35 away: baked
    expect(walkCullX(null, 1.6, masts)).toBeNull() // not back yet
    expect(walkCullX(null, 1.4, masts)).toBe(1.4)
  })
  it('a committed cull never changes without the player moving (same x in → same x out)', () => {
    for (const x of [-1.5, -0.3, 0.1, 0.9, 1.7]) {
      const c = walkCullX(null, x, masts)
      expect(walkCullX(c, x, masts)).toBe(c)
    }
  })
})
