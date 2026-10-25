/**
 * vfx/sinking — the cinematic ship death.
 *
 *   sinkPose(progress, { seed, hull, damage, lastHit }) -> { depth, roll, pitch, yaw }   pure, deterministic
 *   useSinkPose(progress, seed, hull, damage?, lastHit?)                                 hook
 *   placedSinkPose(placedShip, progress)                                                 for <Fleet>
 *   sinkProgressAt(elapsed, sinkTimeline('full' | 'fast'))                               time -> progress with slow-mo
 *   <SinkingShip ship livery damage progress placed? | position? rotationY? timeScale? />
 *   <HullWash> <Bubbles> <Whirlpool> <Debris> <Steam>   the water around the hull (also used standalone)
 *   <Flotsam cells boardOrigin seed livery?>             permanent wreckage on a sunk ship's cells
 */
export * from './pose'
export * from './timeline'
export * from './bubbles'
export * from './debris'
export { SinkingShip, useSinkPose, placedSinkPose, SURFACE_Y, type SinkingShipProps } from './SinkingShip'
export { HullWash, washIntensity, type HullWashProps } from './HullWash'
export { Bubbles, type BubblesProps } from './Bubbles'
export { Whirlpool, whirlpoolStrength, type WhirlpoolProps } from './Whirlpool'
export { Debris, Flotsam, FlotsamPieces, waterLevelAt, type DebrisProps, type FlotsamProps } from './Debris'
export { Steam, hissIntensity, type SteamProps } from './Steam'
export { DebrisMesh, pieceMaterials } from './pieces'
