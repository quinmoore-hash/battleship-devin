import { expect, test } from '@playwright/test'
import { startSinglePlayer } from './helpers'

// Extras flows run with the 3D scene disabled (see smoke.spec.ts); the 3D replay/photo canvases are covered by scene.spec.ts-style checks in the recording.
test('salvo + stormy seas game: volleys queue, lost shots are re-fireable, replay and photo open from game over', async ({ page }) => {
  test.setTimeout(240_000) // a stormy game re-fires ~30% of its shots, so it is longer than a classic one (BUG-309)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?no3d')
  await expect(page.getByTestId('extras-menu-stats')).toBeVisible()
  await expect(page.getByTestId('stats-panel')).toContainText('No battles yet')
  // the Rules of engagement dock is menu step 2
  await page.getByTestId('mode-single').click()
  await expect(page.getByTestId('extras-menu')).toBeVisible()
  await page.getByTestId('mode-salvo').check()
  await page.getByTestId('mode-storm').check()
  await page.getByTestId('rules-next').click()
  await page.getByTestId('difficulty-easy').click()
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await expect(page.getByTestId('battle')).toBeVisible()

  const salvo = page.getByTestId('salvo-status')
  await expect(salvo).toHaveAttribute('data-size', '5')
  const storm = page.getByTestId('storm-status')
  await expect(storm).toBeVisible()

  const grid = page.getByTestId('enemy-grid')
  const gameover = page.getByTestId('gameover')
  const yourTurn = page.getByTestId('status').filter({ hasText: 'Your turn' })
  // The first four shots of a five-ship volley only queue.
  for (let i = 1; i <= 4; i++) {
    await grid.locator('button[data-state="unknown"]:not([data-queued])').first().click()
    await expect(salvo).toHaveAttribute('data-pending', String(i))
  }
  await grid.locator('button[data-state="unknown"]:not([data-queued])').first().click()
  await expect(salvo).toHaveAttribute('data-pending', '0')

  // ~30% of shots are lost in the storm and must be fired again, so a game takes more clicks than cells
  let lostSoFar = 0
  for (let i = 0; i < 500; i++) {
    await expect(yourTurn.or(gameover)).toBeVisible()
    if (await gameover.isVisible()) break
    lostSoFar = Number((await storm.getAttribute('data-lost')) ?? 0)
    const cell = grid.locator('button[data-state="unknown"]:not([data-queued])').first()
    if ((await cell.count()) === 0) break
    const clicked = page.getByTestId((await cell.getAttribute('data-testid')) ?? '')
    await cell.click()
    // the salvo queue mark is painted on the next frame; clicking the same cell again would un-queue it
    await expect
      .poll(async () => (await gameover.isVisible()) || !(await yourTurn.isVisible()) || (await clicked.getAttribute('data-queued', { timeout: 500 }).catch(() => null)) !== null, { timeout: 10_000 })
      .toBe(true)
  }
  await expect(gameover).toBeVisible()
  // the strip (gone with the battle HUD) counted lost shots and the report lists "yours · enemy"
  expect(lostSoFar).toBeGreaterThan(0)
  await expect(page.getByTestId('stat-lost-storm')).toHaveText(/^[1-9]\d* · \d+$/)
  // BUG-316: a salvo turn is a volley, not a shot
  const shots = Number(await page.getByTestId('stat-shots').textContent())
  const turns = Number(await page.getByTestId('stat-turns').textContent())
  expect(turns).toBeGreaterThan(0)
  expect(turns).toBeLessThan(shots)
  // BUG-270 / BUG-308: the log is a corner toggle, Replay / Photo live on the report only
  await expect(page.getByTestId('open-replay')).toHaveCount(0)
  await page.getByTestId('toggle-log').click()
  await expect(page.getByTestId('stats-totals')).toContainText('1 battle')
  await page.getByTestId('toggle-log').click()
  await expect(page.getByTestId('stats-panel')).toHaveCount(0)

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
  // BUG-320: the modes survive "Menu" (the rules dock is menu step 2)
  await page.getByTestId('mode-single').click()
  await expect(page.getByTestId('mode-salvo')).toBeChecked()
  await expect(page.getByTestId('mode-storm')).toBeChecked()
  await page.getByTestId('menu-back').click()
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
  await startSinglePlayer(page, 'easy')
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
