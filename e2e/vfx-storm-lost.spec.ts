import { expect, test } from '@playwright/test'

// Stormy seas: a shot lost in the storm leaves no marker anywhere — not on the HTML chart (the cell stays `unknown` and
// re-fireable) and not on the 3D water (no buoy). Counts the buoy instances in the live scene via `window.__perf`.
test('stormy seas: shots lost in the storm leave no chart mark and no buoy, and the square can be fired at again', async ({ page }) => {
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
  const storm = page.getByTestId('storm-status')
  await expect(storm).toBeVisible()

  const grid = page.getByTestId('enemy-grid')
  const gameover = page.getByTestId('gameover')
  const yourTurn = page.getByTestId('status').filter({ hasText: 'Your turn' })
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

  // always fire at the first unknown cell: after a lost shot that is the same cell again (it must still be enabled)
  let refired = false
  let lastCell: string | null = null
  for (let i = 0; i < 60 && Number((await storm.getAttribute('data-lost-mine')) ?? 0) < 2; i++) {
    await expect(yourTurn.or(gameover)).toBeVisible({ timeout: 30_000 })
    if (await gameover.isVisible()) break
    const cell = grid.locator('button[data-state="unknown"]:enabled').first()
    const id = await cell.getAttribute('data-testid')
    if (id && id === lastCell) refired = true
    lastCell = id
    await cell.click()
  }
  await expect(yourTurn.or(gameover)).toBeVisible({ timeout: 30_000 })
  const lostMine = Number(await storm.getAttribute('data-lost-mine'))
  expect(lostMine).toBeGreaterThanOrEqual(2)
  expect(refired).toBe(true)
  await expect(page.getByTestId('shot-log')).toContainText('lost in the storm')

  // chart: every landed shot has a mark, nothing else; water: exactly one buoy per miss on either board
  const enemyMisses = await grid.locator('button[data-state="miss"]').count()
  const myMisses = await page.getByTestId('player-grid').locator('button[data-state="miss"]').count()
  await expect.poll(buoys, { timeout: 20_000 }).toBe(enemyMisses + myMisses)
  expect(errors).toEqual([])
})
