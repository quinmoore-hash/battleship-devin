import { expect, test } from '@playwright/test'
import { startSinglePlayer } from './helpers'
test('tmp debug', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('battleship-devin.settings', JSON.stringify({ cinematics: 'off', sfxVolume: 0, musicVolume: 0, reducedMotion: true }))
    localStorage.setItem('battleship-devin.ui', JSON.stringify({ state: { hintsSeen: ['placement', 'battle'] }, version: 1 }))
  })
  await page.goto('/?quality=low&gpu=low&audio-debug')
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60_000 })
  await startSinglePlayer(page, 'easy', ['black-flag'])
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await expect(page.getByTestId('status')).toContainText('Your turn', { timeout: 60_000 })
  await page.keyboard.press('v')
  await expect(page.getByTestId('battle')).toHaveAttribute('data-deck', 'true')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: '/tmp/dbg-deck.png' })
  await page.getByTestId('deck-spyglass').click()
  await page.waitForTimeout(4000)
  await page.screenshot({ path: '/tmp/dbg-glass.png' })
  console.log('DEBUG:', await page.locator('[data-testid=spyglass-debug]').textContent().catch(() => 'none'), '| cell:', await page.getByTestId('spyglass-overlay').getAttribute('data-cell'))
})
