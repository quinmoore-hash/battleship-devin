/**
 * Shared ship-detail kit: procedural PBR materials, hull lofter and detailed parts used by every ship class.
 * Ship coordinates: bow +x, stern −x, y = 0 waterline. All parts take a `livery` and share cached materials.
 */
export { shipMaterials, type ShipMaterials } from './materials'
export { loftHull, loftHullParts, basicHullSections, type HullSection, type LoftOptions, type LoftedHull, type WaleSpec, type GunPortSpec, type GunPortPlacement } from './hull'
export { Cannon, SwivelGun, CannonballStack, type CannonProps, type SwivelGunProps, type CannonballStackProps } from './Cannon'
export { Sail, type SailProps } from './Sail'
export { Flag, type FlagProps } from './Flag'
export { Mast, type MastProps } from './Mast'
export { Rope, Ratlines, Block, Cleat, ropeCurve, type RopeProps, type RatlinesProps, type BlockProps, type CleatProps } from './Rope'
export { Railing, GunPort, Stairs, Hatch, type RailingProps, type GunPortProps, type StairsProps, type HatchProps } from './Railing'
export {
  Barrel,
  Crate,
  RopeCoil,
  Lantern,
  SternLantern,
  Wheel,
  Anchor,
  Capstan,
  Bell,
  Window,
  Figurehead,
  Boat,
  Netting,
  Chest,
  HullHole,
  type BarrelProps,
  type CrateProps,
  type RopeCoilProps,
  type LanternProps,
  type SternLanternProps,
  type WheelProps,
  type AnchorProps,
  type CapstanProps,
  type BellProps,
  type WindowProps,
  type FigureheadProps,
  type BoatProps,
  type NettingProps,
  type ChestProps,
  type HullHoleProps,
} from './props'
