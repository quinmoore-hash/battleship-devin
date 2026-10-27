import { expect, test } from '@playwright/test'
import { startSinglePlayer } from './helpers'

// Black Flag rules toggle: fleet picker, Broadside / Spyglass power shots and hidden treasure (BUG-540+).
test.describe('Black Flag', () => {
  test('a Black Flag game to victory under ?no3d: pick a fleet, spy, broadside, find treasure', async ({ page }) => {
    // a 7-ship Wolf pack game can take ~100 shots; CI runners pace turns ~3× slower than local
    test.setTimeout(300_000)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/?no3d')
    await expect(page.getByTestId('main-menu')).toBeVisible()
    await page.getByTestId('mode-single').click()
    await page.getByTestId('mode-black-flag').check()
    await page.getByTestId('rules-next').click()
    await page.getByTestId('difficulty-easy').click()

    // fleet picker: Wolf pack gives seven ships with repeated classes
    await expect(page.getByTestId('placement')).toBeVisible()
    await expect(page.getByTestId('fleet-picker')).toBeVisible()
    await page.getByTestId('fleet-preset-wolf-pack').click()
    await expect(page.getByTestId('fleet-preset-wolf-pack')).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('ship-tray-sloop#4')).toBeVisible()
    await expect(page.getByTestId('placed-count')).toHaveText('0/7 placed')
    await page.getByTestId('auto-place').click()
    await expect(page.getByTestId('placed-count')).toHaveText('7/7 placed')
    await page.getByTestId('confirm-placement').click()

    await expect(page.getByTestId('battle')).toBeVisible()
    await expect(page.getByTestId('fleet-status-player-sloop#4')).toBeVisible()
    await expect(page.getByTestId('power-shots')).toBeVisible()
    await expect(page.getByTestId('treasure-count')).toContainText('0/2')

    const grid = page.getByTestId('enemy-grid')
    const gameover = page.getByTestId('gameover')
    const status = page.getByTestId('status')
    const yourTurn = status.filter({ hasText: /Your turn|fire again|armed|Spyglass/ })

    // Spyglass (G): no shot, no turn spent, glyph on the cell, log line
    await page.keyboard.press('g')
    await expect(page.getByTestId('power-shots')).toHaveAttribute('data-armed', 'spyglass')
    await page.getByTestId('enemy-grid-4-4').click()
    await expect(page.getByTestId('enemy-grid-4-4')).toHaveAttribute('data-state', 'unknown')
    await expect(page.getByTestId('enemy-grid-4-4')).toHaveClass(/cell-spied/)
    await expect(page.getByTestId('power-spyglass')).toBeDisabled()
    await expect(page.getByTestId('shot-log')).toContainText('Spyglass E5')
    await expect(yourTurn).toBeVisible()

    // Broadside (B, R rotates): three cells resolve in one turn
    await page.keyboard.press('b')
    await page.keyboard.press('r')
    await expect(page.getByTestId('power-shots')).toHaveAttribute('data-armed', 'broadside')
    await page.getByTestId('enemy-grid-2-5').click()
    for (const id of ['enemy-grid-2-4', 'enemy-grid-2-5', 'enemy-grid-2-6']) await expect(page.getByTestId(id)).not.toHaveAttribute('data-state', 'unknown')
    await expect(page.getByTestId('power-broadside')).toBeDisabled()
    await expect(page.getByTestId('shot-log')).toContainText('Broadside C5–C7')

    for (let i = 0; i < 120; i++) {
      await expect(yourTurn.or(gameover)).toBeVisible()
      if (await gameover.isVisible()) break
      await grid.locator('button[data-state="unknown"]').first().click()
    }
    await expect(gameover).toBeVisible()
    await expect(page.getByTestId('stat-black-flag')).toContainText('Wolf pack vs')
    await expect(page.getByTestId('stat-lost')).toContainText('/7')
    await expect(page.getByTestId('stat-black-flag')).toContainText('chests')
  })

  test('Black Flag off: no picker, no power shots (classic regression)', async ({ page }) => {
    await page.goto('/?no3d')
    await startSinglePlayer(page, 'easy')
    await expect(page.getByTestId('placement')).toBeVisible()
    await expect(page.getByTestId('fleet-picker')).toHaveCount(0)
    await expect(page.getByTestId('placed-count')).toHaveText('0/5 placed')
    await page.getByTestId('auto-place').click()
    await page.getByTestId('confirm-placement').click()
    await expect(page.getByTestId('battle')).toBeVisible()
    await expect(page.getByTestId('power-shots')).toHaveCount(0)
  })
})
