import { useEffect, useRef, useState } from 'react'
import { usePerfStore } from './store'
import { frameStats } from './stats'
import { TIERS, type QualitySetting } from './tier'

/** `?perf` HUD: FPS, frame time, draw calls, triangles, GPU memory counters and the tier/override. */
export function PerfOverlay() {
  const ref = useRef<HTMLPreElement>(null)
  const detected = usePerfStore((s) => s.detected)
  const probed = usePerfStore((s) => s.probed)
  const setting = usePerfStore((s) => s.setting)
  const setQuality = usePerfStore((s) => s.setQuality)
  const profile = usePerfStore((s) => s.profile)
  const renderer = usePerfStore((s) => s.device.renderer)
  const probeFps = usePerfStore((s) => s.device.probeFps)
  const [, tickState] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      const s = frameStats
      if (ref.current) {
        ref.current.textContent =
          `fps ${s.fps.toFixed(0).padStart(3)}  frame ${s.frameMs.toFixed(1).padStart(5)} ms\n` +
          `draw calls ${s.drawCalls}  tris ${(s.triangles / 1000).toFixed(1)}k\n` +
          `geometries ${s.geometries}  textures ${s.textures}  programs ${s.programs}` +
          (s.heapMb ? `\nheap ${s.heapMb.toFixed(0)} MB` : '')
      }
      tickState((n) => n + 1)
    }, 250)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div
      data-testid="perf-overlay"
      style={{
        pointerEvents: 'none',
        position: 'fixed',
        top: 8,
        left: 8,
        zIndex: 50,
        padding: '8px 10px',
        borderRadius: 8,
        background: 'rgba(0,0,0,0.72)',
        color: '#d9ffd9',
        font: '12px/1.4 ui-monospace, Menlo, monospace',
        maxWidth: 360,
      }}
    >
      <pre ref={ref} style={{ margin: 0 }} data-testid="perf-stats" />
      <div style={{ marginTop: 6, color: '#cfe8ff' }}>
        tier <b data-testid="perf-tier">{profile.tier}</b> (detected {detected}
        {probed ? (probeFps === undefined ? ', probe skipped' : `, probe ${probeFps.toFixed(0)} fps`) : ', probing…'}) · dpr ≤{profile.dpr[1]} · shadows {profile.shadows || 'off'} · post {profile.postprocessing ? 'on' : 'off'} · lod ≥{profile.lod} · particles ×{profile.particlesScale}
      </div>
      <div style={{ marginTop: 4, display: 'flex', gap: 4, alignItems: 'center' }}>
        <label htmlFor="perf-quality" style={{ color: '#cfe8ff' }}>
          quality
        </label>
        <select id="perf-quality" data-testid="perf-quality" value={setting} onChange={(e) => setQuality(e.target.value as QualitySetting)} style={{ font: 'inherit', pointerEvents: 'auto' }}>
          <option value="auto">auto</option>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <div style={{ marginTop: 4, color: '#9fb4c8', whiteSpace: 'normal', wordBreak: 'break-word' }}>{renderer || 'renderer unknown'}</div>
    </div>
  )
}
