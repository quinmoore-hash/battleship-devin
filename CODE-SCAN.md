# Code scan — 2026-11-03

Repo-wide scan of `quinmoore-hash/battleship-devin` at main `6e0ff36`, run as seven parallel scan sessions with disjoint scopes, merged into one branch. Only behaviour-preserving fixes were applied. Everything else is logged as an `open` row in `bugs.md` (BUG-800–892) and listed below.

**Totals:** 93 findings, 33 fixed, 60 deferred. No P0/P1. P2: 5 (2 fixed). No finding duplicated an existing `bugs.md` row; related rows are cross-referenced in the notes column.

## Sessions

| Session | Scope | Mode | Fixed | Deferred |
|---|---|---|---|---|
| A | `src/engine`, `src/ai`|read-only | 0 | 18 |
| B | `src/store`, `src/ui`, `src/App.tsx`, `main.tsx`, `index.css`|safe fixes | 4 | 8 |
| C1 | `src/ships`|safe fixes | 7 | 5 |
| C2 | `src/deck`, `src/scene`|safe fixes | 9 | 7 |
| D1 | `src/vfx`|safe fixes | 4 | 4 |
| D2 | `src/cinematics`, `src/audio`, `src/crew`, `src/extras`|safe fixes | 2 | 8 |
| E | `src/perf`, config, tooling, repo root|safe fixes | 7 | 10 |

C and D from the suggested split were each divided in two (C1/C2, D1/D2) because `src/ships` alone is ~18k lines.

## Gates

The request named `npm run test:e2e`; this repo has no such script. Playwright is `npm run e2e` (`playwright test`), run here as `env -u DISPLAY npx playwright test`. No alias was added (BUG-886).

| Gate | Baseline (`6e0ff36`) | Final (this branch) |
|---|---|---|
| `npm run lint` (oxlint) | exit 0 · 0 errors · 198 warnings | exit 0 · 0 errors · 187 warnings (11 removed, 0 new) |
| `npm run typecheck` | exit 0 | exit 0 |
| `npm test` (vitest) | 60 files · 653/653 pass | 60 files · 653/653 pass |
| `npm run build` | exit 0 | exit 0 |
| `npm run e2e` (Playwright) | 52/52 pass (11.5 min) | 52/52 pass (11.5 min) on rerun; first run 33 passed / 1 failed / 18 not run (known BUG-309 flake, see below) |

**e2e flake (pre-existing, BUG-309):** the first final run failed `extras.spec.ts › salvo + stormy seas game` at line 75 because the Easy AI won (stats showed `0 won`, the spec expects `1 / 1`). The game seed is `Math.random()` per game and this branch does not touch `src/store`, `src/engine` or `src/ai`. Running that spec alone with `--repeat-each` failed 2 of 36 times on `main` `6e0ff36` (batches of 6, 10 and 20). On this branch it failed 3 of 16 times (two full-suite runs plus batches of 4 and 10). With the same failure text on both sides, this is the known flake, not a regression. The full suite then passed 52/52.

Each scan session also ran lint, typecheck and vitest after every fix batch on its own branch. No batch regressed, so nothing was reverted.

Observation: during scan B one `npm test` run stalled with a worker at 100% CPU for ~9 min; two reruns on the same commit passed in ~4 s, and every orchestrator run passed. The stalled file was not identified. It is noted here, not logged as a bug.

## Findings by category

| Category | Fixed | Deferred | IDs |
|---|---|---|---|
| Resource leaks / disposal | 8 | 4 | BUG-832, BUG-840, BUG-843, BUG-846, BUG-847, BUG-848, BUG-849, BUG-856, BUG-858, BUG-859, BUG-862, BUG-870 |
| Timers / listeners / effect cleanup | 3 | 4 | BUG-819, BUG-825, BUG-829, BUG-860, BUG-867, BUG-874, BUG-869 |
| Hook dependency arrays | 2 | 2 | BUG-822, BUG-827, BUG-831, BUG-836 |
| Dead code / unused exports / unused deps | 15 | 11 | BUG-809, BUG-812, BUG-806, BUG-820, BUG-821, BUG-828, BUG-826, BUG-835, BUG-834, BUG-830, BUG-833, BUG-838, BUG-854, BUG-861, BUG-866, BUG-875, BUG-879, BUG-880, BUG-876, BUG-877, BUG-878, BUG-882, BUG-881, BUG-888, BUG-890, BUG-891 |
| Lint-only sites | 4 | 6 | BUG-818, BUG-824, BUG-841, BUG-837, BUG-850, BUG-845, BUG-842, BUG-851, BUG-857, BUG-873 |
| Per-frame allocation / render churn | 1 | 10 | BUG-839, BUG-844, BUG-853, BUG-852, BUG-855, BUG-863, BUG-865, BUG-864, BUG-871, BUG-872, BUG-889 |
| Game logic / AI edge cases | 0 | 6 | BUG-802, BUG-808, BUG-803, BUG-817, BUG-823, BUG-868 |
| Types / duplication | 0 | 7 | BUG-805, BUG-804, BUG-810, BUG-814, BUG-815, BUG-811, BUG-816 |
| Tests / docs / tooling / CI | 0 | 10 | BUG-801, BUG-813, BUG-807, BUG-800, BUG-885, BUG-886, BUG-887, BUG-892, BUG-884, BUG-883 |

## Fixes applied, by file

Every fix is a removal of dead code, a `dispose()` for a resource created in the same component/effect, a missing timer/effect cleanup, or a dependency-array correction where the old array was provably wrong.

| File | ID | Sev | Fix |
|---|---|---|---|
| `package.json` | BUG-876 | P3 | gsap dependency never imported |
| `package.json` | BUG-877 | P3 | gh-pages devDependency unused (deploy uses actions/deploy-pages) |
| `package.json` | BUG-878 | P3 | @testing-library/user-event devDependency never imported |
| `scripts/audio/ambience.mjs` | BUG-879 | P3 | distantBell(r) unused parameter |
| `scripts/audio/music.mjs` | BUG-880 | P3 | Unused Am chord constant |
| `src/crew/CrewLayer.tsx` | BUG-866 | P3 | stepAside `crew` param (void crew) and moveToward `_unused` param are dead |
| `src/deck/DeckController.tsx` | BUG-842 | P3 | keys.current read in effect cleanups (203, 451); capture once at effect start |
| `src/extras/photo.tsx` | BUG-867 | P3 | PhotoMode capture-flash setTimeout not cleared on unmount |
| `src/perf/tier.ts` | BUG-881 | P3 | Internal-only exports readRendererString, PROBE_DURATION_MS, LOWERED_NOTICE, PROBE_FPS, WIDE_RETINA_PX |
| `src/scene/BoardGrid.tsx` | BUG-843 | P3 | ropeMat/floatMat/plateMat (prop-passed useMemo materials) never disposed; plateMat recreated on every highlightColor change |
| `src/scene/BoardGrid.tsx` | BUG-844 | P3 | Layout effect depended on per-render center array, rewriting ~220 instance matrices every render; deps now originY + ropeMat/floatMat |
| `src/scene/SceneDemo.tsx` | BUG-845 | P3 | Unused param _ : LightningStrike (+ now-unused type import) removed; demo route |
| `src/scene/Water.tsx` | BUG-846 | P3 | farGeo far-ring geometry passed via geometry prop never disposed |
| `src/scene/Weather.tsx` | BUG-847 | P3 | Rain ShaderMaterial never disposed |
| `src/scene/Weather.tsx` | BUG-848 | P3 | Gulls body/tip materials never disposed |
| `src/scene/Weather.tsx` | BUG-849 | P3 | Dolphins skin/belly materials and CapsuleGeometry never disposed (remount on quality change) |
| `src/scene/textures.ts` | BUG-850 | P3 | oxc(erasing-op) 232 - 20 * 0 -> 232 (pure no-op, identical pixels) |
| `src/ships/frigate/hull.ts` | BUG-830 | P3 | Dead export hullTriangleCount() (+ now-unused triangleCount import) |
| `src/ships/frigate/rig.tsx` | BUG-831 | P3 | RopeBundle useLayoutEffect reads lod but deps were [segments] |
| `src/ships/kit/props.tsx` | BUG-832 | P3 | Netting LineBasicMaterial created in useMemo, passed via material prop, never disposed |
| `src/ships/man-o-war/geometry.ts` | BUG-833 | P3 | Dead type export Tri |
| `src/ships/man-o-war/spec.ts` | BUG-834 | P3 | Dead export gunsInCell() |
| `src/ships/placeholder.tsx` | BUG-835 | P3 | placeholder.tsx unreferenced (confirms BUG-100) |
| `src/ships/sloop/index.tsx` | BUG-836 | P3 | sheets useMemo missing deps jibClew/stayClew (render-scope constant literals) |
| `src/ui/Modal.tsx` | BUG-818 | P3 | no-unused-expressions comma expressions in focus trap |
| `src/ui/battleController.ts` | BUG-819 | P3 | Module-level swingTimer not cleared on stop() |
| `src/ui/index.tsx` | BUG-820 | P3 | Empty useEffect + winner selector only used by it |
| `src/ui/turnFlow.ts` | BUG-821 | P3 | Unused export onDirectorChange / directorListeners |
| `src/vfx/VfxDamageDemo.tsx` | BUG-860 | P3 | setTimeout hit commit without unmount cleanup (demo route only) |
| `src/vfx/damage/ImpactFlash.tsx` | BUG-858 | P2 | attachParams geometry clone never disposed (one BufferGeometry leaked per hit flash) |
| `src/vfx/damage/SplinterBurst.tsx` | BUG-859 | P2 | Dust mesh attachParams clone never disposed (one geometry leaked per splinter burst) |
| `src/vfx/math.ts` | BUG-861 | P3 | Unused export easeOutBack |
| `vite.config.ts` | BUG-882 | P3 | gsap codeSplitting group matched nothing |

Notes on the fixes that change runtime work (all checked against the gates):

- **Disposal** (BUG-832, BUG-843, BUG-846, BUG-847, BUG-848, BUG-849, BUG-858, BUG-859): unmount cleanup only. Shared/module-level caches are untouched. The VFX geometry clones are disposed in `useLayoutEffect` cleanup before refs detach, matching the existing `Fire.tsx` pattern.
- **`BoardGrid.tsx` layout deps** (BUG-844): the effect used to rerun every render because `center` was a fresh array, rewriting about 220 instance matrices each time. It now reruns only when its inputs change. The matrices are the same.
- **`frigate/rig.tsx` RopeBundle** (BUG-831): `lod` was read but missing from the deps, so a rope bundle that changed LOD while mounted kept the previous radius. This corrects stale geometry. Normal play is unchanged.
- **`battleController.stop()`** (BUG-819): clears the pending on-deck gun-swing timer. After `stop()`, `fire()` already returns early (`flow` is null). The only difference is inside the ~sub-second swing window when a new flow starts straight after a stop.
- **Unused deps** (BUG-876, BUG-877, BUG-878): removed from `package.json`/lockfile after a full-repo grep. The `dist` chunk list and sizes are unchanged.
- **Audio scripts** (BUG-879, BUG-880): generated PCM hashes are identical before and after.

## Deferred items

Deferred because fixing them touches gameplay rules, AI decisions, store selector semantics, cinematic timing, visuals, or shared resources, or needs an owner decision. All are `open` in `bugs.md`.

| ID | Sev | File:line | Finding | Why deferred |
|---|---|---|---|---|
| BUG-822 | P2 | `src/ui/Battle.tsx:181` | treasureCells/enemyChests/spiedByMe memos omit perspective/foeSide; stale previous-captain chest/spyglass marks after hot-seat handoff | Dep-array change alters recompute timing (rule 3); fix = add perspective/foeSide. |
| BUG-823 | P2 | `src/ui/world/GameWorld.tsx:129` | 3D placement drop ignores ship uid: drag uses FLEET_BY_ID[uid] (undefined for 'sloop#2'), click/drag drops call placePlayerShip without uid (lines 112,137) | Gameplay behavior change; fix = pass uid and use uidClass. |
| BUG-868 | P2 | `src/crew/CrewLayer.tsx:413` | Crew not repainted/reset when livery/boardOrigin props change (hot-seat perspective swap) — hypothesis | Fix alters visuals/crew state; needs hot-seat runtime repro first. |
| BUG-800 | P3 | `src/ai/benchmark.ts:4` | Benchmark CLI relies on npx tsx (not a devDependency) and has no npm script/README entry | Add a bench:ai script or a README note; no runtime effect. |
| BUG-801 | P3 | `src/ai/hard.test.ts:1` | AI power-shot unit tests missing (spyTarget ratio/tie, broadsideTarget axis, Medium.broadsideTarget, broadsideThroughHit, applySpied), no Black Flag preset benchmarks, no golden shot-sequence test | Read-only (no test commits). A golden snapshot test should land before any src/ai refactor. |
| BUG-802 | P3 | `src/ai/hard.ts:112` | HardOpponent.nextShot infinite loop when remainingShips is empty (Math.min() = Infinity parity modulus) | Read-only session. Safe fix: parityCells returns k.unshot (or nextShot throws) when remaining is empty; gates prove it (identical path for all reachable states + new unit test). |
| BUG-803 | P3 | `src/ai/hard.ts:45` | Hard Broadside can centre on a spied, unshot ship before any confirmed hit; contradicts HowToPlay.tsx:41 and ai/types.ts:25 docs | AI decision logic: owner decides between a doc fix (safe) and a logic change (gates cannot prove it, since there is no golden test). |
| BUG-804 | P3 | `src/ai/hard.ts:100` | Open-cell predicate and axis-neighbour pairs duplicated between Hard.broadsideTarget and broadsideThroughHit (knowledge.ts:75-80) | Read-only. Shared helper; pure. Add a broadsideTarget unit test first (none exists). |
| BUG-805 | P3 | `src/ai/knowledge.ts:28` | Sunk-shot classification duplicated between readView and engine viewGrid (board.ts:170-174) | Read-only. Extract an engine helper; pure, no rng, covered by board.test viewGrid + ai tests. |
| BUG-806 | P3 | `src/ai/knowledge.ts:31` | 'lost' skip in readView (and board.ts:172 viewGrid) unreachable via enemyView() | Recommend keeping it as a cheap defensive guard; removal would also be behaviour-preserving. |
| BUG-807 | P3 | `src/ai/knowledge.ts:6` | Otter-era ship names in comments (Clam Cruiser; hard.test.ts:23,72 Pebble Patrol/Patrol/Sub; medium.test.ts:51) and an outdated Player doc (engine/types.ts:65) | Comment-only fix; gates trivially prove it. |
| BUG-808 | P3 | `src/ai/medium.ts:57` | Medium queues off-board targets on boards that are not 10x10: observe() calls neighbors() without view.size and nextShot filters only by taken (line 42) | Read-only (AI logic). Safe fix: add inBounds(t, knowledge.size) to the medium.ts:42 filter; no rng-draw change, gates prove it at size 10. |
| BUG-809 | P3 | `src/ai/medium.ts:30` | Medium Spyglass plumbing (spied, observeSpy, applySpied calls at 39/77) unreachable | Read-only. Removal is behaviour-preserving (applySpied with [] is a no-op, no rng); typecheck + gameStore.blackFlag AI power shots test prove it. |
| BUG-810 | P3 | `src/ai/medium.ts:55` | Two neighbour shuffle-and-push loops in Medium (observe vs buildTargets), only one checks size/taken/dupes | Read-only. Merging changes rng draw order unless done carefully; the determinism test compares only run-to-run, so gates cannot prove preservation without a golden test. |
| BUG-811 | P3 | `src/ai/rng.ts:17` | pick<T> typed to return T but returns undefined for an empty array | Read-only. Throw on empty input; gates prove it (no caller passes an empty array). |
| BUG-812 | P3 | `src/ai/types.ts:30` | Unused exports: AiFactory (types.ts:30, index.ts:7), SimulationResult re-export (index.ts:9), FLEET_PRESET_BY_ID (engine/fleet.ts:78, used only in-file), SPYGLASS_RATIO (hard.ts:19, used only in-file) | Read-only. Delete or un-export; typecheck proves it, no runtime effect. |
| BUG-813 | P3 | `src/engine/board.test.ts:1` | Engine gaps: viewGrid with repeated classes, treasureCells saturation, isFleetSunk(empty)=false, removeShip by class with repeats | Read-only. Add tests in a later fix session. |
| BUG-814 | P3 | `src/engine/fleet.ts:37` | FLEET_BY_ID typed Record<string, ShipSpec> and uidClass uses an unchecked `as ShipId` (line 58) | Read-only. Type as Record<ShipId, ShipSpec> + isShipId guard; typecheck surfaces call sites (some in ui, out of scope). |
| BUG-815 | P3 | `src/engine/fleet.ts:78` | FLEET_PRESET_BY_ID built with an unchecked cast over Object.fromEntries | Read-only. Use satisfies Record<FleetPresetId, FleetPreset>; blackFlag.test pins order/cell totals. |
| BUG-816 | P3 | `src/engine/types.ts:39` | ShotResult is not discriminated: hit/sunk without shipId type-checks | Read-only. Type-only union change; typecheck proves it. |
| BUG-817 | P3 | `src/store/gameStore.ts:430` | One seeded RNG stream feeds AI, both sides' storm rolls, treasure, enemy preset/placement and auto-place | Out of scope (store) and changes every seeded sequence; owner decision. Suggest derived sub-streams. |
| BUG-824 | P3 | `src/App.tsx:82` | static-components on DEMOS[demo] (module-level lazy map; likely false positive) | Stable identity; restructuring not a provable no-op worth churn. |
| BUG-825 | P3 | `src/App.tsx:1` | dismissBootSplash useLayoutEffect timer/listener without effect cleanup (one-shot boot) | No observable bug. |
| BUG-826 | P3 | `src/store/gameStore.ts:1` | Exports used only in-file (isSkyWeather, prefersReducedMotion, DEFAULT_PLAYERS, SHIP_HUES, logLines, LOADING_TIPS, LOADING_MIN_MS, UI_PREFS_STORAGE_KEY, sinkFor, types) | Not dead code; dropping export is noise. |
| BUG-827 | P3 | `src/ui/Battle.tsx:178` | report memo has intentional extra tick dep (eslint-disable) | Intentional clock refresh; no change. |
| BUG-828 | P3 | `src/ui/ui.css:1932` | Possibly unused .placement-body / .side-right (no TSX/e2e reference) | CSS removals deferred per instructions. |
| BUG-829 | P3 | `src/ui/world/GameWorld.tsx:1` | Module-level pointerdown listener never removed (intentional singleton) | Intentional. |
| BUG-837 | P3 | `src/ships/ShipDemo.tsx:20` | preserve-manual-memoization warning | demo-only route; not a leak/perf issue |
| BUG-838 | P3 | `src/ships/bake.tsx:94` | Unused diagnostic hooks heldBakeCount/bakeCacheSize/bakeReport (bake.tsx:94,104,105) and bakedTextureCount (kit/textures.ts:616) | labelled test/perf hooks for leak attribution; removal safe but low value; owner decision |
| BUG-839 | P3 | `src/ships/frigate/rig.tsx:1` | Instancing/shared-material opportunities: per-ship cloned cloth materials (makeClothMaterial) and per-ship ensign/pennant plane geometries across frigate/brigantine/galleon/sloop | shared-material/instancing/geometry-merge refactors prohibited in scan; relates to BUG-502/762 |
| BUG-840 | P3 | `src/ships/kit/DeckDressing.tsx:1` | Module-level caches (seam texture/material, layouts, post/pin geometry, per-class materials/textures) never disposed | bounded, shared across mounts by design; disposal requires cache-lifecycle refactor (BUG-501 context) |
| BUG-841 | P3 | `src/ships/kit/props.tsx:179` | react(immutability) on flame material mutated in useFrame (also :128) | standard r3f per-frame mutation; lint false positive; changing would alter flicker |
| BUG-851 | P3 | `src/deck/DeckController.tsx:152` | Refs written during render (activeRef/geomRef) | Moving to layout effect changes deck loop timing; deck movement/lease is off-limits. |
| BUG-852 | P3 | `src/deck/DeckController.tsx:1` | Small per-frame array/object allocations in walk/gunner pose path | Collision/movement logic off-limits; three.js temporaries already pooled. |
| BUG-853 | P3 | `src/deck/audio/DeckAudio.tsx:160` | Per-frame allocations in useFrame (shipPos array, lastCam object at :181, shipWorldTransform) | In-place mutation could change semantics (array held by reference for wind positioning). |
| BUG-854 | P3 | `src/deck/math.ts:1` | ~50 symbols exported but only used in their own file (math.ts, cove.ts, waves.ts, Islands.tsx, deck/audio/*) | Churn on documented module API with no runtime effect; left to orchestrator. |
| BUG-855 | P3 | `src/scene/BoardGrid.tsx:281` | brass.clone().multiplyScalar(2.4) allocates a Color per render | Render-time nit only, not per frame. |
| BUG-856 | P3 | `src/scene/Islands.tsx:1` | Memoized materials inside BakedGroup not disposed | Handed to baker (src/ships/bake.tsx); baked output may share them -> shared pool per rule 7. |
| BUG-857 | P3 | `src/scene/Weather.tsx:33` | cb.current = onLightning during render | Same pattern as DeckController refs; behavior-preserving change not clearly safe. |
| BUG-862 | P3 | `src/vfx/damage/SplinterBurst.tsx:125` | InstancedMesh reconstruct on count change (reduced-motion/tier toggle mid-effect) orphans old aParam clone (also Fire/Smoke) | Inferred from r3f reconstruct semantics, not reproduced; fix requires restructuring args — not a safe local fix. |
| BUG-863 | P3 | `src/vfx/sinking/Bubbles.tsx:72` | meshPhysicalMaterial with transmission=0 (not BUG-351 regression) — heavier shader than needed | Swapping material would alter visuals. |
| BUG-864 | P3 | `src/vfx/sinking/Debris.tsx:35` | debrisState() returns a new object per piece per frame | Fix changes API of a pure unit-tested function. |
| BUG-865 | P3 | `src/vfx/sinking/SinkingShip.tsx:216` | setState from useFrame re-renders sink effects when wave moves >2cm | Intentional per code comment; changing alters render behavior. |
| BUG-869 | P3 | `src/audio/AudioDemo.tsx:107` | AudioDemo settings subscriber setTimeout(read,0) not cleared (demo route only) | Demo-only, no observable effect. |
| BUG-870 | P3 | `src/audio/index.ts:727` | bindGameAudio `timelines` Set never pruned until unbind | Tiny objects; pruning needs extra timer bookkeeping in audio scheduler. |
| BUG-871 | P3 | `src/cinematics/CinematicCamera.tsx:85` | Pose/DeckPov object literals allocated per frame in cinematic camera path | Cinematics code; negligible GC (vectors already scratch). Also :203,:270,:304,:380. |
| BUG-872 | P3 | `src/cinematics/CinematicLayer.tsx:297` | SinkWater setWaterY from useFrame re-renders during sink | Throttled and apparently intentional; change could alter sink visuals. |
| BUG-873 | P3 | `src/cinematics/CinematicLayer.tsx:72` | set-state-in-effect (baseline lint site) on residual FX filter | Known baseline; moving it changes when residuals clear. |
| BUG-874 | P3 | `src/cinematics/director.ts:233` | Overboard bubbles/water-rush raw setTimeouts not cancelled on skip/finish | Cinematics audio sequencing is document-only; not reproduced at runtime. Suggest tracking ids per sequence and clearing in finish(). |
| BUG-875 | P3 | `src/extras/photo.tsx:1` | ~35 value exports + ~30 types in scope with no reference outside their own file (module API surface) | Mostly used internally; documented module API; removing export changes no runtime. List in report D2-9. |
| BUG-883 | P3 | `.github/workflows/ci.yml:7` | No top-level permissions block; e2e job doesn't cache Playwright browsers | Workflows are report-only |
| BUG-884 | P3 | `.oxlintrc.json:3` | Minimal oxlint config: no categories/ignorePatterns/vitest plugin; only-export-components is 115 of 198 warnings | Config policy decision |
| BUG-885 | P3 | `README.md:51` | Stack line lists GSAP (never used, now removed) | README rule: only fix wrong commands |
| BUG-886 | P3 | `README.md:42` | Request referenced npm run test:e2e; real script is npm run e2e (README is correct) | No alias added; README does not document test:e2e |
| BUG-887 | P3 | `README.md:38` | Develop list omits npm run perf:sky and 7 review routes (?vfx-*-demo, ?cinematics-demo, ?frigate-demo, ?extras-demo, ?deck-demo) | Docs completeness, not a wrong command |
| BUG-888 | P3 | `scripts/deck-shots.mjs:1` | 6 QA scripts not referenced by package.json/README/CI (cold-load, crew-shots, deck-gun-views, deck-perf-shots, perf-frames, deck-shots) | All cited in bugs.md or memory docs as QA tooling; not obsolete |
| BUG-889 | P3 | `src/perf/PerfOverlay.tsx:16` | tickState forces 4 Hz re-render of ?perf HUD with no state it renders | Debug-only; behaviour change not needed |
| BUG-890 | P3 | `src/perf/a11y/Announcer.tsx:7` | announce()/useAnnouncer() have no callers; Announcer live regions are always empty | Documented API in ARCHITECTURE.md:126 and mounted DOM matched by e2e aria-live query; removal changes DOM |
| BUG-891 | P3 | `src/perf/index.ts:10` | Barrel re-exports with no importer outside src/perf | Module public API locked by ARCHITECTURE.md |
| BUG-892 | P3 | `tsconfig.node.json:22` | e2e/, playwright.config.ts and scripts/ are not typechecked | Fix needs e2e edits or a shared global d.ts |

## Recommended fix order for deferred work

1. **Player-visible P2s.** BUG-823 (3D placement ignores which copy of a repeated class is being dropped, in Wolf-pack-style fleets), then BUG-822 (hot-seat handoff shows the previous captain's chest/spyglass marks until the next shot), then BUG-868 (crew livery not reset after a hot-seat swap; a hypothesis, so reproduce first). Each needs a targeted e2e/unit test before the change.
2. **Latent AI edge cases, behind a golden test.** Add a seeded AI shot-sequence snapshot test first (the gates cannot otherwise show that an rng-draw change preserves behaviour). Then fix BUG-802 (Hard `nextShot` loops forever on an empty `remainingShips`) and BUG-808 (Medium off-board targets on non-10×10 boards). Neither is reachable in the shipped app. After that, decide BUG-803 (doc fix or logic fix).
3. **Remaining leaks and timers.** BUG-862 (aParam clone orphaned when the particle count changes mid-effect), BUG-856, BUG-874 (cinematics timing, so the owner signs off), BUG-870, BUG-825.
4. **Per-frame work, measured first.** Use `npm run perf:*` / `scripts/perf-frames.mjs` before and after: BUG-865, BUG-872, BUG-864, BUG-871, BUG-853, BUG-855, BUG-863. Instancing and shared-material work (BUG-839, BUG-840) comes last, because it is architecture and needs the draw-call budgets from BUG-404/501.
5. **Types, duplication, dead exports.** BUG-805, BUG-804, BUG-810, BUG-814, BUG-815, BUG-811, BUG-816; module-API cleanups (BUG-809, BUG-812, BUG-806, BUG-828, BUG-826, BUG-838, BUG-854, BUG-875, BUG-888, BUG-890, BUG-891) only together with an `ARCHITECTURE.md` update.
6. **Tooling, tests, docs.** Typecheck `e2e/` + `playwright.config.ts` (BUG-892), oxlint config (BUG-884), CI permissions/browser cache (BUG-883), test gaps, README/comment staleness, and the remaining lint-only sites.
