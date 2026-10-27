/**
 * Frame statistics shared between the in-Canvas collector (`<PerfStats>`) and the DOM overlay /
 * `npm run perf` (`window.__perf`). One module-level object so no React state is touched per frame.
 */
import { median } from './tier'

export interface FrameStats {
  fps: number
  /** Milliseconds between the last two frames. */
  frameMs: number
  /** Smoothed main-thread JS cost per frame (useFrame callbacks + gl.render submit), ms. */
  jsMs: number
  /** Smoothed `gl.render` duration, ms (CPU submit; software GL includes rasterisation). */
  renderMs: number
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  programs: number
  /** `performance.memory.usedJSHeapSize` in MB when the browser exposes it. */
  heapMb: number
  frames: number
}

/** Set by `<PerfStats>` so `window.__perf.dump()` can walk the live scene. */
export const perfRefs: { scene: unknown; gl: unknown; camera: unknown } = { scene: null, gl: null, camera: null }

interface ProgramLike {
  cacheKey: string
  usedTimes: number
}

/** Live shader programs grouped by the material-parameter part of their cache key (debugging program growth). */
export function programSummary(): { key: string; programs: number; usedTimes: number }[] {
  const gl = perfRefs.gl as { info: { programs: ProgramLike[] | null } } | null
  const out = new Map<string, { key: string; programs: number; usedTimes: number }>()
  for (const p of gl?.info.programs ?? []) {
    const key = p.cacheKey.length > 200 ? `shader(${p.cacheKey.length})` + p.cacheKey.slice(-120) : p.cacheKey
    const r = out.get(key) ?? { key, programs: 0, usedTimes: 0 }
    r.programs++
    r.usedTimes += p.usedTimes
    out.set(key, r)
  }
  return [...out.values()].sort((a, b) => b.programs - a.programs)
}

export const frameStats: FrameStats = { fps: 0, frameMs: 0, jsMs: 0, renderMs: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0, heapMb: 0, frames: 0 }

const fpsHistory: number[] = []
const drawHistory: number[] = []
const MAX_HISTORY = 600

export function recordFrame(fps: number, drawCalls: number): void {
  fpsHistory.push(fps)
  drawHistory.push(drawCalls)
  if (fpsHistory.length > MAX_HISTORY) {
    fpsHistory.shift()
    drawHistory.shift()
  }
}

export function resetHistory(): void {
  fpsHistory.length = 0
  drawHistory.length = 0
}

export interface PerfSummary {
  medianFps: number
  minFps: number
  medianDrawCalls: number
  triangles: number
  samples: number
  frames: number
}

export function summarize(): PerfSummary {
  return {
    medianFps: Math.round(median(fpsHistory) * 10) / 10,
    minFps: fpsHistory.length ? Math.round(Math.min(...fpsHistory) * 10) / 10 : 0,
    medianDrawCalls: Math.round(median(drawHistory)),
    triangles: frameStats.triangles,
    samples: fpsHistory.length,
    frames: frameStats.frames,
  }
}

declare global {
  interface Window {
    __perf?: { stats: FrameStats; summary: () => PerfSummary; reset: () => void; tier: () => string; autoLower: () => boolean; dump: () => unknown[]; programs: () => unknown[]; scene: () => unknown; gl: () => unknown; camera: () => unknown; leaks: () => GeometryLeakRow[]; textureLeaks: () => GeometryLeakRow[]; store: () => unknown }
  }
}

interface TracedObject {
  uuid: string
  type: string
  addEventListener: (type: 'dispose', fn: () => void) => void
}
interface TracedMaterial {
  type: string
  uniforms?: Record<string, { value: unknown }>
  [slot: string]: unknown
}
interface TracedNode {
  type: string
  name: string
  parent: TracedNode | null
  geometry?: TracedObject
  material?: TracedMaterial | TracedMaterial[]
  traverse: (fn: (o: TracedNode) => void) => void
}

const tracedGeometries = new Map<string, string>()
const geometriesInScene = new Set<string>()
const tracedTextures = new Map<string, string>()
const texturesInScene = new Set<string>()

const isTexture = (v: unknown): v is TracedObject => !!v && typeof v === 'object' && (v as { isTexture?: boolean }).isTexture === true

function traceTexture(tex: TracedObject, path: string, mat: TracedMaterial, slot: string) {
  texturesInScene.add(tex.uuid)
  if (tracedTextures.has(tex.uuid)) return
  tracedTextures.set(tex.uuid, `${path}|${mat.type}.${slot}`)
  tex.addEventListener('dispose', () => tracedTextures.delete(tex.uuid))
}

/**
 * `?perf&trace`: remembers every geometry the scene has ever held, keyed by (ancestor names, mesh type,
 * geometry type), and forgets it when it is disposed. `geometryLeaks()` then lists the groups whose
 * geometries are no longer in the scene but were never disposed — i.e. what `renderer.info.memory.geometries` keeps.
 */
export function traceGeometries(scene: unknown): void {
  geometriesInScene.clear()
  texturesInScene.clear()
  ;(scene as TracedNode).traverse((o) => {
    const g = o.geometry
    if (!g) return
    const names: string[] = []
    for (let p: TracedNode | null = o; p; p = p.parent) if (p.name) names.unshift(p.name)
    const path = names.join('/') || '(root)'
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      for (const slot of Object.keys(m)) if (isTexture(m[slot])) traceTexture(m[slot] as TracedObject, path, m, slot)
      for (const [name, u] of Object.entries(m.uniforms ?? {})) if (isTexture(u.value)) traceTexture(u.value, path, m, `u.${name}`)
    }
    geometriesInScene.add(g.uuid)
    if (tracedGeometries.has(g.uuid)) return
    tracedGeometries.set(g.uuid, `${path}|${o.type}:${g.type}`)
    g.addEventListener('dispose', () => tracedGeometries.delete(g.uuid))
  })
}

export interface GeometryLeakRow {
  key: string
  /** Geometries seen in the scene at some point and not disposed since. */
  alive: number
  /** Of those, how many are still in the scene. */
  inScene: number
  /** alive − inScene: detached but undisposed. */
  leaked: number
}

function leakRows(traced: Map<string, string>, inScene: Set<string>): GeometryLeakRow[] {
  const rows = new Map<string, GeometryLeakRow>()
  for (const [uuid, key] of traced) {
    const r = rows.get(key) ?? { key, alive: 0, inScene: 0, leaked: 0 }
    r.alive++
    if (inScene.has(uuid)) r.inScene++
    r.leaked = r.alive - r.inScene
    rows.set(key, r)
  }
  return [...rows.values()].sort((a, b) => b.leaked - a.leaked)
}

export const geometryLeaks = (): GeometryLeakRow[] => leakRows(tracedGeometries, geometriesInScene)
/** Same for textures referenced by scene materials (map slots and ShaderMaterial uniforms). */
export const textureLeaks = (): GeometryLeakRow[] => leakRows(tracedTextures, texturesInScene)
