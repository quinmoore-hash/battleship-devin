# Bugs

Single source of truth for known defects. **Anyone (human or Devin session) who finds a bug adds a row here, even if they fix it in the same PR.**

Severity: **P0** game unplayable / crash · **P1** wrong game result or blocked flow · **P2** visual/audio glitch, wrong feedback · **P3** polish, nit.

Status: `open` → `in-progress` → `fixed` (link the PR) · `wontfix` with a reason.

| ID | Sev | Area | Status | Title | Repro | Found by | Fix PR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BUG-001 | P3 | scene | fixed | Placeholder flat ocean has no waves, sky, or lighting detail | Open the app; the background is a flat blue plane. Replaced by the scene module work. | scaffold | https://github.com/quinmoore-hash/battleship-devin/pull/4 |
| BUG-002 | P3 | ui | open | Placement is auto-only; no drag/rotate placement of individual ships | Start any game; the only placement option is "Auto-place". Replaced by the UI module work. | scaffold | |
| BUG-003 | P1 | e2e | fixed | Smoke e2e test fails whenever Devin wins (race between phase check and status assertion) | `npm run e2e` with a Medium or Hard opponent that can actually win (~45–60 shots). The loop reads `data-phase=battle`, then Devin's turn ends the game, the `status` element unmounts and `toContainText('Your turn')` times out. Only passed before because the placeholder random opponent never won. | ai session | https://github.com/quinmoore-hash/battleship-devin/pull/1 |
| BUG-004 | P3 | ui | open | Grids have no visible A–J / 1–10 coordinate labels | Start a battle; the status line says e.g. "Devin fired at G8: hit" but neither grid shows row/column labels, so the cell cannot be located by eye (labels only exist as `aria-label`). | ai session | |
| BUG-005 | P3 | ui | open | No way to quit or restart a game during battle | Start a battle; there is no menu/reset button until the game-over screen, so abandoning a game needs a page reload. | ai session | |
| BUG-006 | P3 | scene | open | `THREE.Clock` deprecation warning in the console | Open the app with the 3D scene enabled and look at the devtools console. Harmless today but will break on a future three upgrade. | ai session | |

## Adding a bug
1. Take the next free `BUG-xxx` id.
2. Fill every column. "Repro" must be steps someone else can follow.
3. If you are fixing it, set status `in-progress` in your PR and `fixed` with the PR link when it merges.
| BUG-007 | P3 | store | open | `GameState.settings.sfxVolume/musicVolume` duplicate the audio module's persisted `useAudioSettings` and are never applied or saved | Open the app, call `useGameStore.getState().updateSettings({ sfxVolume: 0 })`; SFX still play at the persisted volume, and the value is gone after a reload. Integration should drop the two volume fields from the store (keep `reducedMotion`) or forward `updateSettings` to `setSfxVolume`/`setMusicVolume`. | audio session | |
| BUG-008 | P3 | audio | open | `AudioDemo` review page is only reachable via the dev server (`/src/audio/demo.html`); the production build has no route to it | `npm run build && npm run preview`, open `/src/audio/demo.html` → 404. Integration can mount `<AudioDemo />` behind a `?audio-demo` query param in `App.tsx`. | audio session | |
| BUG-009 | P3 | audio | open | Audio is not wired into the game: no `playSfx`/`startMusic`/`startAmbience` calls anywhere outside `src/audio` | Start any game; no sound plays. Call `bindGameAudio()` once from `App.tsx` (or have the UI call `playSfx` at its animation beats) and `initAudio()` at startup. | audio session | |
| BUG-010 | P2 | scene | fixed | Lighthouse beam renders as an opaque tan slab at night | Open `?scene-demo&tod=0&view=gameover`; the two beam cones were solid instead of a faint glow (scene fog was applied to the additive material, and a 0.06 linear opacity is ~0.27 after sRGB output). Fixed with `fog={false}` and a far lower opacity. | scene session | https://github.com/quinmoore-hash/battleship-devin/pull/4 |
| BUG-011 | P3 | scene | fixed | Noon sun specular blows the water out to white over the player board | Open `?scene-demo&tod=0.5&view=battle`; the specular lobe under the camera saturated to pure white and bloomed. Specular is now clamped and the broad glitter term reduced. | scene session | https://github.com/quinmoore-hash/battleship-devin/pull/4 |
