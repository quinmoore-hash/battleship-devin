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

## Develop

```bash
npm ci
npm run dev        # http://localhost:5173   (?no3d, ?scene-demo, ?ship-demo, ?audio-demo)
npm run lint       # oxlint
npm run typecheck  # tsc -b
npm test           # vitest unit tests
npm run e2e        # playwright: plays a full game on every difficulty
npm run build
```

Stack: Vite, React 19, TypeScript, react-three-fiber / drei / three, zustand, GSAP, Howler, Vitest, Playwright.

## Repo layout and ownership

See [ARCHITECTURE.md](ARCHITECTURE.md) for module boundaries, coordinate conventions and the public API each
module must keep. Bugs are tracked in [bugs.md](bugs.md).
