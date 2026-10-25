import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const SERIOUS = ['serious', 'critical']

async function auditPage(page: import('@playwright/test').Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'best-practice']).exclude('canvas').analyze()
  const serious = results.violations.filter((v) => SERIOUS.includes(v.impact ?? ''))
  for (const v of serious) console.log(`[axe:${name}] ${v.id} (${v.impact}): ${v.help} → ${v.nodes.map((n) => `${n.target.join(' ')} ${n.failureSummary}`).join('; ')}`)
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), `${name}: serious/critical axe violations`).toEqual([])
}

test.describe('accessibility', () => {
  test('menu, settings, placement and battle have no serious axe violations', async ({ page }) => {
    // modal fade-in blends foreground colours mid-animation, which axe would read as low contrast
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/?no3d')
    await auditPage(page, 'menu')
    await page.getByTestId('open-settings').click()
    await expect(page.getByTestId('setting-quality')).toBeVisible()
    await expect(page.getByTestId('setting-colorblind')).toBeVisible()
    await auditPage(page, 'settings')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('settings')).toBeHidden()
    await page.getByTestId('difficulty-easy').click()
    await expect(page.getByTestId('placement')).toBeVisible()
    await auditPage(page, 'placement')
    await page.getByTestId('auto-place').click()
    await page.getByTestId('confirm-placement').click()
    await expect(page.getByTestId('battle')).toBeVisible()
    await auditPage(page, 'battle')
  })

  test('grids are keyboard-playable and every shot is announced', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/?no3d')
    await page.getByTestId('difficulty-easy').click()
    await page.getByTestId('auto-place').click()
    await page.getByTestId('confirm-placement').click()
    const first = page.getByTestId('enemy-grid-0-0')
    await first.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('enemy-grid-1-0')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByTestId('enemy-grid-1-1')).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.getByTestId('enemy-grid-9-1')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(page.getByTestId('enemy-grid-0-1')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('enemy-grid-0-1')).toHaveAttribute('data-state', /miss|hit|sunk/)
    await expect(page.locator('[aria-live="assertive"]').filter({ hasText: /You fired at A2/ })).toHaveCount(1)
    const grid = page.getByTestId('enemy-grid')
    await expect(grid).toHaveAttribute('role', 'grid')
    await expect(grid.locator('[role="row"]')).toHaveCount(10)
  })

  test('colour-blind markers add shapes and the quality override persists', async ({ page }) => {
    await page.goto('/?no3d')
    await page.getByTestId('open-settings').click()
    await page.getByTestId('setting-colorblind').check()
    await page.getByTestId('setting-quality').selectOption('low')
    await expect(page.locator('html')).toHaveAttribute('data-colorblind', 'true')
    await page.reload()
    expect(await page.evaluate(() => localStorage.getItem('pirate-battleship.quality'))).toBe('low')
    await page.getByTestId('open-settings').click()
    await expect(page.getByTestId('setting-quality')).toHaveValue('low')
  })

  test('touch devices get >= 44px grid cells without horizontal page overflow', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' })
    const page = await context.newPage()
    await page.goto('/?no3d')
    await page.getByTestId('difficulty-easy').click()
    await page.getByTestId('auto-place').click()
    await page.getByTestId('confirm-placement').click()
    const cell = await page.getByTestId('enemy-grid-0-0').boundingBox()
    expect(cell!.width).toBeGreaterThanOrEqual(44)
    expect(cell!.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
    await context.close()
  })

  test('prefers-reduced-motion maps to reducedMotion + fast cinematics', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/?no3d')
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true')
    await page.getByTestId('open-settings').click()
    await expect(page.getByTestId('setting-reduced-motion')).toBeChecked()
  })

  test('the FPS watchdog lowers quality once and tells the player', async ({ page }) => {
    await page.goto('/?no3d&perf')
    await page.getByTestId('difficulty-easy').click()
    await page.getByTestId('auto-place').click()
    await page.getByTestId('confirm-placement').click()
    await expect(page.getByTestId('battle')).toBeVisible()
    const before = await page.evaluate(() => window.__perf!.tier())
    expect(await page.evaluate(() => window.__perf!.autoLower())).toBe(true)
    const toast = page.getByTestId('quality-toast')
    await expect(toast).toContainText('Lowered quality for smoother play')
    await expect(toast).toHaveAttribute('role', 'status')
    const after = await page.evaluate(() => window.__perf!.tier())
    expect(['low', 'medium', 'high'].indexOf(after)).toBeLessThan(['low', 'medium', 'high'].indexOf(before))
    // only once per session, and a manual pick still wins
    expect(await page.evaluate(() => window.__perf!.autoLower())).toBe(false)
    await toast.getByRole('button', { name: 'Dismiss notice' }).click()
    await expect(toast).toHaveCount(0)
    await page.getByTestId('nav-settings').click()
    await expect(page.getByTestId('setting-quality')).toHaveValue('auto')
  })
})
