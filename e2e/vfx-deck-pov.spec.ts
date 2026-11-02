import { expect, test } from '@playwright/test'

/**
 * "On deck" POV branch of the cinematics (Session B): the director leaves the camera alone and drives VFX / deck-bus
 * events. The demo's `DeckEye` stands in for the deck controller's camera (eye height on the standing ship).
 * Screenshots land in test-results/ for the PR: a hull hit at eye height (hole + fire) and an outgoing shot from the gun.
 */
test('on deck: an incoming hit is visible at eye height and the manned gun fires the outgoing shot', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto('/?cinematics-demo&quality=low')
  await expect(page.getByTestId('cinematics-panel')).toBeVisible()
  await expect(page.getByTestId('ocean-canvas').locator('canvas')).toBeVisible()
  await page.getByTestId('deck-toggle').check()
  await expect(page).toHaveURL(/deck-pov=/)

  // incoming ball into the ship we stand on: splinters, deck fire, persistent damage
  await page.getByTestId('level').selectOption('fast')
  await page.getByTestId('enemy-hit-deck').click()
  await expect(page.getByTestId('status')).toContainText('playing')
  await page.waitForTimeout(900)
  await page.screenshot({ path: 'test-results/deck-pov-hull-hit-impact.png' })
  await expect(page.getByTestId('status')).toContainText('1 done', { timeout: 30_000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: 'test-results/deck-pov-hull-hit-eye-height.png' })

  // outgoing shot from the manned gun (station 0 of the standing ship)
  await page.getByTestId('fire-hit').click()
  await expect(page.getByTestId('status')).toContainText('playing')
  await page.waitForTimeout(500)
  await page.screenshot({ path: 'test-results/deck-pov-outgoing-shot.png' })
  await expect(page.getByTestId('status')).toContainText('2 done', { timeout: 30_000 })

  // off deck again: the overview camera / letterbox flow is unchanged
  await page.getByTestId('deck-toggle').uncheck()
  await expect(page).not.toHaveURL(/deck-pov=/)
  await page.getByTestId('fire-miss').click()
  await expect(page.getByTestId('letterbox')).toHaveAttribute('data-visible', 'true', { timeout: 20_000 })
  await expect(page.getByTestId('status')).toContainText('3 done', { timeout: 30_000 })
  expect(errors).toEqual([])
})
