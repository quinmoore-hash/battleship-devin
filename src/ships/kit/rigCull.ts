/**
 * Standing-rigging cull while manning a cannon (BUG-800): the shrouds / ratlines / stays of any mast of the standing
 * ship within RIG_CULL_RADIUS (ship-local x; a lower-shroud fan reaches ~0.45 u from its mast) of the manned station are hidden, so the ±25° view cone over the rail is
 * not crossed by the gunner's own rigging. Only the dressed (lod 0) standing ship receives `rigCullX`.
 */
export const RIG_CULL_RADIUS = 1.0

/** A rail-length span (hammock netting panel x0..x1) is hidden when the cull x lies within SPAN_CULL_MARGIN of it. */
export const SPAN_CULL_MARGIN = 0.3
export const spanCulled = (x0: number, x1: number, cullX: number | null | undefined): boolean =>
  cullX != null && cullX > Math.min(x0, x1) - SPAN_CULL_MARGIN && cullX < Math.max(x0, x1) + SPAN_CULL_MARGIN

export const rigCulled = (mastX: number, cullX: number | null | undefined): boolean =>
  cullX != null && Math.abs(mastX - cullX) < RIG_CULL_RADIUS

/**
 * Walking cull (BUG-894): on deck the cull x is the player's own deck x, re-committed only once they have walked
 * WALK_CULL_STEP from the last committed x, so nothing pops while they stand still (the first look is seeded with the
 * spawn x). It is null — the standing ship back on the baked lod — when no mast is within RIG_CULL_RADIUS of it, and a
 * committed cull holds until the nearest mast is RIG_CULL_RADIUS + WALK_CULL_STEP away (hysteresis at the boundary).
 */
export const WALK_CULL_STEP = 0.2
export function walkCullX(prev: number | null, playerX: number, mastXs: readonly number[]): number | null {
  let nearest = Infinity
  for (const m of mastXs) nearest = Math.min(nearest, Math.abs(m - playerX))
  if (prev == null) return nearest < RIG_CULL_RADIUS ? playerX : null
  if (Math.abs(playerX - prev) < WALK_CULL_STEP) return prev
  return nearest < RIG_CULL_RADIUS + WALK_CULL_STEP ? playerX : null
}

/**
 * Baked rigging parts: a live model tags each mast's rigging `userData={{ bakePart: rigPart(mastX) }}` (a run between
 * two x, e.g. boarding netting: `spanPart(x0, x1)`), the standing ship's bake keeps those meshes separate
 * (`bakeObject(root, undefined, true)`) and `<BakedShip rigCullX>` hides the ones `partCulled()` says — the same rule the
 * live model applies — so the Medium / Low standing ship never has to go live for the cull (a live Man-o'-War looking
 * along its deck is ~450 draws).
 */
export const rigPart = (mastX: number): string => `rig:${mastX}`
export const spanPart = (x0: number, x1: number): string => `span:${x0}:${x1}`
export function partCulled(part: string, cullX: number | null): boolean {
  const [kind, ...rest] = part.split(':')
  const xs = rest.map(Number)
  if (kind === 'rig' && xs.length === 1) return rigCulled(xs[0], cullX)
  if (kind === 'span' && xs.length === 2) return spanCulled(xs[0], xs[1], cullX)
  return false
}
