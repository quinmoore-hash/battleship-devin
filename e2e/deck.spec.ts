import { expect, test } from '@playwright/test'
import { startSinglePlayer } from './helpers'

// "On deck" without 3D: nothing to stand on, so the HUD must not offer it — but the settings and the rules still describe it.
test('?no3d: no On-deck toggle, V does nothing, settings and How to play still carry the deck block', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?no3d')
  await startSinglePlayer(page, 'easy')
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await expect(page.getByTestId('battle')).toBeVisible()
  await expect(page.getByTestId('deck-toggle')).toHaveCount(0)
  await page.keyboard.press('v')
  await expect(page.getByTestId('deck-hud')).toHaveCount(0)
  await expect(page.getByTestId('battle')).toHaveAttribute('data-deck', 'false')

  await page.getByTestId('nav-settings').click()
  const slider = page.getByTestId('setting-deck-sensitivity')
  await expect(slider).toBeVisible()
  await slider.fill('2')
  await page.getByTestId('setting-deck-invert-y').check()
  await page.getByTestId('settings-close').click()
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('battleship-devin.settings') ?? '{}'))
  expect(stored.deckSensitivity).toBe(2)
  expect(stored.deckInvertY).toBe(true)

  await page.getByTestId('nav-how-to-play').click()
  await expect(page.getByTestId('howto-on-deck')).toContainText('same odds as the overview')
  await expect(page.getByTestId('howto-on-deck')).toContainText('Not available without 3D')
})
