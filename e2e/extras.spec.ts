import { expect, test } from '@playwright/test'

// Extras flows run with the 3D scene disabled (see smoke.spec.ts); the 3D replay/photo canvases are covered by scene.spec.ts-style checks in the recording.
test('salvo + stormy seas game: volleys queue, fog hides misses, replay and photo open from game over', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?no3d')
  await expect(page.getByTestId('extras-menu')).toBeVisible()
  await expect(page.getByTestId('stats-panel')).toContainText('No battles yet')
  await page.getByTestId('mode-salvo').check()
  await page.getByTestId('mode-storm').check()
  await page.getByTestId('difficulty-easy').click()
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await expect(page.getByTestId('battle')).toBeVisible()

  const salvo = page.getByTestId('salvo-status')
  await expect(salvo).toHaveAttribute('data-size', '5')
  await expect(page.getByTestId('fog-status')).toBeVisible()

  const grid = page.getByTestId('enemy-grid')
  const gameover = page.getByTestId('gameover')
  const yourTurn = page.getByTestId('status').filter({ hasText: 'Your turn' })
  // The first four shots of a five-ship volley only queue.
  for (let i = 1; i <= 4; i++) {
    await grid.locator('button[data-state="unknown"]:not([data-queued]):not([data-fog])').first().click()
    await expect(salvo).toHaveAttribute('data-pending', String(i))
  }
  await grid.locator('button[data-state="unknown"]:not([data-queued]):not([data-fog])').first().click()
  await expect(salvo).toHaveAttribute('data-pending', '0')

  for (let i = 0; i < 120; i++) {
    await expect(yourTurn.or(gameover)).toBeVisible()
    if (await gameover.isVisible()) break
    const cell = grid.locator('button[data-state="unknown"]:not([data-queued]):not([data-fog])').first()
    if ((await cell.count()) === 0) break
    await cell.click()
  }
  await expect(gameover).toBeVisible()
  await expect(page.getByTestId('stats-totals')).toContainText('1 battle')

  await page.getByTestId('report-replay').click()
  await expect(page.getByTestId('replay-player')).toBeVisible()
  const counter = page.getByTestId('replay-counter')
  await page.getByTestId('replay-next').click()
  await expect(counter).toContainText(/^1\//)
  await page.getByTestId('replay-close').click()
  await expect(page.getByTestId('replay-player')).toHaveCount(0)

  await page.getByTestId('report-photo').click()
  await expect(page.getByTestId('photo-mode')).toBeVisible()
  await page.getByTestId('photo-close').click()
  await expect(page.getByTestId('photo-mode')).toHaveCount(0)

  await page.getByTestId('play-again').click()
  await expect(page.getByTestId('stats-panel')).toContainText('1 / 1')
  // "Clear log" asks in-app first, then wipes battleship-devin.stats (BUG-321)
  await page.getByTestId('stats-clear').click()
  await page.getByTestId('stats-clear-no').click()
  await expect(page.getByTestId('stats-totals')).toContainText('1 battle')
  await page.getByTestId('stats-clear').click()
  await page.getByTestId('stats-clear-yes').click()
  await expect(page.getByTestId('stats-panel')).toContainText('No battles yet')
  expect(await page.evaluate(() => localStorage.getItem('battleship-devin.stats'))).toBeNull()
})

test('classic game keeps one shot per turn with both modes off', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?no3d')
  await page.getByTestId('difficulty-easy').click()
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await expect(page.getByTestId('battle')).toBeVisible()
  await expect(page.getByTestId('extras-battle-strip')).toHaveCount(0)
  const grid = page.getByTestId('enemy-grid')
  await grid.locator('button[data-state="unknown"]').first().click()
  await expect(grid.locator('button[data-state="miss"], button[data-state="hit"]')).toHaveCount(1)
})

test('?extras-demo sandbox fires volleys and the replay tab steps', async ({ page }) => {
  await page.goto('/?extras-demo=sandbox&seed=7&no3d')
  const sandbox = page.getByTestId('sandbox')
  await expect(sandbox).toBeAttached()
  await expect(page.getByTestId('event-count')).toHaveText(/^0 shots/)
  await page.getByTestId('sandbox-random-volley').click()
  await expect(page.getByTestId('event-count')).not.toHaveText(/^0 shots/)

  await page.getByTestId('extras-tab-replay').click()
  const player = page.getByTestId('replay-player')
  await expect(player).toBeVisible()
  await page.getByTestId('replay-toggle').click() // pause
  await page.getByTestId('replay-end').click()
  const total = await player.getAttribute('data-total')
  await expect(page.getByTestId('replay-counter')).toContainText(`${total}/${total}`)
})
