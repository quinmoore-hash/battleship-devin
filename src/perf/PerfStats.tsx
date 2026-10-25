import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { frameStats, recordFrame } from './stats'

interface PerfMemory {
  usedJSHeapSize: number
}

/**
 * Mount inside a Canvas: reads `gl.info` once per frame (with `autoReset` off so the numbers are
 * for the whole previous frame including the shadow pass) and publishes them to `frameStats` /
 * `window.__perf`. No React state is set per frame.
 */
/** Frames skipped before sampling so shader compilation and geometry upload do not count. */
const WARMUP_FRAMES = 10

export function PerfStats() {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    gl.info.autoReset = false
    return () => {
      gl.info.autoReset = true
    }
  }, [gl])
  useFrame((_, delta) => {
    const r = gl.info.render
    const m = gl.info.memory
    frameStats.frameMs = delta * 1000
    frameStats.fps = delta > 0 ? 1 / delta : 0
    frameStats.drawCalls = r.calls
    frameStats.triangles = r.triangles
    frameStats.geometries = m.geometries
    frameStats.textures = m.textures
    frameStats.programs = gl.info.programs?.length ?? 0
    const mem = (performance as Performance & { memory?: PerfMemory }).memory
    if (mem) frameStats.heapMb = mem.usedJSHeapSize / 1048576
    frameStats.frames++
    if (frameStats.frames > WARMUP_FRAMES) recordFrame(frameStats.fps, r.calls)
    gl.info.reset()
  }, -1000)
  return null
}
