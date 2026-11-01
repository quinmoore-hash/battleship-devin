import { expect, type Page } from '@playwright/test'

/** Menu step 1 (Single player) → step 2 (Rules of engagement, left as they are) → step 3 (the Wanted poster). */
export async function startSinglePlayer(page: Page, difficulty: 'easy' | 'medium' | 'hard', rules: Array<'salvo' | 'storm' | 'black-flag'> = []) {
  await page.getByTestId('mode-single').click()
  for (const rule of rules) await page.getByTestId(`mode-${rule}`).check()
  await page.getByTestId('rules-next').click()
  await page.getByTestId(`difficulty-${difficulty}`).click()
}

export async function startTwoCaptains(page: Page, names: { human?: string; enemy?: string } = {}, rules: Array<'salvo' | 'storm' | 'black-flag'> = []) {
  await page.getByTestId('mode-two').click()
  for (const rule of rules) await page.getByTestId(`mode-${rule}`).check()
  await page.getByTestId('rules-next').click()
  if (names.human !== undefined) await page.getByTestId('captain-1-name').fill(names.human)
  if (names.enemy !== undefined) await page.getByTestId('captain-2-name').fill(names.enemy)
  await page.getByTestId('names-start').click()
}

/** The shot log is a drawer under the battle top bar (toggle in the header); idempotent. */
export async function openShotLog(page: Page) {
  const toggle = page.getByTestId('shot-log-toggle')
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await page.getByTestId('shot-log').waitFor()
}

/** The enemy-grid cell to fire at next: an unknown neighbour of a hit first (finish the ship), else a checkerboard sweep. */
const nextTargetInPage = (grid: HTMLElement): string | null => {
  const cells = new Map<string, { id: string; state: string }>()
  for (const b of grid.querySelectorAll<HTMLButtonElement>('button[data-testid][data-state]')) {
    const m = /-(\d+)-(\d+)$/.exec(b.dataset.testid ?? '')
    if (m) cells.set(`${m[1]},${m[2]}`, { id: b.dataset.testid!, state: b.dataset.state ?? '' })
  }
  for (const [key, c] of cells) {
    if (c.state !== 'hit') continue
    const [x, y] = key.split(',').map(Number)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = cells.get(`${x + dx},${y + dy}`)
      if (n?.state === 'unknown') return n.id
    }
  }
  let any: string | null = null
  for (const [key, c] of cells) {
    if (c.state !== 'unknown') continue
    any ??= c.id
    const [x, y] = key.split(',').map(Number)
    if ((x + y) % 2 === 0) return c.id
  }
  return any
}

/**
 * Play the single-player battle to the game-over screen. One DOM round trip per turn (poll for "Your turn" / game over,
 * then click), and hits are followed up before sweeping, so a game is ~50 shots instead of ~95: the old
 * `expect().toBeVisible()` + `isVisible()` + `first().click()` loops took 60–75 s on an idle runner and blew the 120 s
 * test timeout on a loaded CI worker (BUG-716).
 */
export async function playToGameOver(page: Page, { maxTurns = 100, turnStatus = /Your turn/ }: { maxTurns?: number; turnStatus?: RegExp } = {}): Promise<void> {
  const grid = page.getByTestId('enemy-grid')
  for (let i = 0; i < maxTurns; i++) {
    const phase = await page.waitForFunction(
      (re) => {
        if (document.querySelector('[data-testid="gameover"]')) return 'over'
        const s = document.querySelector('[data-testid="status"]')
        return s && new RegExp(re).test(s.textContent ?? '') ? 'turn' : null
      },
      turnStatus.source,
      { polling: 25, timeout: 15_000 },
    )
    if ((await phase.jsonValue()) === 'over') break
    const target = await grid.evaluate(nextTargetInPage)
    if (!target) break
    await page.getByTestId(target).click()
  }
  await expect(page.getByTestId('gameover')).toBeVisible()
}
