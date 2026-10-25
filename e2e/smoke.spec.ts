import { expect, test } from '@playwright/test'

// Flow tests run with the 3D scene disabled: headless CI has no GPU and software WebGL
// makes the whole page crawl. scene.spec.ts covers the canvas itself.
for (const difficulty of ['easy', 'medium', 'hard'] as const) {
  test(`a full game can be played on ${difficulty}`, async ({ page }) => {
    await page.goto('/?no3d')
    await expect(page.getByTestId('ocean-fallback')).toBeVisible()
    await expect(page.getByTestId('main-menu')).toBeVisible()
    await page.getByTestId(`difficulty-${difficulty}`).click()

    await expect(page.getByTestId('placement')).toBeVisible()
    await expect(page.getByTestId('confirm-placement')).toBeDisabled()
    await page.getByTestId('auto-place').click()
    await page.getByTestId('confirm-placement').click()

    await expect(page.getByTestId('battle')).toBeVisible()
    const grid = page.getByTestId('enemy-grid')
    const gameover = page.getByTestId('gameover')
    const yourTurn = page.getByTestId('status').filter({ hasText: 'Your turn' })
    for (let i = 0; i < 100; i++) {
      // Devin's turn can end the game, so wait for either our turn or the game-over screen.
      await expect(yourTurn.or(gameover)).toBeVisible()
      if (await gameover.isVisible()) break
      const cell = grid.locator('button[data-state="unknown"]').first()
      await cell.click()
    }
    await expect(page.getByTestId('gameover')).toBeVisible()
    await page.getByTestId('play-again').click()
    await expect(page.getByTestId('main-menu')).toBeVisible()
  })
}
