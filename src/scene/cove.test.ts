import { describe, expect, it } from 'vitest'
import { BOARD_LAYOUT, boardBounds } from './layout'
import { buildHeightMap, inBoardZone, isLand, ISLANDS, LANDMARKS, scatterOnLand, terrainHeight, terrainNormal, waterDepth } from './cove'

describe('cove terrain', () => {
  it('keeps both boards (and a margin around them) in open water', () => {
    for (const key of ['player', 'enemy'] as const) {
      const [minX, minZ, maxX, maxZ] = boardBounds(BOARD_LAYOUT[key])
      for (let x = minX - 4; x <= maxX + 4; x += 1) {
        for (let z = minZ - 4; z <= maxZ + 4; z += 1) {
          expect(isLand(x, z), `land at ${x},${z}`).toBe(false)
          expect(waterDepth(x, z)).toBeGreaterThan(3)
        }
      }
    }
  })

  it('has land at every island summit above water, and a submerged reef', () => {
    for (const isl of ISLANDS) {
      const h = terrainHeight(isl.cx, isl.cz)
      if (isl.peak > 0) expect(h, isl.id).toBeGreaterThan(isl.peak * 0.5)
      else expect(h, isl.id).toBeLessThan(0.5)
    }
  })

  it('places every landmark on or just off its island as intended', () => {
    expect(terrainHeight(LANDMARKS.fort.x, LANDMARKS.fort.z)).toBeGreaterThan(2)
    expect(terrainHeight(LANDMARKS.lighthouse.x, LANDMARKS.lighthouse.z)).toBeGreaterThan(1)
    expect(terrainHeight(LANDMARKS.tavern.x, LANDMARKS.tavern.z)).toBeGreaterThan(0.3)
    // the dock stands in the shallows, the wreck lies on the reef
    expect(waterDepth(LANDMARKS.dock.x, LANDMARKS.dock.z)).toBeLessThan(6)
    expect(waterDepth(LANDMARKS.wreck.x, LANDMARKS.wreck.z)).toBeLessThan(3)
    for (const m of Object.values(LANDMARKS)) expect(inBoardZone(m.x, m.z)).toBe(false)
  })

  it('is continuous (no cliffs taller than a few metres per metre)', () => {
    for (let x = -80; x <= 80; x += 2) {
      for (let z = -60; z <= 40; z += 2) {
        const d = Math.abs(terrainHeight(x, z) - terrainHeight(x + 0.5, z))
        expect(d).toBeLessThan(3)
      }
    }
  })

  it('returns unit normals that point up on flat water', () => {
    const n = terrainNormal(0, -1)
    expect(Math.hypot(...n)).toBeCloseTo(1, 5)
    expect(n[1]).toBeGreaterThan(0.95)
  })
})

describe('scatterOnLand', () => {
  it('is deterministic and respects the height band, board zone and landmark clearance', () => {
    const a = scatterOnLand({ seed: 5, count: 60, minHeight: 0.5, maxHeight: 6, maxSlope: 0.7, landmarkClearance: 6 })
    const b = scatterOnLand({ seed: 5, count: 60, minHeight: 0.5, maxHeight: 6, maxSlope: 0.7, landmarkClearance: 6 })
    expect(a).toEqual(b)
    expect(a.length).toBeGreaterThan(40)
    for (const p of a) {
      expect(p.position[1]).toBeGreaterThanOrEqual(0.5)
      expect(p.position[1]).toBeLessThanOrEqual(6)
      expect(inBoardZone(p.position[0], p.position[2])).toBe(false)
      for (const m of Object.values(LANDMARKS)) {
        expect(Math.hypot(m.x - p.position[0], m.z - p.position[2])).toBeGreaterThanOrEqual(6)
      }
    }
  })

  it('keeps the requested spacing', () => {
    const pts = scatterOnLand({ seed: 9, count: 40, minHeight: 0.3, maxHeight: 8, spacing: 3 })
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        expect(Math.hypot(pts[i].position[0] - pts[j].position[0], pts[i].position[2] - pts[j].position[2])).toBeGreaterThanOrEqual(3)
      }
    }
  })
})

describe('buildHeightMap', () => {
  it('matches terrainHeight at texel centres', () => {
    const size = 32
    const map = buildHeightMap(size, 100)
    expect(map.length).toBe(size * size)
    const i = 20
    const j = 7
    const x = -100 + ((i + 0.5) / size) * 200
    const z = -100 + ((j + 0.5) / size) * 200
    expect(map[j * size + i]).toBeCloseTo(terrainHeight(x, z), 5)
  })
})
