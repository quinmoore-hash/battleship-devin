// Headed-browser driver for the Third-person seat (GPU-less VM: `xvfb-run -a -s "-screen 0 1440x900x24" node scripts/third-person-shots.mjs`).
// Plays menu → placement → battle, toggles V and walks / jumps / mans / fires / Tabs / toggles, screenshotting each step
// and printing `window.__perf.stats` draws / tris. Env: TP_URL (default http://localhost:4173), TP_OUT (dir), TP_MODE=single|hotseat|second,
// TP_VIEWPORT=1440x900, TP_TIER=medium, TP_HEADLESS=1.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.TP_URL ?? 'http://localhost:4173'
const out = process.env.TP_OUT ?? 'test-results/third-person'
const mode = process.env.TP_MODE ?? 'single'
const [vw, vh] = (process.env.TP_VIEWPORT ?? '1440x900').split('x').map(Number)
const tier = process.env.TP_TIER ?? 'medium'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ headless: process.env.TP_HEADLESS === '1', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: vw, height: vh } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => (m.type() === 'error' ? errors.push(m.text()) : null))
await page.addInitScript(() => {
  localStorage.setItem('battleship-devin.settings', JSON.stringify({ cinematics: 'off', sfxVolume: 0, musicVolume: 0 }))
  localStorage.setItem('battleship-devin.ui', JSON.stringify({ state: { hintsSeen: ['placement', 'battle'] }, version: 1 }))
})
let n = 0
const shot = async (name) => {
  n++
  const file = `${out}/${String(n).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: file })
  const st = await page.evaluate(() => (window.__perf ? { d: window.__perf.stats.drawCalls, t: window.__perf.stats.triangles } : null)).catch(() => null)
  const ship = await page.getByTestId('deck-ship-name').textContent().catch(() => '')
  const station = await page.getByTestId('deck-station').textContent().catch(() => '')
  const view = await page.getByTestId('deck-hud').getAttribute('data-view').catch(() => '')
  console.log(`${file}  draws=${st?.d ?? '?'} tris=${st?.t ?? '?'}  ship=${ship} ${station} view=${view}`)
}
const frames = async (k = 3) => {
  const f0 = await page.evaluate(() => window.__perf?.stats.frames ?? 0)
  await page.waitForFunction((n) => (window.__perf?.stats.frames ?? 0) > n + 3, f0 + k - 3, { timeout: 60_000 }).catch(() => {})
}
const hold = async (keys, ms) => {
  for (const k of keys) await page.keyboard.down(k)
  await page.waitForTimeout(ms)
  for (const k of keys) await page.keyboard.up(k)
}

await page.goto(`${base}/?quality=${tier}&gpu=${tier}&perf`)
await page.getByTestId('main-menu').waitFor({ timeout: 60_000 })
if (mode === 'hotseat') {
  await page.getByTestId('mode-two').click()
  await page.getByTestId('rules-next').click()
  await page.getByTestId('names-start').click()
  await page.getByTestId('handoff-ready').click().catch(() => {})
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click({ noWaitAfter: true })
  await page.getByTestId('handoff-ready').click({ timeout: 30_000 })
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click({ noWaitAfter: true })
  await page.getByTestId('handoff-ready').click({ timeout: 30_000 })
} else {
  await page.getByTestId('mode-single').click()
  await page.getByTestId('rules-next').click()
  await page.getByTestId('difficulty-easy').click()
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click({ noWaitAfter: true })
}
await page.getByTestId('battle').waitFor({ timeout: 60_000 })
await page.waitForTimeout(1500)
await frames(3)
await shot('overview')

await page.keyboard.press('v')
await frames(4)
await shot('third-person-spawn')
await hold(['w'], 1500)
await frames(2)
await shot('walk-forward')
await hold(['a'], 1500)
await frames(2)
await shot('walk-left-rail')
await hold(['s'], 2500)
await frames(2)
await shot('walk-back')
await hold(['d'], 2500)
await frames(2)
await shot('walk-right-rail')
await hold(['Shift', 'w'], 1200)
await frames(2)
await shot('run')
// jump, and try to jump the rail
await page.keyboard.press('Space')
await page.waitForTimeout(180)
await shot('jump-apex')
for (let i = 0; i < 4; i++) {
  await page.keyboard.down('d')
  await page.keyboard.press('Space')
  await page.waitForTimeout(350)
  await page.keyboard.up('d')
}
await frames(2)
await shot('rail-jump-attempt')
// drag to orbit
await page.mouse.move(vw / 2, vh / 2)
await page.mouse.down()
await page.mouse.move(vw / 2 - 250, vh / 2 + 40, { steps: 6 })
await page.mouse.up()
await frames(2)
await shot('orbit-drag')
// man the nearest usable gun via the HUD (works from anywhere), then first person
await page.getByTestId('deck-man').click()
await page.waitForTimeout(700)
await frames(3)
await shot('first-person-gun')
if (mode !== 'hotseat') {
  // fire by the chart
  // the shot log lives in the header 'Log' drawer since #52: count the player's shots on the chart instead
  const shots0 = await page.locator('[data-testid^="enemy-grid-"][data-state]:not([data-state="unknown"])').count()
  await page.getByTestId('enemy-grid-0-0').click()
  await page.waitForTimeout(600)
  await shot('fired-via-chart')
  const shots1 = await page.locator('[data-testid^="enemy-grid-"][data-state]:not([data-state="unknown"])').count()
  console.log('shot fired via chart:', shots1 > shots0, shots0, '->', shots1)
  await page.getByTestId('status').getByText(/Your turn/).waitFor({ timeout: 60_000 }).catch(() => {})
}
await page.keyboard.press('e')
await page.waitForTimeout(600)
await frames(2)
await shot('step-away')
// Tab through the fleet
const seen = new Set()
seen.add((await page.getByTestId('deck-ship-name').textContent()) ?? '')
for (let i = 0; i < 5; i++) {
  const prev = (await page.getByTestId('deck-ship-name').textContent()) ?? ''
  await page.getByTestId('deck-next-ship').click()
  await page.waitForFunction((p) => document.querySelector('[data-testid="deck-ship-name"]')?.textContent !== p, prev, { timeout: 30_000 }).catch(() => {})
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="deck-fade"]')?.style.opacity ?? 1) < 0.05, null, { timeout: 30_000 }).catch(() => {})
  await frames(3)
  const name = (await page.getByTestId('deck-ship-name').textContent()) ?? ''
  if (seen.has(name)) break
  seen.add(name)
  await shot(`ship-${name.replace(/[^a-z]/gi, '').toLowerCase()}`)
  await hold(['w'], 800)
  await hold(['a'], 1200)
  await frames(2)
  await shot(`ship-${name.replace(/[^a-z]/gi, '').toLowerCase()}-rail`)
}
// V five times fast
for (let i = 0; i < 5; i++) {
  await page.keyboard.press('v')
  await page.waitForTimeout(120)
}
await frames(3)
const onAfter = await page.getByTestId('deck-toggle').getAttribute('data-on')
console.log('deck on after 5 toggles:', onAfter)
if (onAfter !== 'true') await page.keyboard.press('v')
await frames(3)
await shot('after-five-toggles')
if (mode === 'hotseat') {
  // fire (pass the deck) with the mode on, drop the curtain, check the next captain's overview and ours restored
  await page.getByTestId('deck-man').click()
  await page.waitForTimeout(500)
  await page.getByTestId('enemy-grid-2-2').click()
  await page.getByTestId('handoff').waitFor({ timeout: 60_000 })
  await frames(2)
  await shot('hotseat-curtain')
  await page.getByTestId('handoff-ready').click({ timeout: 60_000 })
  await frames(3)
  await shot('hotseat-second-captain-overview')
  console.log('captain 2 deck on:', await page.getByTestId('deck-toggle').getAttribute('data-on'))
  await page.keyboard.press('v')
  await frames(4)
  await shot('hotseat-second-captain-deck')
  await page.getByTestId('deck-man').click()
  await page.waitForTimeout(500)
  await page.getByTestId('enemy-grid-3-3').click()
  await page.getByTestId('handoff').waitFor({ timeout: 60_000 })
  await page.getByTestId('handoff-ready').click({ timeout: 60_000 })
  await frames(4)
  console.log('captain 1 deck restored:', await page.getByTestId('deck-toggle').getAttribute('data-on'), 'view', await page.getByTestId('deck-hud').getAttribute('data-view'))
  await shot('hotseat-first-captain-restored')
}
if (mode === 'second') {
  // leave the game with the mode on and start another without reloading: the camera must stand on the new deck, no stuck HUD / fade
  await page.getByTestId('deck-man').click()
  await page.waitForTimeout(400)
  await page.getByTestId('quit').click()
  await page.getByTestId('quit-confirm').click()
  await page.getByTestId('main-menu').waitFor({ timeout: 60_000 })
  await page.getByTestId('mode-single').click()
  await page.getByTestId('rules-next').click()
  await page.getByTestId('difficulty-easy').click()
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click({ noWaitAfter: true })
  await page.getByTestId('battle').waitFor({ timeout: 60_000 })
  await frames(3)
  console.log('second game: deck on at start =', await page.getByTestId('deck-toggle').getAttribute('data-on'), 'fade =', await page.getByTestId('deck-fade').count())
  await page.keyboard.press('v')
  await frames(4)
  await shot('second-game-third-person')
  await page.getByTestId('deck-man').click()
  await page.waitForTimeout(700)
  await frames(3)
  await shot('second-game-gun')
  console.log('second game fade opacity =', await page.getByTestId('deck-fade').evaluate((e) => e.style.opacity))
}
await page.setViewportSize({ width: 1024, height: 700 })
await frames(3)
await shot('1024x700')
await page.setViewportSize({ width: 1280, height: 720 })
await frames(3)
await shot('1280x720')
console.log('page errors:', errors.length ? errors.slice(0, 10) : 'none')
await browser.close()
