import { expect, test } from '@playwright/test'
import { playToGameOver, startSinglePlayer } from './helpers'

// Flow tests run with the 3D scene disabled: headless CI has no GPU and software WebGL
// makes the whole page crawl. scene.spec.ts covers the canvas itself.
for (const difficulty of ['easy', 'medium', 'hard'] as const) {
  test(`a full game can be played on ${difficulty}`, async ({ page }) => {
    // The UI honours prefers-reduced-motion by collapsing turn pacing, which keeps a 100-shot game well inside the timeout.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/?no3d')
    await expect(page.getByTestId('ocean-fallback')).toBeVisible()
    await expect(page.getByTestId('main-menu')).toBeVisible()
    // the inline index.html boot splash hands over to React once the menu is mounted
    await expect(page.locator('#boot-splash')).toHaveCount(0)
    await startSinglePlayer(page, difficulty)

    await expect(page.getByTestId('placement')).toBeVisible()
    await expect(page.getByTestId('confirm-placement')).toBeDisabled()
    await page.getByTestId('auto-place').click()
    await page.getByTestId('confirm-placement').click()

    await expect(page.getByTestId('battle')).toBeVisible()
    await playToGameOver(page)
    await page.getByTestId('play-again').click()
    await expect(page.getByTestId('main-menu')).toBeVisible()
  })
}
