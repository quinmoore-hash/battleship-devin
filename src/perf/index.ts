/**
 * perf module: GPU tiering, distance LOD, `?perf` instrumentation and accessibility helpers.
 *
 *   usePerf() -> { tier, dpr, shadows, particlesScale, postprocessing, lod, quality, waves }
 *   usePerfStore (setQuality / detected / probed), <PerfBootstrap /> (runs the 2 s FPS probe once)
 *   <PerfStats /> (inside a Canvas) + <PerfOverlay /> (DOM) behind `?perf`
 *   useDistanceLod(position, hullLength) / <LodGroup> — per-ship LOD with hysteresis
 *   a11y: <A11yBootstrap />, useAnnouncer(), a11y.css
 */
export { TIER_PROFILES, TIERS, classifyRenderer, guessTier, refineTier, resolveTier, profileFor, median, fpsSamples, type Tier, type QualitySetting, type PerfProfile, type DeviceInfo } from './tier'
export { LOD_THRESHOLDS, lodForDistance, stepLod } from './lod'
export { usePerf, usePerfStore, getPerf, useParticlesScale, scaleCount, QUALITY_STORAGE_KEY } from './store'
export { runFpsProbe } from './probe'
export { PerfStats } from './PerfStats'
export { PerfOverlay } from './PerfOverlay'
export { PerfBootstrap, perfOverlayRequested } from './PerfBootstrap'
export { useDistanceLod, LodGroup } from './LodShip'
export { frameStats, summarize, type FrameStats, type PerfSummary } from './stats'
export { A11yBootstrap } from './a11y/A11yBootstrap'
export { Announcer, announce, useAnnouncer } from './a11y/Announcer'
