import { expect, test, type Page } from '@playwright/test'
import { startSinglePlayer } from './helpers'

// Deck audio layer (src/deck/audio): the VM's browser has no speakers, so `?audio-debug` logs every deck cue as it fires
// (`deck-audio-log`). WebGL scene (SwiftShader, scene project); cinematics off, Low tier.
async function toDeck(page: Page, weather: 'calm' | 'squall' = 'calm', rules: Array<'salvo' | 'storm' | 'black-flag'> = []) {
  await page.addInitScript((w) => {
    localStorage.setItem('battleship-devin.settings', JSON.stringify({ cinematics: 'off', sfxVolume: 0, musicVolume: 0, reducedMotion: true, weather: w }))
    localStorage.setItem('battleship-devin.ui', JSON.stringify({ state: { hintsSeen: ['placement', 'battle'] }, version: 1 }))
  }, weather)
  await page.goto('/?quality=low&gpu=low&audio-debug')
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('ocean-canvas').locator('canvas')).toBeVisible()
  await startSinglePlayer(page, 'easy', rules)
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await expect(page.getByTestId('battle')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('status')).toContainText('Your turn', { timeout: 60_000 })
  // nothing of the deck layer exists at the overview
  await expect(page.getByTestId('deck-audio-log')).toHaveCount(0)
  await page.keyboard.press('v')
  await expect(page.getByTestId('battle')).toHaveAttribute('data-deck', 'true')
  return page.getByTestId('deck-audio-log')
}

test('deck audio: wind loop + ship ambience on entering the deck, footsteps from running, gun-crew calls on man / fire / result, all gone at the overview', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const log = await toDeck(page)
  await expect(log).toBeVisible()
  await expect(log).toHaveAttribute('data-wind', '0.35')
  await expect(log.locator('[data-cue="wind-sails"]').first()).toHaveText(/loop · calm/)
  // hull creak (4–9 s) / water lapping (2.5–5 s) / rigging strain from the hull's wave height
  await expect(log.locator('[data-cue="water-lap"], [data-cue="hull-creak"], [data-cue="rope-strain"]').first()).toBeVisible({ timeout: 15_000 })

  // footsteps follow actual travel (0.22 u a stride): the spawn stands at the rail facing the enemy, so run (Shift) along it
  await page.keyboard.down('Shift')
  await page.keyboard.down('a')
  await expect(log.locator('[data-cue="footstep"]').first()).toBeVisible({ timeout: 20_000 })
  await page.keyboard.up('a')
  await page.keyboard.up('Shift')
  await expect(log.locator('[data-cue="footstep"]').first()).toHaveText(/run/)

  // man a gun: "Run out the gun!"; fire: "Fire!" then the crew's cheer / groan on the result
  await page.getByTestId('deck-man').click()
  await expect(page.getByTestId('deck-station')).toContainText('Manning the')
  await expect(log.locator('[data-cue="gun-call-run-out"]')).toHaveCount(1, { timeout: 10_000 })
  await page.waitForTimeout(1500)
  await page.getByTestId('enemy-grid-0-0').click()
  await expect(page.getByTestId('enemy-grid-0-0')).not.toHaveAttribute('data-state', 'unknown', { timeout: 20_000 })
  await expect(log.locator('[data-cue="gun-call-fire"]')).toHaveCount(1, { timeout: 10_000 })
  await expect(log.locator('[data-cue="crew-cheer"], [data-cue="crew-groan"]').first()).toBeVisible({ timeout: 10_000 })
  // no footsteps while manning (the gun view does not travel)
  const stepsBefore = await log.locator('[data-cue="footstep"]').count()
  await page.waitForTimeout(2000)
  expect(await log.locator('[data-cue="footstep"]').count()).toBe(stepsBefore)

  // back to the overview: the layer unmounts (listener restored, wind loop stopped)
  await page.keyboard.press('v')
  await expect(page.getByTestId('battle')).toHaveAttribute('data-deck', 'false')
  await expect(log).toHaveCount(0)
  expect(errors).toEqual([])
})

test('deck audio: Stormy seas drive the wind in the sails to full gain (squall sky 0.8)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const log = await toDeck(page, 'squall', ['storm'])
  await expect(log).toBeVisible()
  await expect(log).toHaveAttribute('data-wind', '1.00')
  await expect(log.locator('[data-cue="wind-sails"]').first()).toHaveText(/loop · stormy/)
  expect(errors).toEqual([])
})
