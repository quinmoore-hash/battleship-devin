/** `?no3d` in the URL disables the WebGL scene (low-end devices, e2e flow tests). */
export const is3dDisabled = (): boolean =>
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('no3d')
