import { expect, test } from '@playwright/test'

// BUG-315: in stormy seas the 3D enemy board must hide the same fogged misses the HTML chart hides —
// a fogged miss gets its splash but no persistent buoy. Counts the buoy instances in the live scene via `window.__perf`.
test('stormy seas: fogged misses leave no buoy on the 3D enemy board', async ({ page }) => {
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/?perf&quality=low')
  await expect(page.getByTestId('main-menu')).toBeVisible()
  await expect(page.getByTestId('ocean-canvas').locator('canvas')).toBeVisible()

  await page.getByTestId('open-settings').click()
  await page.getByTestId('setting-cinematics-off').click()
  await page.getByTestId('settings-close').click()
  await page.getByTestId('mode-storm').check()
  await page.getByTestId('difficulty-easy').click()
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await expect(page.getByTestId('battle')).toBeVisible()
  await expect(page.getByTestId('fog-status')).toBeVisible()

  const grid = page.getByTestId('enemy-grid')
  const gameover = page.getByTestId('gameover')
  const yourTurn = page.getByTestId('status').filter({ hasText: 'Your turn' })
  const fogged = grid.locator('button[data-state="miss"][data-fog]')
  const buoys = () =>
    page.evaluate(() => {
      let n = 0
      type Node = { name: string; count?: number }
      const scene = window.__perf?.scene() as { traverse: (cb: (o: Node) => void) => void } | undefined
      scene?.traverse((o) => {
        if (o.name === 'buoy-hull') n += o.count ?? 0
      })
      return n
    })

  // fire until the fog has swallowed at least two misses (30% of misses; Easy keeps the game going)
  for (let i = 0; i < 60 && (await fogged.count()) < 2; i++) {
    await expect(yourTurn.or(gameover)).toBeVisible({ timeout: 30_000 })
    if (await gameover.isVisible()) break
    await grid.locator('button[data-state="unknown"]:not([data-fog])').first().click()
  }
  await expect(yourTurn.or(gameover)).toBeVisible({ timeout: 30_000 })
  const hidden = await fogged.count()
  expect(hidden).toBeGreaterThanOrEqual(2)

  // chart: visible misses on both boards; water: every buoy on both boards
  const shownEnemyMisses = await grid.locator('button[data-state="miss"]:not([data-fog])').count()
  const myMisses = await page.getByTestId('player-grid').locator('button[data-state="miss"]').count()
  await expect.poll(buoys, { timeout: 20_000 }).toBe(shownEnemyMisses + myMisses)
  expect(await buoys()).toBeLessThan(shownEnemyMisses + hidden + myMisses)
  expect(errors).toEqual([])
})
