import { expect, test, type Page } from '@playwright/test'

/**
 * "On deck" eye-height review (session C): the `?deck-demo` route stands the camera at each class's helm
 * (`anchors.deck.spawn` + EYE_HEIGHT) in the real battle scene with a baked classic fleet and five enemy wrecks,
 * tiered like `GameWorld` on deck. One screenshot per class plus the deck under Squall and Moonlit night, and the
 * Medium draw budget (≤ 350) checked on the heaviest view.
 */
const CLASSES = ['sloop', 'brigantine', 'frigate', 'galleon', 'man-o-war'] as const

async function settle(page: Page, url: string) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(url)
  await expect(page.getByTestId('ocean-canvas').locator('canvas')).toBeVisible()
  await page.waitForFunction(() => (window.__perf?.stats?.frames ?? 0) > 40, null, { timeout: 120_000 })
  expect(errors).toEqual([])
}

for (const ship of CLASSES) {
  test(`on deck at eye height: ${ship} (Medium, dressed, wrecks)`, async ({ page }) => {
    await settle(page, `/?deck-demo&ship=${ship}&look=fwd&perf&quality=medium&gpu=medium&wrecks=5`)
    await page.screenshot({ path: `test-results/deck-eye-${ship}.png` })
    const stats = await page.evaluate(() => ({ ...window.__perf!.stats }))
    expect(stats.drawCalls, `${ship} Medium on-deck draws`).toBeLessThanOrEqual(350)
    expect(stats.triangles, `${ship} Medium on-deck triangles`).toBeLessThanOrEqual(300_000)
  })
}

test('on deck under Squall: rain at eye height does not fill the screen, horizon still reads', async ({ page }) => {
  await settle(page, '/?deck-demo&ship=man-o-war&look=port&weather=squall&perf&quality=medium&gpu=medium&wrecks=5')
  await page.screenshot({ path: 'test-results/deck-eye-squall.png' })
})

test('on deck at Moonlit night: deck readable, stars and lanterns', async ({ page }) => {
  await settle(page, '/?deck-demo&ship=galleon&look=rail&tod=0.98&perf&quality=medium&gpu=medium&wrecks=5')
  await page.screenshot({ path: 'test-results/deck-eye-night.png' })
})

test('deck demo without dressing renders the same scene (overview path untouched)', async ({ page }) => {
  await settle(page, '/?deck-demo&ship=frigate&look=fwd&dressed=0&perf&quality=medium&gpu=medium')
  const dressed = await page.evaluate(() => {
    let n = 0
    const scene = window.__perf!.scene() as { traverse: (fn: (o: { name: string }) => void) => void }
    scene.traverse((o) => { if (o.name === 'deck-dressing') n++ })
    return n
  })
  expect(dressed).toBe(0)
})
