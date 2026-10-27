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
- `BOARD_SIZE`, `FLEET`, `FLEET_BY_ID` — the classic fleet is `man-o-war`(5) `galleon`(4) `frigate`(3) `brigantine`(3) `sloop`(2)
- Black Flag fleets: `FLEET_PRESETS` (`classic` / `armada` / `wolf-pack` / `raiders`, all 17 cells), `presetFleet(id)`, `fleetCells(fleet)`,
  `fleetUnits(fleet) -> { spec, uid }[]`. A `PlacedShip.uid` is the ship **instance** key (`'sloop'`, `'sloop#2'`, …; equals
  `spec.id` in a classic fleet) — placement, FleetStatus, sink progress, flotsam and damage are keyed by `uid`, geometry by `spec.id`
  (`uidClass(uid)`). `ShotResult.shipUid` carries it (`shotShipKey(result)` falls back to `shipId`).
- `createBoard`, `canPlace(board, spec, origin, orientation, uid?)`, `placeShip(…, uid?)`, `removeShip(board, uid)`,
  `randomPlacement(rng?, fleet?)`, `isFleetPlaced(board, fleet?)`
- `fire(board, coord) -> { board, result }` (pure, no randomness), `isFleetSunk`, `isSunk`, `enemyView`, `viewGrid`
- Black Flag helpers (pure): `broadsideCells(center, orientation)` (3-cell line clipped to the board), `treasureCells(board, rng, 2)`
  (open water, never touching), `hasTreasureAt`, `touching`
- helpers: `coordKey`, `coordLabel`, `inBounds`, `neighbors`, `allCoords`
- types: `Coord`, `Board`, `PlacedShip`, `ShipSpec`, `ShipId`, `ShotResult`, `EnemyBoardView`, `Difficulty`, `Player = 'human' | 'enemy'`

### ai (`src/ai`)
```ts
interface AiOpponent { readonly difficulty: Difficulty; nextShot(view: EnemyBoardView): Coord; observe(result: ShotResult): void
  // Black Flag (optional; Easy implements none): Spyglass pick / observation and the Broadside line to fire
  spyTarget?(view): Coord | null; observeSpy?(coord, ship: boolean): void; broadsideTarget?(view): { center: Coord; orientation: Orientation } | null }
createOpponent(difficulty, rng?) => AiOpponent;  describeStrategy(difficulty);  seededRng(seed);  playGame(opponent, board)
```

### store (`src/store/gameStore.ts`)
`useGameStore` with `phase`, `difficulty`, `playerBoard`, `enemyBoard`, `turn`, `winner`, `events`, `settings`
(`sfxVolume`, `musicVolume`, `reducedMotion`, `cinematics: 'full' | 'fast' | 'off'`) and actions `startGame`,
`placePlayerShip(spec, origin, orientation, uid?)`, `removePlayerShip(uid)`, `autoPlacePlayerFleet`, `confirmPlacement`, `fireAt(coord, by?)`,
`enemyTurn`, `updateSettings`, `reset`. The game loop controls pacing: after the human fires, it awaits the cinematic
(or a timer when cinematics are off) and then calls `enemyTurn()` — unless `turn` is still `'human'` (treasure).

Rules of engagement live in `modes: GameModes = { salvo, storm, blackFlag }` (all off = Classic, any combination). Black Flag adds
`fleets` / `fleetPresets` per `Player` (`setFleetPreset(id)` in placement; the AI draws a random preset in `startGame`),
`powerShots: Record<Player, { broadside: boolean; spyglass: boolean }>` (one use each per game), `treasure: Record<Player, Coord[]>`
(two chests per board, rolled from the seeded `rng` in `confirmPlacement`), `spied: Record<Player, SpyMark[]>` and `bonusShots`.
Actions: `fireBroadside(center, orientation) -> ShotResult[]` (skips shot/off-board cells, whole turn, replaces the Salvo volley,
each ball fogs separately in the storm), `spyAt(coord) -> 'ship' | 'water'` (no shot, no turn). `GameEvent` is
`{ id, by, result, kind: 'shot' | 'broadside' | 'spyglass' | 'treasure', group?, spied? }`; a treasure hit keeps the turn
(`bonusShots`; in Salvo it is +1 shot in the volley). Replay / stats skip `spyglass` events (they are not shots).
**Two captains (hot-seat).** `Player = 'human' | 'enemy'` stays the engine's vocabulary; `players: { human: {name, kind:'local'},
enemy: {name, kind:'local'|'ai'} }` (`setPlayers`, menu only; `isHotSeat(players)`) says who sits on each side. In a hot-seat
game `startGame` leaves `enemyBoard` empty and creates no `opponent`; `placing` is the captain mustering (the placement actions
target `placementBoard(state)`), `confirmPlacement` raises the curtain for the other captain instead of starting the battle until
both fleets are placed, `fireAt(coord, by)` resolves for either side (`by` defaults to `'human'`; the turn flow passes `turn`),
`enemyTurn()` is a no-op, `firstPlacer` places *and fires* first and `rematch()` swaps it. `handoff: Player | null` is the
curtain (`beginHandoff(to)` / `endHandoff()` — the only way down; both `fireAt` and the controllers refuse input while it is set)
and `perspective: Player` is the side the HUD / 3D world / director film from (`endHandoff` sets it to `turn`; always `human`
in single player). Black Flag in a hot-seat game: `setFleetPreset` targets the `placing` captain (no preset is drawn for a local
`enemy`), `fireBroadside(center, orientation, by?)` / `spyAt(coord, by?)` / `resolveHuman(volley, kind, group?, by?)` take the shooter the
same way `fireAt` does, `powerShots` / `treasure` / `spied` are already per `Player`; a treasure hit keeps the deck (no curtain).

### scene (`src/scene`)
`<OceanScene quality? timeOfDay? view? interactive? cameraOverride? dressing? weather?>{children}</OceanScene>` full-screen Canvas with
WebGL fallback (`?no3d` forces the fallback). `<BoardGrid origin size cellSize highlight? onCellPointerMove? onCellClick? color?>`,
`<CameraRig view interactive? override?>` with `CameraView = 'menu' | 'placement' | 'battle' | 'battle-far' | 'gameover' | 'handoff'`
(`battle-far` = the battle shot mirrored to the Navy side for the second hot-seat captain — `SceneContents` picks it from the store's
`perspective`; `handoff` = open sea and sky only while the curtain is up; `override` = a cinematic owns the
camera: the rig stops writing position/target/fov and disables orbit, then damps back when it flips off), `computeAtmosphere`,
`sampleWaveHeight/Normal`, layout helpers above, `<SceneDemo>` (`?scene-demo`). Perf knobs (set by `OceanScene` from
`usePerf()`): `<Lighting shadowSize?>` (0 = no shadow pass), `<Water waves?>`, `<Effects enabled?>` (lazy chunk).

**Sky & sea (looks only).** `Weather = 'calm' | 'overcast' | 'squall' | 'stormy'` and `TIME_PRESETS` (`dawn 0.27`, `noon 0.5`,
`golden` = `GOLDEN_HOUR`, `dusk 0.77`, `night 0.98`; `parseTimeOfDay` / `parseWeather` read `?tod=` / `?weather=` by name or
number). `computeAtmosphere(t, weather)` returns separate `storm` (overcast look), `rain`, `swell` (→ `setSeaState`) and
`lightning` (stormy only) scalars plus one **key light**: the sun by day, the moon (`moon = 1`, cool `keyColor`, lower
`keyIntensity`) once the sun is under the horizon — there is no second moon light. `fillIntensity` / `hemiIntensity` /
`ambientIntensity` have night floors so hulls never read as silhouettes; `lanternGlow` (1 by day, 2.4 at night) is pushed to
the ship kit through `setLanternGlow` and multiplied into the lantern flame emissive. Every preset switch is a uniform /
light-parameter change on the same materials — the program count is flat across all 15 time × weather combos
(`npm run perf:sky`). Cove lamps are emissive only: no light may mount or unmount with the time of day (BUG-580).

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
director.skip(); director.busy; director.setFleets(() => ({ human, enemy }) | null); director.setPerspective('human' | 'enemy')
createDirector({ fleets?, reducedMotion?, autoTick?, audio? })   // isolated instance (tests, demos)
useDirector((s) => s.busy | s.firing | s.sinkProgress | s.impacted | s.letterbox | s.timeScale)
<CinematicLayer />      // inside <OceanScene>: cannonballs, flashes, splashes, hull impacts, sink water fx, fireworks/wrecks
<CinematicCamera />     // inside <OceanScene>; pair with <OceanScene cameraOverride={busy}>
<Letterbox />           // HTML: cinema bars + click / Space / Esc skip
const cine = useBattleCinematics()   // plays a sequence for every new store event; cine.busy, await cine.idle(), cine.visibleShots(shots)
pickBattery(ships, target, ownOrigin, targetOrigin), planShot(by, result, shooters, targets), buildSequence(event, level, reducedMotion)
```
Pass `firing={useDirector((s) => s.firing)}` and `sinkProgress={useDirector((s) => s.sinkProgress)}` to both `<Fleet>`s.
`perspective` (set by `App` from the store) is the side the overview / return shots and the victory orbit + fireworks film from;
a hot-seat captain's shot is filmed like the pirates' (real muzzles), only the AI fires from the unseen gun line (`plan.shooter === null`).
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
(Stormy seas: `fireAt` / `enemyTurn` roll `STORM_LOST_CHANCE` per shot with the seeded `stormRng`; a `lost` `ShotResult` is an
event only — `fire()` is not called, the square stays unknown and re-fireable, markers/AI/replay ignore it)
→ `victory` when the game ended; `dispose()` lets a running victory flyover finish. Hot-seat (`isHotSeat(players)`): the active
captain's `fireAt(coord, turn)` → shot(s) → sink? → `beginHandoff(other)` (beat `handoff`) — no aim delay, no AI turn; the
`<HandoffCurtain>` (`src/ui/HandoffCurtain.tsx`, mounted by `<GameUI>` whenever `handoff` is set, HTML so `?no3d` works) is the
only thing on screen: `<PlacementScreen>` unmounts, `<BattleScreen>` renders an empty `aria-hidden` root (the turn flow survives)
and `<GameWorld>` draws nothing, so no `[data-state]` cell or ship mesh exists until the next captain taps the button.
`<BattleScreen>` / `<BattleWorld>` render the `perspective` side as "own" (ships revealed, `player-grid`) and the other as the
target (`enemy-grid`, un-sunk ships hidden) — the test ids never change sides. `<MainMenu>` is three steps (`data-step`
`mode` → `rules` → `foe` | `names`): `mode-single` / `mode-two`, the Rules of engagement dock (`menuExtras.rules`, from the extras
module), `rules-next`, `menu-back`, the posters, `captain-1-name` / `captain-2-name` / `names-start`; `menuExtras.stats` sits under
step 1 and `menuExtras.corner` is a slot for small corner controls. While a ball is in the air the world
shows the board *before* that shot (`src/ui/world/pending.ts`: `visibleShots`, `maskPendingHit`, `settledWrecks`), so
markers, hull damage, the sunk reveal and flotsam appear at impact.
Game over dispatches `window` events `battleship:replay` and `battleship:photo` for the extras module; the report waits
for the victory flyover (`data-flyover="true"` while it plays).

## Final wiring (`src/App.tsx`)
`<Game>` mounts, once: `PerfBootstrap` + `FpsWatchdog` + `A11yBootstrap`; `<OceanScene weather timeOfDay cameraOverride={director.busy}>`
(`weather` / `timeOfDay` from `useGameWeather()` / `useGameTimeOfDay()`: the Sky & sea pick in `settings.timeOfDay` /
`settings.weather`, with the Stormy-seas rule forcing `'stormy'` via `selectSkyWeather`; `ui-root` mirrors them as `data-tod` /
`data-weather`)
with `<GameWorld>` and, in battle / game over, `<CinematicLayer>` + `<CinematicCamera>`; `<GameUI>`, `<ExtrasLayer>`,
`<Letterbox hint={false}>` (click / Space / Esc skip; the HUD shows its own skip button), `QualityToast`, `?perf` overlay.
`useEffect` binds `bindCinematics()` (registers the shared director with the turn flow and skips it when the phase leaves
battle / game over) and `bindGameAudio({ director: directorPlaysAudio })` (music, ambience, placement cues; shot / sink /
victory SFX come from the director's beats while it plays, from the binding under `?no3d` or `cinematics: 'off'`).
Demo routes (`?…-demo`) are lazy chunks; the game bundle is split into `three`, `react`, `ships`, `scene`, `kit`,
`postprocessing` (loaded on `high` only) and the app.

## Test hooks the e2e suite depends on
`ui-root[data-phase]`, `ocean-canvas`, `ocean-fallback`, `main-menu[data-step]`, `mode-{single|two}`, `rules-next`, `menu-back`,
`difficulty-{easy|medium|hard}` (menu step 3 — e2e reaches it through `startSinglePlayer()` in `e2e/helpers.ts`), `captain-{1|2}-name`,
`names-start`, `handoff[data-captain]`, `handoff-name`, `handoff-ready`, `placement[data-placing]`, `placement-title`,
`battle[data-perspective]`, `your-waters-title`, `enemy-waters-title`, `report-title`, `placement`,
`auto-place`, `confirm-placement`, `battle`, `enemy-grid`, `enemy-grid-{x}-{y}[data-state]`, `player-grid`, `status`
(contains "Your turn" when the human may fire), `gameover[data-winner]`, `play-again`, `rematch`, `quit`, `quit-confirm`,
`nav-settings`, `nav-how-to-play`. Also used: `ship-tray-{uid}[data-placed][aria-pressed]`, `placed-count`, `rotate`,
`clear-placement`, `restart`, `skip-cinematic`, `fire-confirm(-yes|-no)`, `shot-log`, `fleet-status-{side}-{uid}[data-sunk]`,
`stat-{shots|accuracy|turns|sunk|lost|streak|time}`, `rank`, `report-replay`, `report-photo`, `hint-{placement|battle}`, `loading`,
Black Flag: `mode-black-flag`, `fleet-picker`, `fleet-preset-{classic|armada|wolf-pack|raiders}[aria-checked]`,
`power-shots[data-armed]`, `power-broadside[data-used]`, `power-spyglass[data-used]`, `power-rotate`, `treasure-count`,
`stat-black-flag`, `howto-black-flag`; chart cells carry `cell-spied(-ship|-water)` / `cell-treasure` classes,
`setting-{sfx|music|mute|reduced-motion|colorblind}`, `setting-{cinematics|quality}-{option}`, `settings-close`,
`ui-root[data-colorblind][data-no3d][data-tod][data-weather]`, Sky & sea picker `skysea-picker`, `skysea-time`, `skysea-weather`
(menu corner and Settings). If you redesign the UI, keep these (or update `e2e/` in the same PR).
Playwright runs with `?no3d` for flow tests and with SwiftShader for the 3D smoke test; cinematics must honour
`settings.cinematics = 'off'` so flows stay fast and deterministic.

## Definition of done for every PR
1. `npm run lint && npm run typecheck && npm test && npm run build` pass.
2. `npm run e2e` passes.
3. You ran the game (or your `?…-demo` route) in a real browser and recorded yourself exercising your change;
   attach the recording and screenshots to the PR.
4. Any defect you noticed (yours or not) is logged in `bugs.md`.
