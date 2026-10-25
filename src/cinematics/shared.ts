import * as THREE from 'three'

/** The lead cannonball of the shot in flight, written by `<CinematicLayer>` each frame and read by `<CinematicCamera>` (no React state in the hot path). */
export const follow = {
  active: false,
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
}

export const smoothstep = (k: number): number => {
  const x = Math.min(1, Math.max(0, k))
  return x * x * (3 - 2 * x)
}
