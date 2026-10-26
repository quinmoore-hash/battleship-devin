import { useFrame, useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import type * as THREE from 'three'
import { frameStats, perfRefs, recordFrame } from './stats'

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

let frameStart = 0

export interface DumpRow {
  path: string
  type: string
  tris: number
  draws: number
  castShadow: boolean
}

/** `window.__perf.dump()` — visible meshes grouped by (ancestor names, geometry type, material type). */
export function dumpScene(scene: THREE.Object3D): DumpRow[] {
  const rows = new Map<string, DumpRow>()
  scene.traverseVisible((o) => {
    const m = o as THREE.Mesh
    if (!m.geometry) return
    const g = m.geometry
    const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1
    const n = Math.floor((g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3) * inst
    const names: string[] = []
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name) names.unshift(p.name)
    const mat = Array.isArray(m.material) ? m.material[0] : m.material
    const key = `${names.join('/')}|${o.type}:${g.type}|${mat?.type ?? '-'}|${o.castShadow ? 'S' : ''}`
    const r = rows.get(key) ?? { path: names.join('/') || '(root)', type: `${o.type}:${g.type}/${mat?.type ?? '-'}`, tris: 0, draws: 0, castShadow: o.castShadow }
    r.tris += (m as THREE.Mesh).isMesh ? n : 0
    r.draws += 1
    rows.set(key, r)
  })
  return [...rows.values()].sort((a, b) => b.tris - a.tris)
}

export function PerfStats() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    perfRefs.scene = scene
    perfRefs.gl = gl
    perfRefs.camera = camera
    return () => {
      perfRefs.scene = null
      perfRefs.gl = null
      perfRefs.camera = null
    }
  }, [scene, gl, camera])
  useEffect(() => {
    gl.info.autoReset = false
    // jsMs: main-thread work from our (first-priority) useFrame until gl.render starts (all useFrame
    // callbacks); renderMs: gl.render submit (on SwiftShader this includes the software rasteriser).
    const render = gl.render.bind(gl)
    gl.render = (scene, camera) => {
      const t0 = performance.now()
      if (frameStart > 0) frameStats.jsMs = frameStats.jsMs === 0 ? t0 - frameStart : frameStats.jsMs * 0.9 + (t0 - frameStart) * 0.1
      render(scene, camera)
      const r = performance.now() - t0
      frameStats.renderMs = frameStats.renderMs === 0 ? r : frameStats.renderMs * 0.9 + r * 0.1
    }
    return () => {
      gl.info.autoReset = true
      gl.render = render
    }
  }, [gl])
  useFrame((_, delta) => {
    frameStart = performance.now()
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
