/**
 * Cannon-fire VFX: everything that makes a shot visible, from the muzzle to the water.
 *
 *   <Broadside shots=[{from,to}] stagger onImpact onAllImpacted>   flash + smoke + ball per gun (a single shot = 1)
 *   <Cannonball from to onImpact ref>                             ballistic iron ball with trail; ref.position for the follow-cam
 *   <MuzzleFlash position direction>  <CannonSmoke position direction wind>
 *   <Splash position scale>  = water column + spray + droplets + <FoamRing> + <WaterRipple>
 *   useEffectTimeline(duration) / createTimeline              frame-rate independent, skippable clocks
 *   solveArc / scheduleBroadside / batteryMuzzles / impactPointWorld   pure maths the director composes shots from
 */
export * from './ballistics'
export * from './anchors'
export * from './timeline'
export { DEFAULT_WIND, perpendicularBasis, dragDistance, useReducedMotion } from './motion'
export { SpriteCloud, type SpriteCloudHandle, type SpriteCloudProps } from './SpriteCloud'
export { MuzzleFlash, type MuzzleFlashProps } from './MuzzleFlash'
export { CannonSmoke, type CannonSmokeProps } from './CannonSmoke'
export { Cannonball, type CannonballProps, type CannonballHandle } from './Cannonball'
export { Broadside, type BroadsideProps, type BroadsideHandle } from './Broadside'
export { Splash, type SplashProps } from './Splash'
export { WaterRipple, type WaterRippleProps } from './WaterRipple'
export { FoamRing, type FoamRingProps } from './FoamRing'
export { smokeTexture, glowTexture, sprayTexture, noiseTexture, ironTexture, noiseField } from './textures'
