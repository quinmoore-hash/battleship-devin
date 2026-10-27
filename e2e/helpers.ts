import type { Page } from '@playwright/test'

/** Menu step 1 (Single player) → step 2 (Rules of engagement, left as they are) → step 3 (the Wanted poster). */
export async function startSinglePlayer(page: Page, difficulty: 'easy' | 'medium' | 'hard', rules: Array<'salvo' | 'storm' | 'black-flag'> = []) {
  await page.getByTestId('mode-single').click()
  for (const rule of rules) await page.getByTestId(`mode-${rule}`).check()
  await page.getByTestId('rules-next').click()
  await page.getByTestId(`difficulty-${difficulty}`).click()
}

export async function startTwoCaptains(page: Page, names: { human?: string; enemy?: string } = {}, rules: Array<'salvo' | 'storm' | 'black-flag'> = []) {
  await page.getByTestId('mode-two').click()
  for (const rule of rules) await page.getByTestId(`mode-${rule}`).check()
  await page.getByTestId('rules-next').click()
  if (names.human !== undefined) await page.getByTestId('captain-1-name').fill(names.human)
  if (names.enemy !== undefined) await page.getByTestId('captain-2-name').fill(names.enemy)
  await page.getByTestId('names-start').click()
}
