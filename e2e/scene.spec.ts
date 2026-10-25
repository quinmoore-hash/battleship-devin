import { expect, test } from '@playwright/test'

test('the 3D ocean renders a WebGL canvas', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await expect(page.getByTestId('main-menu')).toBeVisible()
  await expect(page.getByTestId('ocean-canvas').locator('canvas')).toBeVisible()
  await expect(page.getByTestId('ocean-fallback')).toHaveCount(0)
  expect(errors).toEqual([])
})
