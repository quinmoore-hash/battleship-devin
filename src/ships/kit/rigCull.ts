/**
 * Standing-rigging cull while manning a cannon (BUG-800): the shrouds / ratlines / stays of any mast of the standing
 * ship within RIG_CULL_RADIUS (ship-local x; a lower-shroud fan reaches ~0.45 u from its mast) of the manned station are hidden, so the ±25° view cone over the rail is
 * not crossed by the gunner's own rigging. Only the dressed (lod 0) standing ship receives `rigCullX`.
 */
export const RIG_CULL_RADIUS = 1.0

export const rigCulled = (mastX: number, cullX: number | null | undefined): boolean =>
  cullX != null && Math.abs(mastX - cullX) < RIG_CULL_RADIUS
