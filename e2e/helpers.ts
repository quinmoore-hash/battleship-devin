import type { Page } from '@playwright/test'

/** Menu step 1 (Single player) → step 2 (Rules of engagement, left as they are) → step 3 (the Wanted poster). */
export async function startSinglePlayer(page: Page, difficulty: 'easy' | 'medium' | 'hard') {
  await page.getByTestId('mode-single').click()
  await page.getByTestId('rules-next').click()
  await page.getByTestId(`difficulty-${difficulty}`).click()
}

/** Menu step 1 (Two captains) → step 2 → the captains' names → placement. */
export async function startTwoCaptains(page: Page, names: { human?: string; enemy?: string } = {}) {
  await page.getByTestId('mode-two').click()
  await page.getByTestId('rules-next').click()
  if (names.human !== undefined) await page.getByTestId('captain-1-name').fill(names.human)
  if (names.enemy !== undefined) await page.getByTestId('captain-2-name').fill(names.enemy)
  await page.getByTestId('names-start').click()
}
