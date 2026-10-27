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
  // up to ~200 turns, each with a curtain: slow on the shared CI runner (BUG-309 class)
  test.setTimeout(420_000)
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
  await page.getByTestId('confirm-placement').click()
  await passDeck(page, 'Anne', true)

  const battle = page.getByTestId('battle')
  await expect(battle).toHaveAttribute('data-perspective', 'human')
  await expect(page.getByTestId('your-waters-title')).toContainText('Anne')
  await expect(page.getByTestId('enemy-waters-title')).toContainText('Jack')
  await expect(page.getByTestId('status')).toContainText("Anne's turn")

  const gameover = page.getByTestId('gameover')
  const grid = page.getByTestId('enemy-grid')
  let turn: 'Anne' | 'Jack' = 'Anne'
  for (let i = 0; i < 200; i++) {
    if (await gameover.isVisible()) break
    await expect(page.getByTestId('status')).toContainText(`${turn}'s turn`)
    await grid.locator('button[data-state="unknown"]').first().click()
    const next = turn === 'Anne' ? 'Jack' : 'Anne'
    await expect(gameover.or(page.getByTestId('handoff'))).toBeVisible()
    if (await gameover.isVisible()) break
    await passDeck(page, next, i < 2)
    await expect(battle).toHaveAttribute('data-perspective', next === 'Anne' ? 'human' : 'enemy')
    turn = next
  }
  await expect(gameover).toBeVisible()
  await expect(page.getByTestId('report-title')).toHaveText(/^(Anne|Jack) rules the Caribbean$/)
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
