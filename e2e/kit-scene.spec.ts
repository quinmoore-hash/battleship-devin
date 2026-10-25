import { expect, test } from '@playwright/test'

test('the kit review route renders every part without errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto('/?kit-demo&recoil=1&set=0.5&torn=0.4&snapped=0.6&lit=1')
  await expect(page.getByTestId('kit-demo').locator('canvas')).toBeVisible()
  await page.waitForTimeout(1500)
  expect(errors).toEqual([])
})
