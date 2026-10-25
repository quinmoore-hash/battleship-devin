/**
 * Photo mode.
 *
 *   <PhotoMode boards onClose? timeOfDay? weather? />   free camera over the battlefield, HUD-less, PNG capture
 *   usePhotoMode()                                      { request, isOpen, open(request?), close }
 *   requestPhotoMode(request?)                          dispatches `battleship:photo`
 *   capturePng(root)                                    renders one frame and reads it back (used by the capture button)
 *
 * `preserveDrawingBuffer` is a context-creation attribute, so it cannot be flipped on just for a capture; the
 * equivalent is what `<CaptureFrame>` does: render the frame and call `toDataURL()` synchronously in the same tick,
 * before the browser is allowed to clear the buffer. Nothing is paid for on ordinary frames.
 */
import { useFrame, type RootState } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GOLDEN_HOUR, OceanScene, type Weather } from '../scene'
import { useGameStore } from '../store/gameStore'
import { Battlefield } from './Battlefield'
import { DEFAULT_PHOTO_ORBIT, type OrbitState } from './camera'
import { FreeCamera } from './FreeCamera'
import { createOverlayStore, useOverlay, useWindowEvent } from './overlay'
import type { ReplayBoards } from './replayModel'
import './extras.css'

export const PHOTO_EVENT = 'battleship:photo'

export interface PhotoRequest {
  boards: ReplayBoards
  timeOfDay?: number
  weather?: Weather
  camera?: OrbitState
}

const photoStore = createOverlayStore<PhotoRequest>()

export function openPhotoMode(request?: Partial<PhotoRequest>) {
  const s = useGameStore.getState()
  photoStore.open({
    boards: request?.boards ?? { playerBoard: s.playerBoard, enemyBoard: s.enemyBoard },
    weather: request?.weather ?? (s.modes.storm ? 'stormy' : 'calm'),
    timeOfDay: request?.timeOfDay,
    camera: request?.camera,
  })
}
export const closePhotoMode = () => photoStore.close()

export function requestPhotoMode(request?: Partial<PhotoRequest>) {
  window.dispatchEvent(new CustomEvent(PHOTO_EVENT, { detail: request }))
}

export function usePhotoMode() {
  const request = useOverlay(photoStore)
  return useMemo(() => ({ request, isOpen: request !== null, open: openPhotoMode, close: closePhotoMode }), [request])
}

export function usePhotoEvent() {
  useWindowEvent<Partial<PhotoRequest>>(PHOTO_EVENT, (detail) => openPhotoMode(detail))
}

/** Renders the current frame (when no post-processing pass already did) and reads the canvas back as a PNG data URL. */
export function capturePng(root: Pick<RootState, 'gl' | 'scene' | 'camera' | 'internal'>): string {
  if (root.internal.priority <= 1) root.gl.render(root.scene, root.camera)
  return root.gl.domElement.toDataURL('image/png')
}

export const photoFileName = (date = new Date()): string => `pirate-battleship-${date.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function CaptureFrame({ onCapture }: { onCapture: (dataUrl: string) => void }) {
  const done = useRef(false)
  useFrame((root) => {
    if (done.current) return
    done.current = true
    onCapture(capturePng(root))
  }, 1000)
  return null
}

export interface PhotoModeProps {
  boards: ReplayBoards
  onClose?: () => void
  timeOfDay?: number
  weather?: Weather
  camera?: OrbitState
  quality?: 'low' | 'high'
  /** Called with the PNG instead of downloading it (tests / demo gallery). */
  onCapture?: (dataUrl: string) => void
}

export function PhotoMode({ boards, onClose, timeOfDay = GOLDEN_HOUR, weather: initialWeather = 'calm', camera = DEFAULT_PHOTO_ORBIT, quality, onCapture }: PhotoModeProps) {
  const [tod, setTod] = useState(timeOfDay)
  const [weather, setWeather] = useState<Weather>(initialWeather)
  const [hud, setHud] = useState(true)
  const [capturing, setCapturing] = useState(false)
  const [lastShot, setLastShot] = useState<string | null>(null)
  const [flash, setFlash] = useState(false)

  const captured = useCallback(
    (dataUrl: string) => {
      setCapturing(false)
      setLastShot(dataUrl)
      setFlash(true)
      window.setTimeout(() => setFlash(false), 350)
      if (onCapture) onCapture(dataUrl)
      else downloadDataUrl(dataUrl, photoFileName())
    },
    [onCapture],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'Escape') onClose?.()
      else if (e.key === 'h' || e.key === 'H') setHud((v) => !v)
      else if (e.key === 'c' || e.key === 'C') setCapturing(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className={`xt-overlay xt-photo${hud ? '' : ' hud-hidden'}`} data-testid="photo-mode" data-hud={hud} data-tod={tod.toFixed(2)}>
      <OceanScene view="gameover" interactive={false} timeOfDay={tod} weather={weather} quality={quality}>
        <Battlefield boards={boards} lod={quality === 'low' ? 2 : 0} quality={quality} />
        <FreeCamera initial={camera} />
        {capturing && <CaptureFrame onCapture={captured} />}
      </OceanScene>
      {flash && <div className="xt-flash" aria-hidden />}

      {hud && (
        <>
          <header className="xt-topbar">
            <div className="xt-title">
              <span className="xt-eyebrow">Photo mode</span>
              <strong>Drag to orbit · right-drag to pan · wheel to zoom · WASD/QE to fly</strong>
            </div>
            <div className="xt-row">
              <button type="button" className="xt-btn ghost" data-testid="photo-hide-hud" onClick={() => setHud(false)} title="Hide HUD (H)">
                Hide HUD
              </button>
              {onClose && (
                <button type="button" className="xt-btn ghost" data-testid="photo-close" onClick={onClose}>
                  Close ✕
                </button>
              )}
            </div>
          </header>

          <section className="xt-panel xt-photo-controls" aria-label="Photo controls">
            <label className="xt-field">
              <span>
                Time of day <em data-testid="photo-tod-value">{tod.toFixed(2)}</em>
              </span>
              <input className="xt-range" type="range" min={0} max={1} step={0.005} value={tod} data-testid="photo-tod" onChange={(e) => setTod(Number(e.target.value))} />
              <div className="xt-ticks" aria-hidden>
                <i>night</i>
                <i>dawn</i>
                <i>noon</i>
                <i>dusk</i>
                <i>night</i>
              </div>
            </label>
            <div className="xt-row">
              <div className="xt-speeds" role="group" aria-label="Weather">
                {(['calm', 'stormy'] as const).map((w) => (
                  <button key={w} type="button" className={`xt-btn small${w === weather ? ' active' : ''}`} aria-pressed={w === weather} data-testid={`photo-weather-${w}`} onClick={() => setWeather(w)}>
                    {w}
                  </button>
                ))}
              </div>
              <button type="button" className="xt-btn primary" data-testid="photo-capture" disabled={capturing} onClick={() => setCapturing(true)} title="Capture (C)">
                {capturing ? 'Capturing…' : 'Capture PNG'}
              </button>
            </div>
            {lastShot && (
              <a className="xt-thumb" href={lastShot} download={photoFileName()} data-testid="photo-last-shot" title="Download again">
                <img src={lastShot} alt="Last capture" />
              </a>
            )}
          </section>
        </>
      )}
      {!hud && (
        <button type="button" className="xt-btn ghost xt-show-hud" data-testid="photo-show-hud" onClick={() => setHud(true)} title="Show HUD (H)">
          Show HUD
        </button>
      )}
    </div>
  )
}
