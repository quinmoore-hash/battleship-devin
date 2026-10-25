/** vfx module: shared particle helpers plus one line per effect family so parallel sessions don't conflict here. */
export * from './particles'
export * from './ParticleFx'
export * from './math'
export * from './random'
export * from './cannon'
export * from './damage'
// `useReducedMotion` exists in both cannon and damage (same behaviour); pick one explicitly.
export { useReducedMotion } from './cannon'
export * from './markers'
export * from './sinking'
