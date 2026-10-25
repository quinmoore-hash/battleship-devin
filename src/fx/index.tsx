/**
 * fx module: ship models, shot markers / VFX, projectile and the Devin-the-Otter mascot.
 *
 * Public API (see ARCHITECTURE.md):
 *   <Fleet ships revealed />      <ShotMarkers shots offset? />      <OtterMascot mood />
 * plus the extensions documented in each component: <ShipGhost />, <Projectile />, <OtterPortrait />.
 */
export { Fleet, ShipGhost, ShipModel, type FleetProps, type ShipGhostProps, type ShipModelViewProps } from './ships'
export { ShotMarkers, Projectile, type ShotMarkersProps, type ProjectileProps } from './markers'
export { OtterMascot, OtterPortrait, type OtterMascotProps, type OtterPortraitProps } from './otter'
export { OTTER_MOODS, type OtterMood } from './timeline'
export { BOARD_LAYOUT, cellToWorld, shipCenter, type Vec3 } from './layout'
