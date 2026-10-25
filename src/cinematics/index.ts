/**
 * cinematics module: scripted camera + VFX + audio sequences for every shot, sink and win-lose.
 *
 *   director.play(event, level)  → Promise that resolves when the sequence ends (immediately for `off`)
 *   director.skip()              → jump to the end (also click / Space / Esc via <Letterbox />)
 *   useDirector(selector)        → React access to busy / firing / sinkProgress / impacted / letterbox
 *   <CinematicLayer />           → in-scene VFX (cannonballs, flashes, splashes, impacts, sink water, fireworks)
 *   <CinematicCamera />          → drives the camera while busy; pair with <OceanScene cameraOverride={busy}>
 *   <Letterbox />                → HTML cinema bars + skip input
 *   useBattleCinematics()        → one-liner integration: plays the right sequence for every store event
 */
export * from './types'
export * from './battery'
export * from './sequence'
export { createDirector, director, useDirector, type Director, type DirectorState, type DirectorOptions, type ActiveCinematic, type Fleets } from './director'
export { CinematicLayer, type CinematicLayerProps } from './CinematicLayer'
export { CinematicCamera, wantedPose, type CinematicCameraProps } from './CinematicCamera'
export { Letterbox, useSkipInput, type LetterboxProps } from './Letterbox'
export { useBattleCinematics, type BattleCinematics, type UseBattleCinematicsOptions } from './useBattleCinematics'
