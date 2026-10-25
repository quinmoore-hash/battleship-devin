import { expect, test } from '@playwright/test'

test('a ship can be placed manually, rotated, picked back up and re-placed', async ({ page }) => {
  await page.goto('/?no3d')
  await page.getByTestId('difficulty-medium').click()
  await expect(page.getByTestId('placement')).toBeVisible()

  // Kelp Carrier (5) is pre-selected; hovering previews a horizontal footprint.
  const tray = page.getByTestId('ship-tray-kelp-carrier')
  await expect(tray).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('player-grid-2-2').hover()
  for (let x = 2; x < 7; x++) {
    await expect(page.getByTestId(`player-grid-${x}-2`)).toHaveAttribute('data-preview', 'valid')
  }

  // R rotates: the footprint becomes vertical.
  await page.keyboard.press('r')
  await page.getByTestId('player-grid-2-3').hover()
  await page.getByTestId('player-grid-2-2').hover()
  for (let y = 2; y < 7; y++) {
    await expect(page.getByTestId(`player-grid-2-${y}`)).toHaveAttribute('data-preview', 'valid')
  }
  await page.getByTestId('player-grid-2-2').click()
  for (let y = 2; y < 7; y++) {
    await expect(page.getByTestId(`player-grid-2-${y}`)).toHaveAttribute('data-state', 'ship')
  }
  await expect(tray).toHaveAttribute('data-placed', 'true')
  await expect(page.getByTestId('placed-count')).toHaveText('1/5 placed')

  // Overlapping the placed ship shows an invalid (red) preview for the next ship.
  await page.getByTestId('player-grid-2-4').hover()
  await expect(page.getByTestId('player-grid-2-4')).toHaveAttribute('data-preview', 'invalid')

  // Clicking a placed ship picks it back up.
  await page.getByTestId('player-grid-2-4').click()
  await expect(tray).toHaveAttribute('data-placed', 'false')
  await expect(page.getByTestId('player-grid-2-2')).toHaveAttribute('data-state', 'unknown')

  // Rotate button works too; place it horizontally at the edge (origin is clamped).
  await page.getByTestId('rotate').click()
  await page.getByTestId('player-grid-9-9').click()
  for (let x = 5; x < 10; x++) {
    await expect(page.getByTestId(`player-grid-${x}-9`)).toHaveAttribute('data-state', 'ship')
  }

  // Auto-place the rest and start.
  await page.getByTestId('auto-place').click()
  await expect(page.getByTestId('confirm-placement')).toBeEnabled()
  await page.getByTestId('confirm-placement').click()
  await expect(page.getByTestId('battle')).toBeVisible()
  await expect(page.getByTestId('status')).toContainText('Your turn')
})

test('settings and how-to-play modals open from the menu and the corner nav', async ({ page }) => {
  await page.goto('/?no3d')
  await page.getByTestId('open-how-to-play').click()
  await expect(page.getByTestId('how-to-play')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('how-to-play')).toHaveCount(0)

  await page.getByTestId('open-settings').click()
  await page.getByTestId('setting-reduced-motion').click()
  await expect(page.getByTestId('setting-reduced-motion')).toBeChecked()
  await page.getByTestId('settings-close').click()
  await expect(page.getByTestId('ui-root')).toHaveAttribute('data-reduced-motion', 'true')

  await page.getByTestId('difficulty-easy').click()
  await page.getByTestId('nav-settings').click()
  await expect(page.getByTestId('settings')).toBeVisible()
})

test('mobile layout (375px) keeps the whole flow usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 })
  await page.goto('/?no3d')
  await page.getByTestId('difficulty-easy').click()
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await expect(page.getByTestId('battle')).toBeVisible()
  const grid = page.getByTestId('enemy-grid')
  const box = await grid.boundingBox()
  expect(box!.width).toBeLessThanOrEqual(375)
  await grid.locator('button[data-state="unknown"]').first().click()
  await expect(page.getByTestId('status')).not.toContainText('Your turn')
})
