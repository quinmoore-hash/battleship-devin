import { expect, test } from '@playwright/test'

test('settings expose cinematics, quality, mute and colorblind markers and persist them', async ({ page }) => {
  await page.goto('/?no3d')
  await page.getByTestId('open-settings').click()
  await page.getByTestId('setting-cinematics-fast').click()
  await expect(page.getByTestId('setting-cinematics-fast')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('setting-quality').selectOption('low')
  await page.getByTestId('setting-colorblind').check()
  await page.getByTestId('setting-mute').check()
  await page.getByTestId('settings-close').click()
  await expect(page.getByTestId('ui-root')).toHaveAttribute('data-colorblind', 'true')

  await page.reload()
  await page.getByTestId('open-settings').click()
  await expect(page.getByTestId('setting-quality')).toHaveValue('low')
  await expect(page.getByTestId('setting-mute')).toBeChecked()
})

test('battle HUD: compass status, captain’s log, restart, skip hint and quit confirm', async ({ page }) => {
  await page.goto('/?no3d')
  await page.getByTestId('difficulty-easy').click()
  await expect(page.getByTestId('hint-placement')).toBeVisible()
  await page.getByTestId('hint-placement').getByRole('button').click()
  await expect(page.getByTestId('hint-placement')).toHaveCount(0)
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await expect(page.getByTestId('battle')).toBeVisible()
  await expect(page.getByTestId('battle-clock')).toBeVisible()

  await page.getByTestId('enemy-grid-0-0').click()
  await expect(page.getByTestId('skip-cinematic')).toBeVisible()
  await page.keyboard.press(' ')
  await expect(page.getByTestId('status').filter({ hasText: 'Your turn' })).toBeVisible()
  await expect(page.getByTestId('shot-log').locator('li')).toHaveCount(2)
  await expect(page.getByTestId('fleet-status-enemy-afloat')).toHaveText('5/5 afloat')

  await page.getByTestId('restart').click()
  await expect(page.getByTestId('placement')).toBeVisible()
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await page.getByTestId('quit').click()
  await page.getByTestId('quit-cancel').click()
  await expect(page.getByTestId('battle')).toBeVisible()
  await page.getByTestId('quit').click()
  await page.getByTestId('quit-confirm').click()
  await expect(page.getByTestId('main-menu')).toBeVisible()
})

test('game over report has time, rank, and dispatches replay / photo events for the extras module', async ({ page }) => {
  await page.goto('/?no3d')
  await page.getByTestId('open-settings').click()
  await page.getByTestId('setting-cinematics-off').click()
  await page.getByTestId('settings-close').click()
  await page.getByTestId('difficulty-easy').click()
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  const grid = page.getByTestId('enemy-grid')
  const gameover = page.getByTestId('gameover')
  const yourTurn = page.getByTestId('status').filter({ hasText: 'Your turn' })
  for (let i = 0; i < 100; i++) {
    await expect(yourTurn.or(gameover)).toBeVisible()
    if (await gameover.isVisible()) break
    await grid.locator('button[data-state="unknown"]').first().click()
  }
  await expect(gameover).toBeVisible()
  await expect(page.getByTestId('stat-time')).toHaveText(/\d+:\d\d/)
  await expect(page.getByTestId('rank')).not.toBeEmpty()
  // the extras module owns the replay / photo overlays; here only check the buttons exist and dispatch their events
  const fired = await page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const got: string[] = []
        for (const name of ['battleship:replay', 'battleship:photo']) window.addEventListener(name, (e) => (got.push(name), e.stopImmediatePropagation()), { capture: true })
        document.querySelector<HTMLButtonElement>('[data-testid=report-replay]')!.click()
        document.querySelector<HTMLButtonElement>('[data-testid=report-photo]')!.click()
        setTimeout(() => resolve(got), 50)
      }),
  )
  expect(fired).toEqual(['battleship:replay', 'battleship:photo'])
  await page.keyboard.press('Escape')
  await page.getByTestId('rematch').click()
  await expect(page.getByTestId('placement')).toBeVisible()
})

test('touch targeting on the HTML chart stays one-tap; the 3D confirm button appears only for pending 3D taps', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })
  const page = await ctx.newPage()
  await page.goto('/?no3d')
  await page.getByTestId('difficulty-easy').click()
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await expect(page.getByTestId('fire-confirm')).toHaveCount(0)
  await page.getByTestId('enemy-grid-3-3').tap()
  await expect(page.getByTestId('enemy-grid-3-3')).not.toHaveAttribute('data-state', 'unknown')
  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(375)
  await ctx.close()
})
