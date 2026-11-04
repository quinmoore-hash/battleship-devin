import { describe, expect, it } from 'vitest'
import { SHIPS } from '..'
import { RIG_CULL_RADIUS, rigCulled } from './rigCull'

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
