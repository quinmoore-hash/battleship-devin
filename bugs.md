# Bugs

Single source of truth for known defects. **Anyone (human or Devin session) who finds a bug adds a row here, even if they fix it in the same PR.**

Severity: **P0** game unplayable / crash · **P1** wrong game result or blocked flow · **P2** visual/audio glitch, wrong feedback · **P3** polish, nit.

Status: `open` → `in-progress` → `fixed` (link the PR) · `wontfix` with a reason.

| ID | Sev | Area | Status | Title | Repro | Found by | Fix PR |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BUG-001 | P3 | scene | open | Placeholder flat ocean has no waves, sky, or lighting detail | Open the app; the background is a flat blue plane. Replaced by the scene module work. | scaffold | |
| BUG-002 | P3 | ui | open | Placement is auto-only; no drag/rotate placement of individual ships | Start any game; the only placement option is "Auto-place". Replaced by the UI module work. | scaffold | |

## Adding a bug
1. Take the next free `BUG-xxx` id.
2. Fill every column. "Repro" must be steps someone else can follow.
3. If you are fixing it, set status `in-progress` in your PR and `fixed` with the PR link when it merges.
