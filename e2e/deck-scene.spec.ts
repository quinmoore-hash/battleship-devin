import { expect, test, type Page } from '@playwright/test'
import { openShotLog, startSinglePlayer } from './helpers'

// "On deck" needs a WebGL scene (SwiftShader, scene project). Cinematics off keeps the turns short; Low tier keeps SwiftShader alive.
async function toBattle(page: Page, rules: Array<'salvo' | 'storm' | 'black-flag'> = []) {
  await page.addInitScript(() => {
    localStorage.setItem('battleship-devin.settings', JSON.stringify({ cinematics: 'off', sfxVolume: 0, musicVolume: 0, reducedMotion: true }))
    localStorage.setItem('battleship-devin.ui', JSON.stringify({ state: { hintsSeen: ['placement', 'battle'] }, version: 1 }))
  })
  await page.goto('/?quality=low&gpu=low')
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('ocean-canvas').locator('canvas')).toBeVisible()
  await startSinglePlayer(page, 'easy', rules)
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await expect(page.getByTestId('battle')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('status')).toContainText('Your turn', { timeout: 60_000 })
}

test('on deck: V toggles mid-turn without changing the game, a manned gun fires through the chart, Salvo counts the volley', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await toBattle(page, ['salvo'])
  const toggle = page.getByTestId('deck-toggle')
  await expect(toggle).toHaveAttribute('data-on', 'false')
  await expect(toggle).toHaveText(/On deck/)

  // toggle on with the key: HUD appears, the game state is untouched
  await page.keyboard.press('v')
  await expect(toggle).toHaveAttribute('data-on', 'true')
  await expect(page.getByTestId('battle')).toHaveAttribute('data-deck', 'true')
  const hud = page.getByTestId('deck-hud')
  await expect(hud).toBeVisible()
  await expect(page.getByTestId('deck-ship-name')).not.toHaveText('')
  await expect(page.getByTestId('deck-station')).toHaveText('Walking the deck')
  await expect(page.getByTestId('status')).toContainText('Your turn')
  await openShotLog(page)
  await expect(page.getByTestId('shot-log')).toContainText('No shots yet')

  // walking (not manning): the chart still fires — from the usable gun beside you — and the volley counter advances
  await expect(page.getByTestId('deck-salvo')).toHaveText(/shot 1 of 5/)
  await page.getByTestId('enemy-grid-0-0').click()
  await expect(page.getByTestId('deck-salvo')).toHaveText(/shot 2 of 5/)
  await expect(page.getByTestId('deck-prompt')).not.toHaveText(/Leave the cannon/)

  // man the nearest gun that bears, then click a square: the next volley shot leaves that gun
  await page.getByTestId('deck-man').click()
  await expect(page.getByTestId('deck-station')).toContainText('Manning the')
  await expect(hud).toHaveAttribute('data-station')
  await page.getByTestId('enemy-grid-1-0').click()
  await expect(page.getByTestId('deck-salvo')).toHaveText(/shot 3 of 5/)

  // toggle off mid-volley: the queued shots survive, the overview comes back
  await toggle.click()
  await expect(toggle).toHaveAttribute('data-on', 'false')
  await expect(hud).toHaveCount(0)
  await expect(page.getByTestId('enemy-grid-0-0')).toHaveClass(/is-pending|is-aimed|cell-/)
  await page.getByTestId('enemy-grid-2-0').click()
  await page.getByTestId('enemy-grid-3-0').click()
  await page.getByTestId('enemy-grid-4-0').click()
  await openShotLog(page)
  await expect(page.getByTestId('shot-log')).not.toContainText('No shots yet', { timeout: 60_000 })
  await expect(page.getByTestId('status')).toContainText('Your turn', { timeout: 60_000 })

  // back on deck: the seat is remembered (same ship), stepping away clears the station
  await page.keyboard.press('v')
  await expect(hud).toBeVisible()
  await expect(page.getByTestId('deck-station')).toHaveText('Walking the deck')
  await page.getByTestId('deck-man').click()
  await expect(page.getByTestId('deck-station')).toContainText('Manning the')
  await expect(page.getByTestId('deck-step-away')).toHaveText(/Leave the cannon/)
  await page.getByTestId('deck-step-away').click()
  await expect(page.getByTestId('deck-station')).toHaveText('Walking the deck')
  await expect(page.getByTestId('deck-prompt')).toHaveText('Cannon released')

  // Esc leaves the cannon too (the prompt says so the whole time), without leaving the deck or opening anything
  await page.getByTestId('deck-man').click()
  await expect(hud).toHaveAttribute('data-view', 'gun')
  await expect(page.getByTestId('deck-prompt')).toContainText('Esc — Leave the cannon')
  await page.keyboard.press('Escape')
  await expect(hud).toHaveAttribute('data-view', 'walk')
  await expect(page.getByTestId('deck-station')).toHaveText('Walking the deck')
  await expect(page.getByTestId('deck-prompt')).toHaveText('Cannon released')
  await expect(toggle).toHaveAttribute('data-on', 'true')
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)

  // Tab / the button hops to the next afloat ship
  const first = await page.getByTestId('deck-ship-name').textContent()
  await page.getByTestId('deck-next-ship').click()
  await expect(page.getByTestId('deck-ship-name')).not.toHaveText(first ?? '', { timeout: 20_000 })
  await page.screenshot({ path: 'test-results/deck-on-deck.png' })
  expect(errors).toEqual([])
})
