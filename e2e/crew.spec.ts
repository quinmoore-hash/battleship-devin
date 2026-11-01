import { expect, test } from '@playwright/test'
import { startSinglePlayer } from './helpers'

// Crew toggle: default on, persisted with the other settings; How to play mentions the crew in the On deck block.
test('Crew setting defaults on, persists off, and How to play describes the crew', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?no3d')
  await startSinglePlayer(page, 'easy')
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await expect(page.getByTestId('battle')).toBeVisible()

  await page.getByTestId('nav-settings').click()
  const crew = page.getByTestId('setting-crew')
  await expect(crew).toBeChecked()
  await crew.uncheck()
  await page.getByTestId('settings-close').click()
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('battleship-devin.settings') ?? '{}'))
  expect(stored.crew).toBe(false)

  await page.getByTestId('nav-how-to-play').click()
  await expect(page.getByTestId('howto-on-deck')).toContainText('crew')
  await expect(page.getByTestId('howto-on-deck')).toContainText('overboard')

  // back at the menu after a reload the choice is still off
  await page.reload()
  await page.getByTestId('open-settings').click()
  await expect(page.getByTestId('setting-crew')).not.toBeChecked()
})
