/**
 * Frame statistics shared between the in-Canvas collector (`<PerfStats>`) and the DOM overlay /
 * `npm run perf` (`window.__perf`). One module-level object so no React state is touched per frame.
 */
import { median } from './tier'

export interface FrameStats {
  fps: number
  /** Milliseconds between the last two frames. */
  frameMs: number
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  programs: number
  /** `performance.memory.usedJSHeapSize` in MB when the browser exposes it. */
  heapMb: number
  frames: number
}

export const frameStats: FrameStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0, heapMb: 0, frames: 0 }

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
    __perf?: { stats: FrameStats; summary: () => PerfSummary; reset: () => void; tier: () => string; autoLower: () => boolean }
  }
}
