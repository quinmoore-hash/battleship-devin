import * as THREE from 'three'

const std = (color: string, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...extra })

/** Shared materials: one instance per look keeps draw-call setup cheap across the whole fleet. */
export const MAT = {
  // Devin the Otter palette (matches public/assets/devin-otter.png)
  otterOrange: std('#f0912d', { roughness: 0.65 }),
  otterCream: std('#f7e6c8', { roughness: 0.7 }),
  otterBlack: std('#1e1a17', { roughness: 0.4 }),
  otterNose: std('#15110f', { roughness: 0.25 }),
  eyeWhite: std('#ffffff', { roughness: 0.2 }),
  whisker: std('#2a2521', { roughness: 0.9 }),
  // laptop
  laptopGrey: std('#a9adb4', { roughness: 0.45, metalness: 0.35 }),
  laptopDark: std('#5a5e66', { roughness: 0.5, metalness: 0.3 }),
  screen: std('#bfe9ff', { emissive: '#7fd0ff', emissiveIntensity: 0.6, roughness: 0.2 }),
  // ships
  wood: std('#8a5a2b', { roughness: 0.9 }),
  woodDark: std('#5e3b1a', { roughness: 0.95 }),
  woodLight: std('#c99a62', { roughness: 0.85 }),
  kelp: std('#3e7d3a', { roughness: 0.8 }),
  kelpBright: std('#63a84f', { roughness: 0.75 }),
  kelpDark: std('#2b5d28', { roughness: 0.85 }),
  shellCream: std('#efe3d0', { roughness: 0.5, flatShading: true }),
  shellPink: std('#e5b8a6', { roughness: 0.5, flatShading: true }),
  shellTan: std('#c9b08e', { roughness: 0.7 }),
  shellPurple: std('#8b6aa3', { roughness: 0.55 }),
  rock: std('#7d8086', { roughness: 0.95, flatShading: true }),
  rockDark: std('#5d6066', { roughness: 0.95, flatShading: true }),
  moss: std('#4f8a3c', { roughness: 0.9 }),
  teal: std('#2f6f6a', { roughness: 0.4, metalness: 0.3 }),
  tealDark: std('#1f4a47', { roughness: 0.45, metalness: 0.3 }),
  metal: std('#a7adb5', { roughness: 0.35, metalness: 0.6 }),
  metalDark: std('#4b5058', { roughness: 0.4, metalness: 0.6 }),
  sail: std('#e9c57a', { roughness: 0.9, side: THREE.DoubleSide }),
  flag: std('#f0912d', { roughness: 0.9, side: THREE.DoubleSide }),
  lens: std('#ff3b30', { emissive: '#ff3b30', emissiveIntensity: 1.2 }),
  ripple: new THREE.MeshBasicMaterial({ color: '#dff3ff', transparent: true, opacity: 0.35, depthWrite: false }),
  // damage
  scorch: std('#141210', { roughness: 1 }),
  ember: std('#ff6a00', { emissive: '#ff4d00', emissiveIntensity: 1.6, roughness: 0.6 }),
  // markers
  buoyWhite: std('#f4f7f9', { roughness: 0.5 }),
  buoyRed: std('#e8453c', { roughness: 0.5 }),
  hitMarker: std('#ff2a1f', { emissive: '#ff1a0a', emissiveIntensity: 1.3, roughness: 0.4 }),
  flash: new THREE.MeshBasicMaterial({ color: '#fff1b0', transparent: true, opacity: 0.9, depthWrite: false }),
  splashRing: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
  fireRing: new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
  acorn: std('#8b5a2b', { roughness: 0.6 }),
  acornCap: std('#4e3015', { roughness: 0.9 }),
  // ghost
  ghostValid: new THREE.MeshStandardMaterial({ color: '#35d07f', emissive: '#1f8c52', emissiveIntensity: 0.4, transparent: true, opacity: 0.55, depthWrite: false }),
  ghostInvalid: new THREE.MeshStandardMaterial({ color: '#e8453c', emissive: '#8c1f1a', emissiveIntensity: 0.4, transparent: true, opacity: 0.55, depthWrite: false }),
  ghostTileValid: new THREE.MeshBasicMaterial({ color: '#35d07f', transparent: true, opacity: 0.35, depthWrite: false }),
  ghostTileInvalid: new THREE.MeshBasicMaterial({ color: '#e8453c', transparent: true, opacity: 0.35, depthWrite: false }),
}
