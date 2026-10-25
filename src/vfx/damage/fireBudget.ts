import type { Vec3 } from '../../scene/layout'

/**
 * Shared point-light budget for fires. Each `<Fire>` registers here instead of owning a light;
 * the budget hands out at most one light per `FIRES_PER_LIGHT` fires (minimum 1, capped at
 * `MAX_FIRE_LIGHTS`) and places those lights where they cover the most fires. Pure TS so it
 * can be unit-tested; `<FireLights>` renders whatever `lights()` returns.
 */
export const FIRES_PER_LIGHT = 3
export const MAX_FIRE_LIGHTS = 4
/** Fires closer than this share one light. */
export const FIRE_CLUSTER_RADIUS = 2.2

export interface FireSource {
  id: string
  position: Vec3
  intensity: number
}

export interface FireLight {
  position: Vec3
  /** Sum of the intensities of the fires it covers (clamped by the renderer). */
  intensity: number
  /** Ids of the fires it covers, strongest first. */
  fires: string[]
}

export const lightCountFor = (fires: number): number =>
  fires <= 0 ? 0 : Math.min(MAX_FIRE_LIGHTS, Math.max(1, Math.ceil(fires / FIRES_PER_LIGHT)))

const dist2 = (a: Vec3, b: Vec3) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

/**
 * Greedy k-centre: the strongest fire seeds a light, each further light goes to the fire
 * furthest from every light so far; then every fire joins its nearest light and the light moves
 * to the intensity-weighted centroid of its cluster.
 */
export function planFireLights(fires: readonly FireSource[], max = lightCountFor(fires.length)): FireLight[] {
  const live = fires.filter((f) => f.intensity > 0)
  if (live.length === 0 || max === 0) return []
  const sorted = [...live].sort((a, b) => b.intensity - a.intensity || a.id.localeCompare(b.id))
  const centres: FireSource[] = [sorted[0]]
  while (centres.length < Math.min(max, sorted.length)) {
    let best: FireSource | null = null
    let bestD = -1
    for (const f of sorted) {
      const d = Math.min(...centres.map((c) => dist2(c.position, f.position)))
      if (d > bestD) {
        bestD = d
        best = f
      }
    }
    if (!best || bestD < FIRE_CLUSTER_RADIUS * FIRE_CLUSTER_RADIUS * 0.25) break
    centres.push(best)
  }
  const lights: FireLight[] = centres.map(() => ({ position: [0, 0, 0], intensity: 0, fires: [] }))
  const sums = centres.map(() => [0, 0, 0, 0])
  for (const f of sorted) {
    let k = 0
    let kd = Infinity
    centres.forEach((c, i) => {
      const d = dist2(c.position, f.position)
      if (d < kd) {
        kd = d
        k = i
      }
    })
    lights[k].fires.push(f.id)
    lights[k].intensity += f.intensity
    sums[k][0] += f.position[0] * f.intensity
    sums[k][1] += f.position[1] * f.intensity
    sums[k][2] += f.position[2] * f.intensity
    sums[k][3] += f.intensity
  }
  lights.forEach((l, i) => {
    const w = sums[i][3] || 1
    l.position = [sums[i][0] / w, sums[i][1] / w + 0.35, sums[i][2] / w]
  })
  return lights
}

type Listener = () => void

/** Mutable registry the React side talks to. One instance per scene (default: module singleton). */
export class FireLightBudget {
  private fires = new Map<string, FireSource>()
  private order: string[] = []
  private listeners = new Set<Listener>()
  private cached: FireLight[] | null = null
  private version = 0

  register(id: string, position: Vec3, intensity: number): () => void {
    if (!this.fires.has(id)) this.order.push(id)
    this.fires.set(id, { id, position, intensity })
    this.invalidate()
    return () => this.unregister(id)
  }

  update(id: string, position: Vec3, intensity: number): void {
    const f = this.fires.get(id)
    if (!f) return
    if (f.position[0] === position[0] && f.position[1] === position[1] && f.position[2] === position[2] && f.intensity === intensity) return
    this.fires.set(id, { id, position, intensity })
    this.invalidate()
  }

  unregister(id: string): void {
    if (!this.fires.delete(id)) return
    this.order = this.order.filter((o) => o !== id)
    this.invalidate()
  }

  /** The fire that renders the shared `<FireLights>`: the oldest live registration. */
  get hostId(): string | null {
    return this.order[0] ?? null
  }

  get size(): number {
    return this.fires.size
  }

  /** Recomputed lazily after any change. */
  lights(): FireLight[] {
    if (!this.cached) this.cached = planFireLights([...this.fires.values()])
    return this.cached
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Changes whenever the registry changes (for `useSyncExternalStore`). */
  snapshot(): number {
    return this.version
  }

  private invalidate() {
    this.cached = null
    this.version++
    for (const l of this.listeners) l()
  }
}

export const defaultFireBudget = new FireLightBudget()
