# Devin the Otter: Battleship

A 3D, otter-themed Battleship game. You command a river fleet against **Devin the Otter**, who plays at three skill levels:

| Mode | Devin's strategy |
| --- | --- |
| **Easy** | Random shots, never follows up on a hit. |
| **Medium** | Hunt/target: random until a hit, then works the neighbours until the ship sinks. |
| **Hard** | Probability-density heatmap over every legal placement of the remaining ships, parity targeting, ship-fit analysis. |

The fleet: Kelp Carrier (5), Clam Cruiser (4), Driftwood Destroyer (3), Stream Sub (3), Pebble Patrol (2).

## Play

Deployed from `main` to GitHub Pages: https://quinmoore-hash.github.io/battleship-devin/

## Develop

```bash
npm ci
npm run dev        # http://localhost:5173
npm run lint       # oxlint
npm run typecheck  # tsc -b
npm test           # vitest unit tests (engine, AI, store)
npm run e2e        # playwright: plays a full game on every difficulty
npm run build
```

Stack: Vite, React 19, TypeScript, react-three-fiber / drei / three, zustand, GSAP, Howler, Vitest, Playwright.

## Repo layout and ownership

See [ARCHITECTURE.md](ARCHITECTURE.md) for module boundaries and the public API each module must keep. Bugs are tracked in [bugs.md](bugs.md).
