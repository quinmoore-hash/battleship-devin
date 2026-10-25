import { expect, test, type Page } from '@playwright/test'

async function unlock(page: Page) {
  await page.goto('/?audio-demo')
  await expect(page.getByTestId('audio-demo')).toBeVisible()
  await page.getByRole('heading', { name: /audio review/ }).click()
  await expect(page.getByTestId('audio-demo-locked')).toBeHidden()
}

test('audio demo lists every sound with its variants and plays them without console errors', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
  await unlock(page)

  const sfx = page.locator('[data-testid^="audio-demo-sfx-"]')
  await expect(sfx).toHaveCount(20)
  await expect(page.getByTestId('audio-demo-sfx-cannon-fire').getByRole('button')).toHaveCount(3)
  await expect(page.getByTestId('audio-demo-sfx-splash-miss').getByRole('button')).toHaveCount(3)
  await expect(page.getByTestId('audio-demo-sfx-impact-wood').getByRole('button')).toHaveCount(3)
  await page.getByRole('button', { name: 'Play cannon-fire variant 2' }).click()
  await page.getByRole('button', { name: 'Play thunder' }).click()

  const loopBtn = page.getByTestId('audio-demo-sfx-fire-loop').getByRole('button')
  await loopBtn.click()
  await expect(loopBtn).toHaveText('Stop')
  await loopBtn.click()
  await expect(loopBtn).toHaveText('Loop')

  expect(errors).toEqual([])
})

test('music variants crossfade, ambience + storm layer toggle, broadside sequence logs cues in order', async ({ page }) => {
  await unlock(page)
  await page.getByTestId('audio-demo-music-menu').click()
  await expect(page.getByTestId('audio-demo-music-menu')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('audio-demo-music-battle').click()
  await expect(page.getByTestId('audio-demo-music-battle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('audio-demo-music-menu')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('audio-demo-runtime')).toContainText('music: battle')

  await page.getByTestId('audio-demo-ambience').click()
  await expect(page.getByTestId('audio-demo-runtime')).toContainText('ambience: on, storm 0%')
  await page.getByTestId('audio-demo-storm').fill('0.6')
  await expect(page.getByTestId('audio-demo-runtime')).toContainText('storm 60%')

  await page.getByTestId('audio-demo-broadside').click()
  const log = page.getByTestId('audio-demo-log')
  await expect(log).toContainText('cannon-fire')
  await expect(log).toContainText('cannon-whistle')
  await expect(log).toContainText('splash-miss', { timeout: 5000 })
  await expect(log).toContainText('impact-wood')
  await expect(log).toContainText('sinking-groan', { timeout: 6000 })
  await expect(page.getByTestId('audio-demo-runtime')).toContainText('(ducked)')

  await page.getByTestId('audio-demo-music-stop').click()
  await expect(page.getByTestId('audio-demo-runtime')).toContainText('music: off')
})

test('spatial pad reports pan/gain and the mixer persists across reloads', async ({ page }) => {
  await unlock(page)
  const pad = page.getByTestId('audio-demo-pad')
  const box = (await pad.boundingBox())!
  await pad.click({ position: { x: box.width * 0.05, y: box.height * 0.8 } })
  await expect(page.getByTestId('audio-demo-spatial')).toContainText(/pan:\s+-0\.\d+/)
  await pad.click({ position: { x: box.width * 0.95, y: box.height * 0.1 } })
  await expect(page.getByTestId('audio-demo-spatial')).toContainText(/pan:\s+0\.\d+/)

  await page.getByTestId('audio-master-volume').fill('0.4')
  await page.getByTestId('audio-ambience-volume').fill('0.25')
  await page.getByTestId('audio-mute').click()
  await expect(page.getByTestId('audio-demo-persisted')).toContainText('"muted":true')
  await page.reload()
  await expect(page.getByTestId('audio-demo')).toBeVisible()
  await expect(page.getByTestId('audio-mute')).toHaveText('Unmute')
  await expect(page.getByTestId('audio-master-volume')).toHaveValue('0.4')
  await expect(page.getByTestId('audio-ambience-volume')).toHaveValue('0.25')
  const stored = await page.evaluate(() => localStorage.getItem('battleship-devin.audio'))
  expect(JSON.parse(stored!)).toMatchObject({ version: 2, state: { masterVolume: 0.4, ambienceVolume: 0.25, muted: true } })
})
