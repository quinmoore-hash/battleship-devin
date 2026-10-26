# Architecture — Pirate Battleship

A fully 3D, cinematic pirate Battleship. The code is split into modules so many Devin sessions can work in
parallel without merge conflicts. **Each module owns one folder. Change another module's folder only through
its public API; if the API needs to change, say so in your PR description and update this file.**

```
src/
  engine/      pure game rules: board, fleet, placement, firing, win detection. No React, no DOM.
  ai/          enemy opponents (easy / medium / hard). Implements AiOpponent. Pure TS, unit-tested.
  store/       zustand game state machine: menu -> placement -> battle -> gameover.
  scene/       3D world: react-three-fiber Canvas, Gerstner water, sky/time-of-day, weather, Caribbean cove
               dressing (islands, fort, wreck, lighthouse, gulls), board grids (buoy lines), camera rig, layout.
  ships/       the five ship classes + shared detail kit + <Fleet>. One sub-folder per class:
    kit/         cannons, masts, sails, rigging, flags, deck props, hull lofter, livery materials (shared)
    man-o-war/ galleon/ frigate/ brigantine/ sloop/   one detailed procedural model each
  vfx/         particles & effects: cannon fire (muzzle flash, smoke, cannonball, splash), damage
               (splinters, fire, smoke, hull holes), sinking (list/flood/bubbles/debris/flotsam), markers.
  cinematics/  director: scripted camera + VFX + audio sequences per shot / sink / win-lose. Skippable.
  ui/          HTML/React overlay: menu, settings, how-to-play, placement HUD, battle HUD, game over.
  audio/       Howler SFX + music + ambience, volume/mute, persisted settings.
e2e/           Playwright tests, driven through data-testid attributes (see below).
public/assets/ textures, audio.
```

## Coordinate conventions (everyone depends on these)
- World: y up, water surface at `BOARD_LAYOUT.surfaceY` (0.2). The player's board is near the camera (+z),
  the enemy's board across the gap (−z). `src/scene/layout.ts` exports `BOARD_LAYOUT.player` /
  `BOARD_LAYOUT.enemy`, `cellToWorld`, `worldToCell`, `boardCenter`, `boardBounds`.
- Ship models (`src/ships`): authored in their own frame, **bow = +x, stern = −x, centred at the origin,
  y = 0 is the waterline, one world unit per grid cell**. Models never move their own root (bobbing,
  recoil of the whole ship, sinking transform are applied by `<Fleet>` / vfx / cinematics). They change
  *shape* from props: `damage[]` per cell, `sinkProgress`, `sails`, `firing`.
- `shipWorldTransform(placedShip, boardOrigin)` gives the world position / rotationY of a placed ship.
  Horizontal ships point their bow toward +x (higher columns), vertical ships toward +z (higher rows).

## Public APIs (keep these stable)

### engine (`src/engine`)
- `BOARD_SIZE`, `FLEET`, `FLEET_BY_ID` — fleet is `man-o-war`(5) `galleon`(4) `frigate`(3) `brigantine`(3) `sloop`(2)
- `createBoard`, `canPlace`, `placeShip`, `removeShip`, `randomPlacement`, `isFleetPlaced`
- `fire(board, coord) -> { board, result }`, `isFleetSunk`, `isSunk`, `enemyView`, `viewGrid`
- helpers: `coordKey`, `coordLabel`, `inBounds`, `neighbors`, `allCoords`
- types: `Coord`, `Board`, `PlacedShip`, `ShipSpec`, `ShipId`, `ShotResult`, `EnemyBoardView`, `Difficulty`, `Player = 'human' | 'enemy'`

### ai (`src/ai`)
```ts
interface AiOpponent { readonly difficulty: Difficulty; nextShot(view: EnemyBoardView): Coord; observe(result: ShotResult): void }
createOpponent(difficulty, rng?) => AiOpponent;  describeStrategy(difficulty);  seededRng(seed);  playGame(opponent, board)
```

### store (`src/store/gameStore.ts`)
`useGameStore` with `phase`, `difficulty`, `playerBoard`, `enemyBoard`, `turn`, `winner`, `events`, `settings`
(`sfxVolume`, `musicVolume`, `reducedMotion`, `cinematics: 'full' | 'fast' | 'off'`) and actions `startGame`,
`placePlayerShip`, `removePlayerShip`, `autoPlacePlayerFleet`, `confirmPlacement`, `fireAt`, `enemyTurn`,
`updateSettings`, `reset`. The game loop controls pacing: after the human fires, it awaits the cinematic
(or a timer when cinematics are off) and then calls `enemyTurn()`.

### scene (`src/scene`)
`<OceanScene quality? timeOfDay? view? interactive? cameraOverride? dressing? weather?>{children}</OceanScene>` full-screen Canvas with
WebGL fallback (`?no3d` forces the fallback). `<BoardGrid origin size cellSize highlight? onCellPointerMove? onCellClick? color?>`,
`<CameraRig view interactive? override?>` with `CameraView = 'menu' | 'placement' | 'battle' | 'gameover'` (`override` = a cinematic owns the
camera: the rig stops writing position/target/fov and disables orbit, then damps back when it flips off), `computeAtmosphere`,
`sampleWaveHeight/Normal`, layout helpers above, `<SceneDemo>` (`?scene-demo`). Perf knobs (set by `OceanScene` from
`usePerf()`): `<Lighting shadowSize?>` (0 = no shadow pass), `<Water waves?>`, `<Effects enabled?>` (lazy chunk).

### perf (`src/perf`)
`usePerf()` → `{ tier, dpr, shadows, particlesScale, postprocessing, lod, quality, waves, waterSegments }` resolved from GPU
detection (`WEBGL_debug_renderer_info`, dpr × screen, cores, 2 s startup FPS probe via `<PerfBootstrap>`) and the
persisted override `settings.quality: 'auto' | 'low' | 'medium' | 'high'` (`?quality=` wins). `medium` is the default
and the tuned target (MacBook Air M4 / Iris Xe at native res, dpr ≤ 1.5, 1k shadows, no post, lod ≥ 1); Apple GPUs
always start there; `high` (2k shadows, bloom/SMAA, lod 0, full particles) is manual or needs a discrete-class GPU
*and* a ≥ 90 fps probe. `<FpsWatchdog>` drops one tier once when battle FPS stays < 45 for 4 s (`auto` only) and
`<QualityToast>` shows the one-time notice; `window.__perf.autoLower()` triggers it for tests; `?gpu=` pins the detected tier (skips the probe). `useDistanceLod(position,
hullLength)` / `<LodGroup>` pick a ship `lod` from camera distance with hysteresis + 1 s dwell; `<Fleet lod="auto">`
uses it. `useParticlesScale()` / `scaleCount(n, scale)` for VFX counts. `?perf` adds `<PerfStats>` (gl.info) +
`<PerfOverlay>`; `window.__perf.summary()` feeds `npm run perf`. `?perf-demo` = full-game load. Accessibility:
`<A11yBootstrap>` (prefers-reduced-motion → `reducedMotion` + `cinematics:'fast'`, `<html data-colorblind|
data-reduced-motion|data-quality>`, Space → `SKIP_CINEMATIC_EVENT`), `announce()`/`<Announcer>` live regions,
`a11y.css` (focus rings, HUD text halo, colour-blind marker shapes behind `settings.colorblind`, ≥ 44 px cells on touch).

**Budgets (hard, measured with `?perf` / `renderer.info` at the battle overview; `npm run perf:game` plays a game and prints
them per checkpoint):** Medium ≤ 350 draw calls / ≤ 250k triangles, Low ≤ 200 / ≤ 120k, placement same as battle, and *flat
over a whole game* — markers, damage, fires, smoke and flotsam may add ~1 draw call per *type*, never per shot. Geometries,
textures, programs and heap must be flat (±5 %) after 60 shots and across Rematch / Play Again / menu round-trips. JS per
frame (useFrame work, `frameStats.jsMs`) < 4 ms. Rules that keep it so:
- **Ships are baked.** `<Ship lod ≥ 1>` renders the shared bake from `src/ships/bake.tsx`: `<ShipBakery>` (mounted once in
  `<OceanScene>`) keeps ONE hidden live copy per (shipId, livery, lod, quality) and `bakeObject()` merges its static meshes per
  material (`materialKey()`: parameter signature for stock materials, identity for custom shaders) into a few `Mesh`es; every
  instance renders a `clone()` sharing geometry + materials. Baked ships never rebuild on damage / sinkProgress / firing — only
  lod 0 (the one cinematic-focused ship) and a ship mid-sink (`0 < sinkProgress < 1`) are live. Placement uses
  `max(1, perf.lod)`. The cache is bounded by keys, shared by placement → battle → Rematch, and dropped on the way back to the menu (`clearBakeCache()` in `<OceanScene>`) so `renderer.info.memory` returns to the menu baseline. `<BakedGroup>` does the
  same for static dressing (buoy corners, cove props, flotsam pieces, floaters).
- **Per-cell VFX are shared systems.** `<Fires>` / `<Smokes>` (`src/vfx/damage/FireField.tsx`, `EMITTER_CAP` 200 emitters,
  buffers allocated once, `count` set per frame) replace one `<Fire>`/`<Smoke>` per hit in `<DamageLayer>` and
  `<ShotMarkers>`; hull breaches are capped to the newest `BREACH_CAP` cells. Never mount a component per shot that owns
  materials or geometry.
- **Light count is constant.** three recompiles every program when the number of visible lights changes, so `<FireLights>`
  (4 slots, never toggled `visible`) and `<FlashLights>` (`src/vfx/flashLights.tsx`, 2 slots borrowed by `MuzzleFlash` /
  `ImpactFlash` via `useFlashSlot`) are mounted permanently in `<BattleWorld>`. Do not add `<pointLight>`s to transient VFX.
- **Only ships cast shadows.** No `castShadow` on water, islands, dressing, markers, VFX. Shadow map ≤ 1024 on Medium.
- **Water / terrain density follows the tier**, not the look: `TIER_PROFILES[tier].waterSegments` (96 / 128 / 224) and
  `IslandTerrain` segments; Medium keeps high-quality shading on the coarse mesh. `resolveDpr()` caps Medium at 1.25 when
  `screen.width × dpr > 2500` (Retina MacBooks), else 1.5.
- **No per-frame allocation**: hoist `Vector3`/`Color`/`Matrix4`/`Object3D` scratch objects to module scope; drive
  animation through refs / uniforms, never React state. Sprite systems get their `aParam` attribute once via `attachParams`
  (capacity, not count) and free it with `disposeParams` on unmount.
- Debug: `window.__perf.dump()` lists visible meshes by named group / geometry / material; `window.__perf.programs()` groups
  live shader programs by cache key (a growing list = light-count or define churn).


### ships (`src/ships`)
```tsx
SHIPS[id]: ShipDefinition { id, name, length, Model, anchors }
<Ship id livery damage sinkProgress? lod? quality? sails? phase? firing? />
<Fleet ships livery revealed? boardOrigin? cellSize? sinkProgress? firing? lod? quality? />
shipWorldTransform(ship, boardOrigin), damageOf(ship), shipRotationY(orientation)
kit.* — Cannon, Mast, Sail, Flag, Rope, Ratlines, Railing, Barrel, Crate, RopeCoil, Lantern, Wheel, Anchor, HullHole,
        loftHull(sections), basicHullSections(...), shipMaterials(livery)
```
`ShipAnchors` (per class, hand-authored to match the model): `cannons[{cell, side, muzzle, direction}]`,
`masts[{base, height}]`, `deckY`, `hull{length,beam,height,draft}`, `impactPoints[]`. The cinematics/vfx
modules read these to spawn muzzle flashes, aim cannonballs and place fires. Types in `src/ships/types.ts`.
`?ship-demo[&ship=galleon&livery=navy&damage=0,2&sink=0.4&sails=0.5]` renders models for review.

### vfx (`src/vfx`)
Shared helpers today: `particles.ts` (`makeBurst`, `smokePuff`, `particleAt`), `<ParticleBurst>`, `<SmokeColumn>`,
`math.ts` (easings, `arcPoint`, `arcApex`), `random.ts`. Wave 1 adds, each in its own file(s):
- `cannon`: `<MuzzleFlash>`, `<CannonSmoke>`, `<Cannonball from to onImpact>` (ballistic, with trail), `<Splash>` (miss water column)
- `damage`: `<SplinterBurst>`, `<Fire>`, `<Smoke>` (persistent per damaged cell), `<HullBreach>`
- `sinking`: `useSinkPose(progress)` (list/roll/depth), `<Bubbles>`, `<Debris>`, `<Flotsam>` (stays on the grid)
- `markers`: `<ShotMarkers shots boardOrigin>` (buoys/wreck markers for hits & misses on the water)

### cinematics (`src/cinematics`)
See `types.ts`: `CinematicEvent` (`shot`, `sink`, `battle-start`, `victory`), `CinematicDirector.play(event, level)`,
`CINEMATIC_TIMING`.
```tsx
director.play(event, level): Promise<void>   // shared instance; resolves when the sequence ends (at once for 'off')
director.skip(); director.busy; director.setFleets(() => ({ human, enemy }) | null)
createDirector({ fleets?, reducedMotion?, autoTick?, audio? })   // isolated instance (tests, demos)
useDirector((s) => s.busy | s.firing | s.sinkProgress | s.impacted | s.letterbox | s.timeScale)
<CinematicLayer />      // inside <OceanScene>: cannonballs, flashes, splashes, hull impacts, sink water fx, fireworks/wrecks
<CinematicCamera />     // inside <OceanScene>; pair with <OceanScene cameraOverride={busy}>
<Letterbox />           // HTML: cinema bars + click / Space / Esc skip
const cine = useBattleCinematics()   // plays a sequence for every new store event; cine.busy, await cine.idle(), cine.visibleShots(shots)
pickBattery(ships, target, ownOrigin, targetOrigin), planShot(by, result, shooters, targets), buildSequence(event, level, reducedMotion)
```
Pass `firing={useDirector((s) => s.firing)}` and `sinkProgress={useDirector((s) => s.sinkProgress)}` to both `<Fleet>`s.
Shot audio: the `fire` beat starts one `playCinematicAudio` timeline (fire → whistle → impact) whose `flightMs` is the
fire→impact beat distance; a skip before impact cancels it and plays the impact cue at once.
Enemy shots fire from an unseen gun line past the far edge of the Navy waters (showing the real ship would leak its
position). `?cinematics-demo` exercises every sequence.

### audio (`src/audio`)
`initAudio()`, `playSfx(name, opts?)` → `SfxHandle` (`stop()` for the `fire-loop` / `bubbles` loops), `playSfxAt(name, worldPos)`
(camera-relative pan + distance gain; feed the camera with `setAudioListener(pos, forward)` / `setAudioListenerFromCamera(camera)`),
`startMusic('menu' | 'battle', { sting? })` (crossfades) / `stopMusic`, `playIntroSting`, `startAmbience/stopAmbience`, `setStorm(0..1)`,
`duckMusic(ms)`, `setMasterVolume/setSfxVolume/setMusicVolume/setAmbienceVolume/setMuted`, `useAudioSettings` (persisted
`battleship-devin.audio`, v2: master/sfx/music/ambience/muted), `useAudioRuntime`, `shotTimeline` / `broadsideTimeline` / `playTimeline`,
`playShot`, `playCinematicAudio(event, { flightMs })` (the hook for the cinematics director), `bindGameAudio()`, `<AudioSettings showAllBuses? />`,
`<AudioDemo />` (`?audio-demo`). SFX names live in `manifest.ts` (`CanonicalSfx` + legacy aliases `fire/hit/miss/sunk/victory/defeat/place`);
every file is generated by `scripts/generate-audio.mjs` (see `public/assets/audio/LICENSES.md`).

### ui (`src/ui`)
`<GameUI />` is the HTML overlay; `<GameWorld />` (exported from `src/ui`) is mounted as a child of `<OceanScene>` and
draws both `BoardGrid`s, the fleets, shot markers/damage and the placement ghost. Shared pointer state (hovered cell,
carried ship, orientation, pending touch target) lives in `useUiStore` (`src/ui/uiStore.ts`), which also persists the
player's `quality` (`auto|low|high`), `colorblind` markers and dismissed hints under `battleship-devin.ui`.
Turn pacing: `src/ui/turnFlow.ts` plays every beat as a `CinematicEvent` through the registered director
(`setDirector`), else through a skippable `TimerDirector`. `activeDirector()` falls back to timers under `?no3d` / no
WebGL (nothing to watch), and `effectiveLevel()` maps `full` → `fast` there. One turn is
`intro?` → `fireAt` → shot (every shot of a salvo volley, `lastVolley`) → sink? → enemy aims → `enemyTurn` → shot(s) → sink?
→ `victory` when the game ended; `dispose()` lets a running victory flyover finish. While a ball is in the air the world
shows the board *before* that shot (`src/ui/world/pending.ts`: `visibleShots`, `maskPendingHit`, `settledWrecks`), so
markers, hull damage, the sunk reveal and flotsam appear at impact.
Game over dispatches `window` events `battleship:replay` and `battleship:photo` for the extras module; the report waits
for the victory flyover (`data-flyover="true"` while it plays).

## Final wiring (`src/App.tsx`)
`<Game>` mounts, once: `PerfBootstrap` + `FpsWatchdog` + `A11yBootstrap`; `<OceanScene weather cameraOverride={director.busy}>`
with `<GameWorld>` and, in battle / game over, `<CinematicLayer>` + `<CinematicCamera>`; `<GameUI>`, `<ExtrasLayer>`,
`<Letterbox hint={false}>` (click / Space / Esc skip; the HUD shows its own skip button), `QualityToast`, `?perf` overlay.
`useEffect` binds `bindCinematics()` (registers the shared director with the turn flow and skips it when the phase leaves
battle / game over) and `bindGameAudio({ director: directorPlaysAudio })` (music, ambience, placement cues; shot / sink /
victory SFX come from the director's beats while it plays, from the binding under `?no3d` or `cinematics: 'off'`).
Demo routes (`?…-demo`) are lazy chunks; the game bundle is split into `three`, `react`, `ships`, `scene`, `kit`,
`postprocessing` (loaded on `high` only) and the app.

## Test hooks the e2e suite depends on
`ui-root[data-phase]`, `ocean-canvas`, `ocean-fallback`, `main-menu`, `difficulty-{easy|medium|hard}`, `placement`,
`auto-place`, `confirm-placement`, `battle`, `enemy-grid`, `enemy-grid-{x}-{y}[data-state]`, `player-grid`, `status`
(contains "Your turn" when the human may fire), `gameover[data-winner]`, `play-again`, `rematch`, `quit`, `quit-confirm`,
`nav-settings`, `nav-how-to-play`. Also used: `ship-tray-{id}[data-placed][aria-pressed]`, `placed-count`, `rotate`,
`clear-placement`, `restart`, `skip-cinematic`, `fire-confirm(-yes|-no)`, `shot-log`, `fleet-status-{side}-{id}[data-sunk]`,
`stat-{shots|accuracy|turns|sunk|lost|streak|time}`, `rank`, `report-replay`, `report-photo`, `hint-{placement|battle}`, `loading`,
`setting-{sfx|music|mute|reduced-motion|colorblind}`, `setting-{cinematics|quality}-{option}`, `settings-close`,
`ui-root[data-colorblind][data-no3d]`. If you redesign the UI, keep these (or update `e2e/` in the same PR).
Playwright runs with `?no3d` for flow tests and with SwiftShader for the 3D smoke test; cinematics must honour
`settings.cinematics = 'off'` so flows stay fast and deterministic.

## Definition of done for every PR
1. `npm run lint && npm run typecheck && npm test && npm run build` pass.
2. `npm run e2e` passes.
3. You ran the game (or your `?…-demo` route) in a real browser and recorded yourself exercising your change;
   attach the recording and screenshots to the PR.
4. Any defect you noticed (yours or not) is logged in `bugs.md`.
