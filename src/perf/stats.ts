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
    __perf?: { stats: FrameStats; summary: () => PerfSummary; reset: () => void; tier: () => string; autoLower: () => boolean; dump: () => unknown[]; programs: () => unknown[]; scene: () => unknown; gl: () => unknown; camera: () => unknown }
  }
}
