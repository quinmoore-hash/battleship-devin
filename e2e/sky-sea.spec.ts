import { expect, test } from '@playwright/test'

test('Sky & sea picker: corner control in the menu applies instantly, persists, and is mirrored in Settings', async ({ page }) => {
  await page.goto('/?no3d')
  const root = page.getByTestId('ui-root')
  await expect(page.getByTestId('main-menu').getByTestId('skysea-picker')).toBeVisible()
  await expect(root).toHaveAttribute('data-tod', 'golden')
  await expect(root).toHaveAttribute('data-weather', 'calm')

  await page.getByTestId('skysea-time').selectOption('night')
  await page.getByTestId('skysea-weather').selectOption('squall')
  await expect(root).toHaveAttribute('data-tod', 'night')
  await expect(root).toHaveAttribute('data-weather', 'squall')

  await page.reload()
  await expect(root).toHaveAttribute('data-tod', 'night')
  await expect(root).toHaveAttribute('data-weather', 'squall')

  // same control inside Settings, both in the menu and in-game
  await page.getByTestId('open-settings').click()
  const settings = page.getByTestId('settings')
  await expect(settings.getByTestId('skysea-time')).toHaveValue('night')
  await settings.getByTestId('skysea-time').selectOption('dawn')
  await settings.getByTestId('skysea-weather').selectOption('overcast')
  await page.getByTestId('settings-close').click()
  await expect(root).toHaveAttribute('data-tod', 'dawn')
  await expect(root).toHaveAttribute('data-weather', 'overcast')
})

test('Sky & sea: URL params win for the visit; Stormy seas locks the weather on "Stormy seas"', async ({ page }) => {
  await page.goto('/?no3d&tod=dusk&weather=squall')
  const root = page.getByTestId('ui-root')
  await expect(root).toHaveAttribute('data-tod', 'dusk')
  await expect(root).toHaveAttribute('data-weather', 'squall')

  // the rules dock is menu step 2; the Sky & sea corner picker stays on every step
  await page.getByTestId('mode-single').click()
  await page.getByTestId('mode-storm').check()
  await expect(root).toHaveAttribute('data-weather', 'stormy')
  const weather = page.getByTestId('main-menu').getByTestId('skysea-weather')
  await expect(weather).toBeDisabled()
  await expect(weather).toHaveValue('stormy')
  await expect(weather.locator('option:checked')).toHaveText('Stormy seas')

  await page.getByTestId('mode-storm').uncheck()
  await expect(weather).toBeEnabled()
  await expect(root).toHaveAttribute('data-weather', 'squall')
})
