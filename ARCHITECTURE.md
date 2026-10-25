# Architecture

The game is split into independent modules so several people (or Devin sessions) can work in parallel without merge conflicts. **Each module owns one folder. Change another module's folder only through its public API; if the API needs to change, say so in your PR description.**

```
src/
  engine/   pure game rules: board, fleet, placement, firing, win detection. No React, no DOM.
  ai/       Devin's opponents (easy / medium / hard). Implements AiOpponent. Pure TS, unit-tested.
  store/    zustand game state machine: menu -> placement -> battle -> gameover.
  scene/    3D ocean: react-three-fiber Canvas, water shader, sky, lighting, camera rig, grid plane.
  fx/       ship models, Devin-the-Otter mascot, hit/miss/sink VFX (particles, splashes, fire).
  ui/       HTML/React overlay: menus, mode select, placement UI, HUD, otter commentary, win/lose.
  audio/    Howler SFX + music, volume/mute, persisted settings.
e2e/        Playwright tests. They drive the game through data-testid attributes (see below).
public/assets/  static models, textures, sprites, sounds.
```

## Public APIs (keep these stable)

### engine (`src/engine`)
- `BOARD_SIZE`, `FLEET`, `FLEET_BY_ID`
- `createBoard`, `canPlace`, `placeShip`, `removeShip`, `randomPlacement`, `isFleetPlaced`
- `fire(board, coord) -> { board, result }`, `isFleetSunk`, `enemyView`, `viewGrid`
- helpers: `coordKey`, `coordLabel`, `inBounds`, `neighbors`, `allCoords`
- types: `Coord`, `Board`, `PlacedShip`, `ShipSpec`, `ShotResult`, `EnemyBoardView`, `Difficulty`, `Player`

### ai (`src/ai`)
```ts
interface AiOpponent {
  readonly difficulty: Difficulty
  nextShot(view: EnemyBoardView): Coord   // must never repeat a cell in view.shots
  observe(result: ShotResult): void
}
createOpponent(difficulty, rng?) => AiOpponent
```
Opponents take an injectable `rng` so tests are deterministic.

### store (`src/store/gameStore.ts`)
`useGameStore` with `phase`, `difficulty`, `playerBoard`, `otterBoard`, `turn`, `winner`, `events`, `settings` and actions `startGame`, `placePlayerShip`, `removePlayerShip`, `autoPlacePlayerFleet`, `confirmPlacement`, `fireAt`, `otterTurn`, `updateSettings`, `reset`. The UI controls pacing: after the human fires, the UI calls `otterTurn()` when its animations are done.

### scene (`src/scene`)
`<OceanScene>{children}</OceanScene>` renders the full-screen Canvas. Children are 3D objects (fleet, markers, mascot).

### fx (`src/fx`)
`<Fleet ships revealed />`, `<ShotMarkers shots offset? />`, `<OtterMascot mood />` where `mood: 'idle' | 'cheer' | 'grumble' | 'taunt' | 'victory' | 'defeat'`.

### audio (`src/audio`)
`playSfx(name)`, `startMusic()`, `stopMusic()`, `setSfxVolume(v)`, `setMusicVolume(v)`.

## Test hooks the e2e suite depends on
`ui-root[data-phase]`, `ocean-canvas`, `ocean-fallback` (shown with `?no3d` or when WebGL fails), `main-menu`, `difficulty-{easy|medium|hard}`, `placement`, `auto-place`, `confirm-placement`, `battle`, `enemy-grid`, `enemy-grid-{x}-{y}[data-state]`, `player-grid`, `status`, `gameover[data-winner]`, `play-again`. If you redesign the UI, keep these attributes (or update `e2e/` in the same PR).

## Definition of done for every PR
1. `npm run lint && npm run typecheck && npm test && npm run build` pass.
2. `npm run e2e` passes.
3. You ran the game in a real browser and recorded yourself exercising your change; attach the recording/screenshots to the PR.
4. Any defect you noticed (yours or not) is logged in `bugs.md`.
