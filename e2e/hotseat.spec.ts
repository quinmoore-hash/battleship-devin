import { expect, test, type Page } from '@playwright/test'
import { startTwoCaptains } from './helpers'

/** Dismiss the curtain for `to`. `thorough` also checks that nothing of either chart is in the DOM and that Space / Escape do not drop it. */
async function passDeck(page: Page, to: string, thorough = false) {
  const curtain = page.getByTestId('handoff')
  await expect(curtain).toBeVisible()
  await expect(page.getByTestId('handoff-name')).toHaveText(to)
  if (thorough) {
    await expect(page.locator('[data-state]')).toHaveCount(0)
    await page.keyboard.press('Space')
    await page.keyboard.press('Escape')
    await expect(curtain).toBeVisible()
  }
  await page.getByTestId('handoff-ready').click()
  await expect(curtain).toHaveCount(0)
}

test('two captains: hot-seat game to victory with curtains, flipped HUD, named winner and a rematch that swaps who places first', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?no3d')
  await startTwoCaptains(page, { human: 'Anne', enemy: 'Jack' })

  await expect(page.getByTestId('placement')).toHaveAttribute('data-placing', 'human')
  await expect(page.getByTestId('placement-title')).toContainText('Anne')
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await passDeck(page, 'Jack', true)
  await expect(page.getByTestId('placement')).toHaveAttribute('data-placing', 'enemy')
  await expect(page.getByTestId('placement-title')).toContainText('Jack')
  await expect(page.getByTestId('placed-count')).toHaveText('0/5 placed')
  await page.getByTestId('auto-place').click()
  await expect(page.getByTestId('placed-count')).toHaveText('5/5 placed')
  // the test peeks at Jack's chart so Anne can win in the minimum 17 shots (keeps this spec cheap on CI — BUG-309 class)
  const jackCells: string[] = []
  for (const cell of await page.getByTestId('player-grid').locator('button[data-state="ship"]').all()) {
    const id = await cell.getAttribute('data-testid')
    if (id) jackCells.push(id.replace('player-grid-', ''))
  }
  expect(jackCells).toHaveLength(17)
  await page.getByTestId('confirm-placement').click()
  await passDeck(page, 'Anne', true)

  const battle = page.getByTestId('battle')
  await expect(battle).toHaveAttribute('data-perspective', 'human')
  await expect(page.getByTestId('your-waters-title')).toContainText('Anne')
  await expect(page.getByTestId('enemy-waters-title')).toContainText('Jack')
  await expect(page.getByTestId('status')).toContainText("Anne's turn")

  const gameover = page.getByTestId('gameover')
  const grid = page.getByTestId('enemy-grid')
  for (const [i, cell] of jackCells.entries()) {
    // Anne fires at one of Jack's ships
    await page.getByTestId(`enemy-grid-${cell}`).click()
    if (i === jackCells.length - 1) break
    await passDeck(page, 'Jack', i === 0)
    await expect(battle).toHaveAttribute('data-perspective', 'enemy')
    await expect(page.getByTestId('status')).toContainText("Jack's turn")
    // Jack fires back at Anne's waters (16 shots cannot sink her five ships)
    await grid.locator('button[data-state="unknown"]').first().click()
    await passDeck(page, 'Anne')
    await expect(battle).toHaveAttribute('data-perspective', 'human')
  }
  await expect(gameover).toBeVisible()
  await expect(page.getByTestId('report-title')).toHaveText('Anne rules the Caribbean')
  await expect(page.getByTestId('report-replay')).toBeVisible()

  // rematch: Jack places first this time
  await page.getByTestId('rematch').click()
  await expect(page.getByTestId('placement')).toHaveAttribute('data-placing', 'enemy')
  await expect(page.getByTestId('placement-title')).toContainText('Jack')
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await passDeck(page, 'Anne')
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await passDeck(page, 'Jack')
  await expect(battle).toHaveAttribute('data-perspective', 'enemy')
  await expect(page.getByTestId('status')).toContainText("Jack's turn")

  // quit returns to menu step 1
  await page.getByTestId('quit').click()
  await page.getByTestId('quit-confirm').click()
  await expect(page.getByTestId('main-menu')).toHaveAttribute('data-step', 'mode')
})

test('two captains + salvo: each captain fires a whole volley before the deck passes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?no3d')
  await page.getByTestId('mode-two').click()
  await page.getByTestId('mode-salvo').check()
  await page.getByTestId('rules-next').click()
  await page.getByTestId('names-start').click()
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await passDeck(page, 'Captain 2')
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await passDeck(page, 'Captain 1')
  const salvo = page.getByTestId('salvo-status')
  await expect(salvo).toHaveAttribute('data-size', '5')
  const grid = page.getByTestId('enemy-grid')
  for (let i = 1; i <= 4; i++) {
    await grid.locator('button[data-state="unknown"]:not([data-queued])').first().click()
    await expect(salvo).toHaveAttribute('data-pending', String(i))
    await expect(page.getByTestId('handoff')).toHaveCount(0)
  }
  await grid.locator('button[data-state="unknown"]:not([data-queued])').first().click()
  await passDeck(page, 'Captain 2')
  await expect(page.getByTestId('battle')).toHaveAttribute('data-perspective', 'enemy')
  // Captain 1's five shots are on Captain 2's own chart
  await expect(page.getByTestId('player-grid').locator('button[data-state="miss"], button[data-state="hit"], button[data-state="sunk"]')).toHaveCount(5)
  await expect(salvo).toHaveAttribute('data-size', '5')
})

test('375×812: names, curtain and battle fit the viewport', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto('/?no3d')
  await page.getByTestId('mode-two').click()
  await page.getByTestId('rules-next').click()
  await expect(page.getByTestId('captain-names')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await page.getByTestId('names-start').click()
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await expect(page.getByTestId('handoff-ready')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await page.getByTestId('handoff-ready').tap()
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await page.getByTestId('handoff-ready').tap()
  await expect(page.getByTestId('battle')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await ctx.close()
})

test('two captains + Black Flag: each captain picks a fleet and has their own Broadside / Spyglass; treasure and the Spyglass keep the deck', async ({ page }) => {
  test.setTimeout(180_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?no3d')
  await startTwoCaptains(page, { human: 'Anne', enemy: 'Jack' }, ['black-flag'])

  // Captain 1 picks the Wolf pack
  await expect(page.getByTestId('fleet-picker')).toBeVisible()
  await page.getByTestId('fleet-preset-wolf-pack').click()
  await expect(page.getByTestId('placed-count')).toHaveText('0/7 placed')
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await passDeck(page, 'Jack', true)

  // Captain 2 gets their own picker (the AI would have drawn a random preset) and picks the Armada
  await expect(page.getByTestId('placement')).toHaveAttribute('data-placing', 'enemy')
  await expect(page.getByTestId('fleet-picker')).toBeVisible()
  await expect(page.getByTestId('placed-count')).toHaveText('0/5 placed')
  await page.getByTestId('fleet-preset-armada').click()
  await expect(page.getByTestId('placed-count')).toHaveText('0/4 placed')
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await passDeck(page, 'Anne', true)

  const battle = page.getByTestId('battle')
  await expect(battle).toHaveAttribute('data-perspective', 'human')
  await expect(page.getByTestId('fleet-status-player-sloop#4')).toBeVisible()
  await expect(page.getByTestId('power-shots')).toBeVisible()
  await expect(page.getByTestId('treasure-count')).toContainText('0/2')

  // Anne: Spyglass keeps the deck (no shot, no curtain), then a Broadside is the whole turn → curtain
  await page.keyboard.press('g')
  await page.getByTestId('enemy-grid-4-4').click()
  await expect(page.getByTestId('enemy-grid-4-4')).toHaveClass(/cell-spied/)
  await expect(page.getByTestId('handoff')).toHaveCount(0)
  await expect(page.getByTestId('power-spyglass')).toBeDisabled()
  await page.keyboard.press('b')
  await page.getByTestId('enemy-grid-2-5').click()
  await passDeck(page, 'Jack')

  // Jack has his own, unspent power shots; his Broadside resolves three cells on Anne's chart
  await expect(battle).toHaveAttribute('data-perspective', 'enemy')
  await expect(page.getByTestId('fleet-status-player-man-o-war#2')).toBeVisible()
  await expect(page.getByTestId('power-broadside')).toBeEnabled()
  await expect(page.getByTestId('power-spyglass')).toBeEnabled()
  await page.keyboard.press('b')
  await page.getByTestId('enemy-grid-5-5').click()
  // the curtain follows the broadside at once, so read the result from Anne's side of the table
  await passDeck(page, 'Anne')
  await expect(page.getByTestId('shot-log').locator('li.log-broadside')).toHaveCount(2)
  for (const id of ['player-grid-4-5', 'player-grid-5-5', 'player-grid-6-5']) await expect(page.getByTestId(id)).toHaveAttribute('data-state', /hit|miss|sunk/)
  await expect(page.getByTestId('power-broadside')).toBeDisabled()
})
