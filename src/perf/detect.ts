/** Browser-side device sniffing for `tier.ts`. Safe to call without a DOM (returns neutral values). */
import type { DeviceInfo } from './tier'

export function readRendererString(): string {
  if (typeof document === 'undefined') return ''
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (!gl) return ''
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return renderer
  } catch {
    return ''
  }
}

export function readDeviceInfo(): DeviceInfo {
  if (typeof window === 'undefined') {
    return { renderer: '', devicePixelRatio: 1, screenWidth: 1280, screenHeight: 800, hardwareConcurrency: 4, mobile: false }
  }
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const touch = (navigator.maxTouchPoints ?? 0) > 1
  return {
    renderer: readRendererString(),
    devicePixelRatio: window.devicePixelRatio || 1,
    screenWidth: window.screen?.width ?? window.innerWidth,
    screenHeight: window.screen?.height ?? window.innerHeight,
    hardwareConcurrency: navigator.hardwareConcurrency ?? 4,
    mobile: coarse && touch,
  }
}
