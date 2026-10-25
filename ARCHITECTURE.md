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
`<OceanScene quality? timeOfDay? view? interactive? dressing?>{children}</OceanScene>` full-screen Canvas with
WebGL fallback (`?no3d` forces the fallback). `<BoardGrid origin size cellSize highlight? onCellPointerMove? onCellClick? color?>`,
`<CameraRig view>` with `CameraView = 'menu' | 'placement' | 'battle' | 'gameover'`, `computeAtmosphere`,
`sampleWaveHeight/Normal`, layout helpers above, `<SceneDemo>` (`?scene-demo`). Perf knobs (set by `OceanScene` from
`usePerf()`): `<Lighting shadowSize?>` (0 = no shadow pass), `<Water waves?>`, `<Effects enabled?>` (lazy chunk).

### perf (`src/perf`)
`usePerf()` → `{ tier, dpr, shadows, particlesScale, postprocessing, lod, quality, waves }` resolved from GPU
detection (`WEBGL_debug_renderer_info`, dpr × screen, cores, 2 s startup FPS probe via `<PerfBootstrap>`) and the
persisted override `settings.quality: 'auto' | 'low' | 'medium' | 'high'` (`?quality=` wins). `medium` is the default
and the tuned target (MacBook Air M4 / Iris Xe at native res, dpr ≤ 1.5, 1k shadows, no post, lod ≥ 1); Apple GPUs
always start there; `high` (2k shadows, bloom/SMAA, lod 0, full particles) is manual or needs a discrete-class GPU
*and* a ≥ 90 fps probe. `<FpsWatchdog>` drops one tier once when battle FPS stays < 45 for 4 s (`auto` only) and
`<QualityToast>` shows the one-time notice; `window.__perf.autoLower()` triggers it for tests. `useDistanceLod(position,
hullLength)` / `<LodGroup>` pick a ship `lod` from camera distance with hysteresis + 1 s dwell; `<Fleet lod="auto">`
uses it. `useParticlesScale()` / `scaleCount(n, scale)` for VFX counts. `?perf` adds `<PerfStats>` (gl.info) +
`<PerfOverlay>`; `window.__perf.summary()` feeds `npm run perf`. `?perf-demo` = full-game load. Accessibility:
`<A11yBootstrap>` (prefers-reduced-motion → `reducedMotion` + `cinematics:'fast'`, `<html data-colorblind|
data-reduced-motion|data-quality>`, Space → `SKIP_CINEMATIC_EVENT`), `announce()`/`<Announcer>` live regions,
`a11y.css` (focus rings, HUD text halo, colour-blind marker shapes behind `settings.colorblind`, ≥ 44 px cells on touch).

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
`CINEMATIC_TIMING`. Wave 2 implements `createDirector()` + `<CinematicLayer />`.

### audio (`src/audio`)
`initAudio()`, `playSfx(name)`, `startMusic/stopMusic`, `startAmbience/stopAmbience`, `duckMusic(ms)`,
`setSfxVolume/setMusicVolume/setMuted`, `useAudioSettings`, `bindGameAudio()`, `<AudioSettings />`, `<AudioDemo />` (`?audio-demo`).
SFX names live in `manifest.ts`; the pirate set replaces the current placeholder sounds.

## Test hooks the e2e suite depends on
`ui-root[data-phase]`, `ocean-canvas`, `ocean-fallback`, `main-menu`, `difficulty-{easy|medium|hard}`, `placement`,
`auto-place`, `confirm-placement`, `battle`, `enemy-grid`, `enemy-grid-{x}-{y}[data-state]`, `player-grid`, `status`
(contains "Your turn" when the human may fire), `gameover[data-winner]`, `play-again`, `rematch`, `quit`, `quit-confirm`,
`nav-settings`, `nav-how-to-play`. If you redesign the UI, keep these (or update `e2e/` in the same PR).
Playwright runs with `?no3d` for flow tests and with SwiftShader for the 3D smoke test; cinematics must honour
`settings.cinematics = 'off'` so flows stay fast and deterministic.

## Definition of done for every PR
1. `npm run lint && npm run typecheck && npm test && npm run build` pass.
2. `npm run e2e` passes.
3. You ran the game (or your `?…-demo` route) in a real browser and recorded yourself exercising your change;
   attach the recording and screenshots to the PR.
4. Any defect you noticed (yours or not) is logged in `bugs.md`.
