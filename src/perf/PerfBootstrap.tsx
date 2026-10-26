import { useEffect } from 'react'
import { runFpsProbe } from './probe'
import { usePerfStore } from './store'
import { frameStats, resetHistory, summarize } from './stats'
import type * as THREE from 'three'
import { dumpScene } from './PerfStats'
import { geometryLeaks, perfRefs, programSummary, textureLeaks } from './stats'

export function perfOverlayRequested(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('perf')
}

/** Mount once near the root: runs the startup FPS probe (skipped when the player pinned a quality). */
export function PerfBootstrap() {
  const probed = usePerfStore((s) => s.probed)
  useEffect(() => {
    if (!perfOverlayRequested()) return
    window.__perf = {
      stats: frameStats,
      summary: summarize,
      reset: resetHistory,
      tier: () => usePerfStore.getState().profile.tier,
      autoLower: () => usePerfStore.getState().autoLower(),
      dump: () => (perfRefs.scene ? dumpScene(perfRefs.scene as THREE.Object3D) : []),
      programs: () => programSummary(),
      scene: () => perfRefs.scene,
      gl: () => perfRefs.gl,
      camera: () => perfRefs.camera,
      leaks: geometryLeaks,
      textureLeaks,
    }
    return () => {
      delete window.__perf
    }
  }, [])
  useEffect(() => {
    if (probed) return
    // give the scene a moment to compile shaders before measuring
    let cancel = () => {}
    const id = window.setTimeout(() => {
      cancel = runFpsProbe((fps) => usePerfStore.getState().reportProbe(fps))
    }, 1500)
    return () => {
      window.clearTimeout(id)
      cancel()
    }
  }, [probed])
  return null
}
