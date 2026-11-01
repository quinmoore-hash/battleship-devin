/**
 * Pure camera math for the Third-person seat (no three, no React): the orbit pose behind the pirate, the spring arm
 * that keeps the camera out of the deck, the raised castles and the masts, and the timed blend into the gunner's eye.
 * Ship space throughout (bow +x, waterline y = 0); the controller applies the ship's pose matrix afterwards.
 */
import type { Vec3 } from '../scene/layout'
import type { DeckAnchors } from './contract'
import { MAST_RADIUS, PITCH_LIMIT, clamp, lookForward, pointInPolygon, type Pt } from './math'

/** Default arm: the camera sits this far behind and above the pivot (the pirate's head). */
export const TP_BACK = 0.55
export const TP_UP = 0.28
/** Pivot height above the feet (the pirate is 0.17 u tall). */
export const TP_PIVOT = 0.15
/** Third-person lens. */
export const TP_FOV = 62
/** Orbit elevation limits (radians above the horizontal) around the default `atan2(TP_UP, TP_BACK)`. */
export const TP_ELEVATION_MIN = 0.06
export const TP_ELEVATION_MAX = 1.25
/** Camera stays at least this far above the deck under it and this far from a mast's axis. */
export const CAM_FLOOR = 0.07
/** Over a raised deck (castle / quarterdeck / poop) the camera must also clear its rail, else the rail hides the pirate below. */
export const CAM_RAISED_FLOOR = 0.4
export const CAM_MAST_RADIUS = MAST_RADIUS + 0.09
/** Polygons are grown by this margin when deciding which deck is "under" the camera (a camera just outside the quarterdeck face is still over it). */
export const CAM_DECK_MARGIN = 0.12
/** Seconds of the third ↔ first person blend (reduced motion cuts). */
export const BLEND_SECONDS = 0.4
/** Spring-arm samples along the arm. */
const ARM_STEPS = 10

export interface OrbitLook {
  /** Yaw of the camera orbit ('YXZ' convention: 0 looks down −z). */
  yaw: number
  /** Elevation offset from the default arm angle, radians (positive = higher). */
  pitch: number
}

export interface CameraBlockers {
  deck: DeckAnchors
  masts: readonly { base: Vec3; height: number }[]
  /** Indices into `masts` that carry fore-and-aft canvas only (gaff / spanker along the centreline): no sail slab across the beam. */
  foreAndAft?: readonly number[]
  /** Height of the lowest course foot above the mast base (`SAIL_FOOT_BY_CLASS`, default `SAIL_FOOT`). */
  sailFoot?: number
  /** Deck furniture (every `deck.obstacles` circle that is not a mast): the camera stays out of them below `top`. */
  posts?: readonly { center: Pt; radius: number; top: number }[]
}

/** Deck furniture is assumed this tall above its deck level (pumps 0.3, capstan 0.2, belfry 0.25). */
export const CAM_POST_HEIGHT = 0.35
/** Clearance the camera keeps from a post's edge. */
export const CAM_POST_MARGIN = 0.05

/** Lowest course foot above the mast base per class, in ship units (from each rig's yard table × fit scale). */
export const SAIL_FOOT_BY_CLASS: Readonly<Record<string, number>> = { brigantine: 0.2, frigate: 0.3, galleon: 0.45, 'man-o-war': 0.33 }

/** Masts without square sails per class (the sloop's gaff main, the brigantine's main, the galleon's lateen mizzen); every other mast gets a slab. */
export const FORE_AND_AFT_MASTS: Readonly<Record<string, readonly number[]>> = { sloop: [0], brigantine: [1], galleon: [2] }

export function blockersFor(deck: DeckAnchors, masts: CameraBlockers['masts'], id?: string): CameraBlockers {
  const posts: { center: Pt; radius: number; top: number }[] = []
  for (const o of deck.obstacles) {
    if (masts.some((m) => Math.hypot(m.base[0] - o.center[0], m.base[2] - o.center[1]) < 0.02)) continue
    let y = deck.walk[0]?.y ?? 0
    for (const lvl of deck.walk) if (lvl.y > y && pointInPolygon(o.center, lvl.points)) y = lvl.y
    posts.push({ center: o.center, radius: o.radius, top: y + CAM_POST_HEIGHT })
  }
  return {
    deck,
    masts,
    foreAndAft: id ? FORE_AND_AFT_MASTS[id] : undefined,
    sailFoot: id ? SAIL_FOOT_BY_CLASS[id] : undefined,
    posts,
  }
}

const DEFAULT_ELEVATION = Math.atan2(TP_UP, TP_BACK)
const ARM_LENGTH = Math.hypot(TP_UP, TP_BACK)

/** Elevation of the arm for a look offset, clamped to the limits. */
export const elevationFor = (pitch: number): number => clamp(DEFAULT_ELEVATION + pitch, TP_ELEVATION_MIN, TP_ELEVATION_MAX)

/** Where the camera wants to be (before the spring arm) for a pivot and look. */
export function orbitPosition(pivot: Vec3, look: OrbitLook, length = ARM_LENGTH): Vec3 {
  const el = elevationFor(look.pitch)
  const back = Math.cos(el) * length
  return [pivot[0] + Math.sin(look.yaw) * back, pivot[1] + Math.sin(el) * length, pivot[2] + Math.cos(look.yaw) * back]
}

/** Whether a grown polygon contains the point. */
function inGrownPolygon(p: Pt, poly: readonly Pt[], margin: number): boolean {
  if (pointInPolygon(p, poly)) return true
  // cheap growth: test against the polygon shifted toward the point by `margin` along each axis
  return pointInPolygon([p[0] - margin, p[1]], poly) || pointInPolygon([p[0] + margin, p[1]], poly) || pointInPolygon([p[0], p[1] - margin], poly) || pointInPolygon([p[0], p[1] + margin], poly) || pointInPolygon([p[0] - margin, p[1] - margin], poly) || pointInPolygon([p[0] + margin, p[1] + margin], poly) || pointInPolygon([p[0] - margin, p[1] + margin], poly) || pointInPolygon([p[0] + margin, p[1] - margin], poly)
}

/** Lowest height the camera may have at (x, z): the highest deck under it (grown by the margin), else the main deck. */
export function cameraFloor(x: number, z: number, deck: DeckAnchors): number {
  const main = deck.walk[0]?.y ?? 0
  let y = main + CAM_FLOOR
  for (const lvl of deck.walk) {
    if (lvl.y <= main) continue
    const top = lvl.y + CAM_RAISED_FLOOR
    if (top > y && inGrownPolygon([x, z], lvl.points, CAM_DECK_MARGIN)) y = top
  }
  return y
}

/**
 * Sails hang from the yards around each mast: a slab `SAIL_HALF_THICKNESS` thick in x, as wide as the yards (≈ 0.7 × the
 * mast height, the kit's lowest yard), from `SAIL_FOOT` of the height above the base to the truck. The anchors carry no
 * yard data, so this is the envelope every class fits in.
 */
export const SAIL_FORE = 0.06
/** The courses belly aft in the wind (kit cloth), so the slab reaches further aft of the mast. */
export const SAIL_AFT = 0.4
/** Fallback course-foot height above the mast base for a class missing from `SAIL_FOOT_BY_CLASS`: the camera may duck under it. */
export const SAIL_FOOT = 0.2
export const SAIL_HALF_WIDTH = 0.36

function insideMast(p: Vec3, b: Pick<CameraBlockers, 'masts' | 'foreAndAft' | 'sailFoot' | 'posts'>): boolean {
  if (b.posts) {
    for (const o of b.posts) if (p[1] < o.top && Math.hypot(p[0] - o.center[0], p[2] - o.center[1]) < o.radius + CAM_POST_MARGIN) return true
  }
  const masts = b.masts
  const foot = b.sailFoot ?? SAIL_FOOT
  for (let i = 0; i < masts.length; i++) {
    const m = masts[i]
    if (p[1] < m.base[1] - 0.2 || p[1] > m.base[1] + m.height) continue
    if (Math.hypot(p[0] - m.base[0], p[2] - m.base[2]) < CAM_MAST_RADIUS) return true
    if (b.foreAndAft?.includes(i)) continue
    const dx = p[0] - m.base[0]
    if (p[1] >= m.base[1] + foot && dx < SAIL_FORE && dx > -SAIL_AFT && Math.abs(p[2] - m.base[2]) < m.height * SAIL_HALF_WIDTH) return true
  }
  return false
}

export const isBlocked = (p: Vec3, b: CameraBlockers): boolean => p[1] < cameraFloor(p[0], p[2], b.deck) || insideMast(p, b)

/** Shortest arm fraction the camera keeps when only the floor is in the way (it is lifted instead); below this the pirate is hidden. */
export const MIN_ARM = 0.3

export interface CameraPose {
  position: Vec3
  target: Vec3
  /** Fraction of the ideal arm the spring arm kept (1 = clear). */
  arm: number
  /** Index into `SLIDES` the pose used (the controller snaps instead of damping when it changes: the damped path would cut through the mast). */
  slide: number
}

/**
 * Spring arm: march from the pivot toward `ideal` and stop before the first blocked sample; the result is never pushed
 * through anything, only pulled in. When only the deck floor cuts the arm short, the camera keeps `MIN_ARM` and is
 * lifted onto that floor instead (next to a castle face it looks over the planks rather than through them); a mast
 * really does pull it in.
 */
/** How much a floor lift costs when choosing between slides: a lifted camera looks down over a castle rail, so a clear unlifted slide with at least this much less arm still wins. */
export const LIFT_PENALTY = 0.25
export function springArm(pivot: Vec3, ideal: Vec3, b: CameraBlockers, out: Vec3 = [0, 0, 0]): { point: Vec3; arm: number; lifted: boolean } {
  let ok = 0
  const at = (t: number) => {
    out[0] = pivot[0] + (ideal[0] - pivot[0]) * t
    out[1] = pivot[1] + (ideal[1] - pivot[1]) * t
    out[2] = pivot[2] + (ideal[2] - pivot[2]) * t
  }
  // the deck floor never stops the march (the camera is lifted onto it); masts and sails do
  for (let i = 1; i <= ARM_STEPS; i++) {
    const t = i / ARM_STEPS
    at(t)
    const floor = cameraFloor(out[0], out[2], b.deck)
    if (out[1] < floor) out[1] = floor
    if (insideMast(out, b)) break
    ok = t
  }
  let t = ok
  if (ok < MIN_ARM) {
    at(MIN_ARM)
    if (!insideMast(out, b)) t = MIN_ARM
  }
  at(t)
  const wantY = out[1]
  const floor = cameraFloor(out[0], out[2], b.deck)
  if (out[1] < floor) out[1] = floor
  return { point: out, arm: t, lifted: out[1] > wantY + 0.05 }
}

/** The full third-person pose for a pirate standing at `feet` (ship space). */
/** When a mast / sail cuts the arm short, the camera also tries these [yaw, elevation] offsets and keeps the longest arm (lower first: under the sail's foot). */
export const SLIDES: readonly (readonly [number, number])[] = [
  [0, 0],
  [0, -0.3],
  [0.45, -0.3],
  [-0.45, -0.3],
  [0.45, 0],
  [-0.45, 0],
  [0.9, -0.3],
  [-0.9, -0.3],
  [0, -0.45],
  [0.45, -0.45],
  [-0.45, -0.45],
  [Math.PI / 2, -0.3],
  [-Math.PI / 2, -0.3],
]
const slideLook: OrbitLook = { yaw: 0, pitch: 0 }
const slidePoint: Vec3 = [0, 0, 0]

/** The full third-person pose for a pirate standing at `feet` (ship space). */
/** A slide already in use is kept while its arm is at least this fraction of the best one (no flip-flopping between sides of a mast). */
export const SLIDE_HYSTERESIS = 0.8

export function thirdPersonPose(feet: Vec3, look: OrbitLook, b: CameraBlockers, out: CameraPose = { position: [0, 0, 0], target: [0, 0, 0], arm: 1, slide: 0 }, prefer = out.slide): CameraPose {
  const pivot: Vec3 = [feet[0], feet[1] + TP_PIVOT, feet[2]]
  let best = -1
  let bestI = 0
  let preferArm = -1
  let arm0 = 0
  for (let i = 0; i < SLIDES.length; i++) {
    const [dy, dp] = SLIDES[i]
    slideLook.yaw = look.yaw + dy
    slideLook.pitch = look.pitch + dp
    const ideal = orbitPosition(pivot, slideLook)
    const r = springArm(pivot, ideal, b, slidePoint)
    const score = r.arm - (r.lifted ? LIFT_PENALTY : 0)
    if (i === 0) arm0 = score
    if (i === prefer) preferArm = score
    if (score > best) {
      best = score
      bestI = i
    }
    if (score >= 1 && i === 0) break
  }
  // back to the default view whenever it is (nearly) clear; otherwise stay on the slide in use while it is nearly as good
  let chosen = bestI
  if (arm0 >= best * SLIDE_HYSTERESIS) chosen = 0
  else if (prefer > 0 && prefer < SLIDES.length && preferArm >= best * SLIDE_HYSTERESIS) chosen = prefer
  slideLook.yaw = look.yaw + SLIDES[chosen][0]
  slideLook.pitch = look.pitch + SLIDES[chosen][1]
  const { arm } = springArm(pivot, orbitPosition(pivot, slideLook), b, out.position)
  out.arm = arm
  out.slide = chosen
  // aim a little ahead of and above the pirate's head so they sit in the lower third and the horizon stays in frame
  const f = lookForward(look.yaw, 0)
  out.target[0] = pivot[0] + f[0] * 0.12
  out.target[1] = pivot[1] + 0.09
  out.target[2] = pivot[2] + f[2] * 0.12
  return out
}

/** Smoothstep 0..1 of the blend clock (seconds since the blend started). */
export const blendProgress = (elapsed: number, seconds = BLEND_SECONDS): number => {
  if (seconds <= 0) return 1
  const t = clamp(elapsed / seconds, 0, 1)
  return t * t * (3 - 2 * t)
}

/** Linear blend of two poses (positions / targets); quaternions are slerped by the controller from these. */
export function blendPose(a: CameraPose, b: CameraPose, t: number, out: CameraPose = { position: [0, 0, 0], target: [0, 0, 0], arm: 1, slide: 0 }): CameraPose {
  for (let i = 0; i < 3; i++) {
    out.position[i] = a.position[i] + (b.position[i] - a.position[i]) * t
    out.target[i] = a.target[i] + (b.target[i] - a.target[i]) * t
  }
  out.arm = a.arm + (b.arm - a.arm) * t
  return out
}

/** Clamp a first-person pitch (the gunner's eye) and a third-person elevation offset. */
export const clampPitch = (pitch: number): number => clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT)
export const clampOrbit = (pitch: number): number => clamp(pitch, TP_ELEVATION_MIN - DEFAULT_ELEVATION, TP_ELEVATION_MAX - DEFAULT_ELEVATION)

/** Candidate orbit offsets (radians) tried for the first frame on a ship, nearest the enemy-facing yaw first. */
const SPAWN_YAWS = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]
const spawnPose: CameraPose = { position: [0, 0, 0], target: [0, 0, 0], arm: 1, slide: 0 }

/**
 * The orbit yaw the camera starts with when the pirate boards at `feet`: `wantYaw` (facing the enemy) unless the camera
 * behind it would be cut short, slid around a mast or lifted onto a castle — then the nearest of `SPAWN_YAWS` that frames
 * the pirate cleanly (a Man-o'-War pointing at the enemy would otherwise start with the camera over the quarterdeck,
 * against the mizzen). Scores: arm length, −0.15 per slide, −0.5 when lifted, −0.05 per step away from `wantYaw`.
 */
export function bestSpawnYaw(feet: Vec3, wantYaw: number, b: CameraBlockers): number {
  let best = wantYaw
  let bestScore = -Infinity
  for (let i = 0; i < SPAWN_YAWS.length; i++) {
    const yaw = wantYaw + SPAWN_YAWS[i]
    spawnPose.slide = 0
    thirdPersonPose(feet, { yaw, pitch: 0 }, b, spawnPose, 0)
    const lifted = spawnPose.position[1] > feet[1] + TP_PIVOT + TP_UP + 0.05
    const score = spawnPose.arm - (spawnPose.slide > 0 ? 0.15 : 0) - (lifted ? 0.5 : 0) - 0.05 * i
    if (score > bestScore) {
      bestScore = score
      best = yaw
    }
  }
  return best
}
