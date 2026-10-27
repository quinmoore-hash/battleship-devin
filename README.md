# Pirate Battleship

A fully 3D, cinematic Battleship game in the browser. Place your pirate fleet in a Caribbean cove, pick a
target in the Royal Navy's waters, and watch the shot play out: cannons recoil, the cannonball arcs across the
bay, and it either throws up a water column or blasts fire and splinters out of a wooden hull. Sink a ship and
the camera zooms in as masts snap and the hull slides under.

| Mode | Enemy strategy |
| --- | --- |
| **Easy** | Random shots, never follows up on a hit. |
| **Medium** | Hunt/target: random until a hit, then works the neighbours until the ship sinks. |
| **Hard** | Probability-density heatmap over every legal placement of the remaining ships, parity targeting, ship-fit analysis. |

The fleet: Man-o’-War (5), Galleon (4), Frigate (3), Brigantine (3), Sloop (2).

## Play

Deployed from `main` to GitHub Pages: https://quinmoore-hash.github.io/battleship-devin/

**Sky & sea (looks only).** The small control in the top-right corner of the menu (also in Settings) picks the time of
day — Dawn, Noon, Golden hour (default), Dusk, Moonlit night — and the weather — Calm, Overcast, Squall (rain and a
bigger swell, no lightning). It re-lights the cove instantly and is remembered with your settings; `?tod=night&weather=squall`
preselects it for a visit. It never changes the rules: the Stormy seas rule brings its own storm and shows "Stormy seas"
greyed out in the picker while it is on.

## Develop

```bash
npm ci
npm run dev        # http://localhost:5173   (?no3d, ?scene-demo, ?ship-demo, ?audio-demo, ?kit-demo, ?perf-demo, &perf HUD, &quality=low|medium|high)
npm run lint       # oxlint
npm run typecheck  # tsc -b
npm test           # vitest unit tests
npm run e2e        # playwright: plays a full game on every difficulty + axe-core a11y audit
npm run perf       # after `npm run build`: median FPS / draw calls per quality tier on ?perf-demo
                   # (no GPU / VM: PERF_HEADED=1 PERF_FRAMES=20 xvfb-run -a npm run perf — headless SwiftShader drops the WebGL context)
npm run perf:game  # after `npm run build`: plays a real game (menu → placement → 60 shots → rematch) and prints draw calls /
                   # tris / geometries / textures / programs / heap / JS ms per checkpoint. PERF_TIER=low|medium|high,
                   # PERF_SHOTS=60, PERF_DUMP=1 (per-group mesh dump + live programs), PERF_SHOT_DIR=dir for screenshots
npm run build
```

Stack: Vite, React 19, TypeScript, react-three-fiber / drei / three, zustand, GSAP, Howler, Vitest, Playwright.

How a turn plays: place your fleet on the water (drag / click, R to rotate — the HTML grid is the accessible mirror), then
click the enemy waters. The cinematics director flies the camera to your firing ship, the broadside lands on the target
(splash, or splinters and fire — a sunk ship rolls over in slow motion and leaves flotsam), the enemy aims and answers.
Settings › Cinematics: `full` (default), `fast` (one ball, short cuts) or `off` (instant results); click, Space or Esc
skips the current shot. Salvo, Stormy-seas and Black Flag rules are on the menu (tick any combination; Stormy seas: 30% of shots, yours
and the enemy's, are lost in the storm — no hit or miss shown, fire at the square again); the after-action report offers
Replay and Photo mode.

**Black Flag** — pick your fleet before placing (Classic, Armada, Wolf pack or Raiders — all 17 cells; the enemy draws one too),
two power shots per side per game under the enemy chart — **Broadside** (`B`, `R` rotates: a line of three cells, your whole
turn) and **Spyglass** (`G`: reveals one cell, no shot, no turn) — and two hidden treasure chests per board: hit one and you
fire again at once. Medium/Hard captains use their Broadside the turn after their first hit; Hard looks through the Spyglass
when one cell stands out. Full rules under How to play › Rules of engagement.

Graphics quality (Settings › first row, or `?quality=`): `auto` picks `medium` for integrated GPUs (Apple M-series,
Intel Iris/Xe — the tuned 60 fps target is a MacBook Air M4 at native resolution), `low` for phones / old GPUs, and
`high` (2k shadows, bloom, full-detail fleet) only on discrete GPUs that pass a ≥ 90 fps probe. If a battle runs
under 45 fps for 4 s on `auto`, the game drops one tier once and says so (`?gpu=low|medium|high` pins the detected
tier to try that path on any machine; `?perf` shows the HUD).

## Repo layout and ownership

See [ARCHITECTURE.md](ARCHITECTURE.md) for module boundaries, coordinate conventions and the public API each
module must keep. Bugs are tracked in [bugs.md](bugs.md).
