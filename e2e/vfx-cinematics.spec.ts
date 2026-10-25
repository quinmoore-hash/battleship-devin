import { expect, test } from '@playwright/test'

test('the cinematics demo plays a shot, skips, and resolves `off` immediately', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto('/?cinematics-demo&quality=low')
  await expect(page.getByTestId('cinematics-panel')).toBeVisible()
  await expect(page.getByTestId('ocean-canvas').locator('canvas')).toBeVisible()
  await expect(page.getByTestId('status')).toContainText('idle')

  // full: letterbox in while it plays, Escape skips, letterbox out when done
  await page.getByTestId('fire-hit').click()
  await expect(page.getByTestId('letterbox')).toHaveAttribute('data-visible', 'true', { timeout: 20_000 })
  await expect(page.getByTestId('status')).toContainText('playing')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('status')).toContainText('1 done', { timeout: 20_000 })
  await expect(page.getByTestId('letterbox')).toHaveAttribute('data-visible', 'false')

  // fast runs to completion on its own
  await page.getByTestId('level').selectOption('fast')
  await page.getByTestId('fire-miss').click()
  await expect(page.getByTestId('status')).toContainText('2 done', { timeout: 30_000 })

  // off resolves synchronously
  await page.getByTestId('level').selectOption('off')
  await page.getByTestId('enemy-shot').click()
  await expect(page.getByTestId('status')).toContainText('3 done')
  await expect(page.getByTestId('status')).toContainText('idle')
  expect(errors).toEqual([])
})
