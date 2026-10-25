import { expect, test } from '@playwright/test'

test('the cannon VFX demo fires a broadside and lands every ball', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto('/?vfx-cannon-demo&loop=0')
  await expect(page.getByTestId('vfx-cannon-demo')).toBeVisible()
  await expect(page.getByTestId('ocean-canvas').locator('canvas')).toBeVisible()
  await page.getByTestId('vfx-fire-broadside').click()
  await expect(page.getByTestId('vfx-status')).toContainText('in flight: 1')
  await page.getByTestId('vfx-skip').click()
  await expect(page.getByTestId('vfx-status')).toContainText('in flight: 0', { timeout: 15_000 })
  await page.getByTestId('vfx-fire-miss').click()
  await page.getByTestId('vfx-cam-follow').click()
  await expect(page.getByTestId('vfx-log')).toContainText('fires miss')
  expect(errors).toEqual([])
})
