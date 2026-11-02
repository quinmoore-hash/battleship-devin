// Headed-browser screenshot driver for the manned-gun first-person view (GPU-less VM: `xvfb-run -a -s "-screen 0 1440x900x24" node scripts/deck-gun-views.mjs`).
// Plays menu → placement → battle, presses V, then boards every ship of the fleet in turn and mans a set of on-deck stations per
// class via the perf hook (`window.__perf.store()`), screenshotting each. Env: TP_URL (default http://localhost:4173), TP_OUT (dir),
// TP_VIEWPORT=1440x900, TP_TIER=medium, TP_HEADLESS=1, TP_STATIONS=sloop:0,1;frigate:4,5 (defaults below), TP_SHIPS=frigate,galleon (default: the whole fleet).
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.TP_URL ?? 'http://localhost:4173'
const out = process.env.TP_OUT ?? 'test-results/deck-gun-views'
const [vw, vh] = (process.env.TP_VIEWPORT ?? '1440x900').split('x').map(Number)
const tier = process.env.TP_TIER ?? 'medium'
// on-deck station indices per class (lower gun decks / castle guns are not reachable): both broadsides, waist + ends
const DEFAULT_STATIONS = { sloop: [0, 1, 2], brigantine: [4, 5, 0, 10], frigate: [4, 5, 0, 10], galleon: [4, 5, 8, 9], manowar: [11, 26, 10, 13] }
const key = (name) => name.toLowerCase().replace(/[^a-z]/g, '')
const stationsFor = (name) => {
  const spec = process.env.TP_STATIONS?.split(';').map((s) => s.split(':')).find(([n]) => key(n) === key(name))
  return spec ? spec[1].split(',').map(Number) : (DEFAULT_STATIONS[key(name)] ?? [0, 1])
}
const onlyShips = process.env.TP_SHIPS?.split(',').map(key)
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
const frames = async (k = 4) => {
  const f0 = await page.evaluate(() => window.__perf?.stats.frames ?? 0)
  await page.waitForFunction((n) => (window.__perf?.stats.frames ?? 0) > n, f0 + k, { timeout: 60_000 }).catch(() => {})
}
const shot = async (name) => {
  await frames()
  const file = `${out}/${vw}x${vh}-${name}.png`
  await page.screenshot({ path: file })
  const st = await page.evaluate(() => (window.__perf ? { d: window.__perf.stats.drawCalls, t: window.__perf.stats.triangles } : null)).catch(() => null)
  const ship = await page.getByTestId('deck-ship-name').textContent().catch(() => '')
  const station = await page.getByTestId('deck-station').textContent().catch(() => '')
  console.log(`${file}  draws=${st?.d ?? '?'} tris=${st?.t ?? '?'}  ship=${ship} ${station}`)
}

await page.goto(`${base}/?quality=${tier}&gpu=${tier}&perf`)
await page.getByTestId('main-menu').waitFor({ timeout: 60_000 })
await page.getByTestId('mode-single').click()
await page.getByTestId('rules-next').click()
await page.getByTestId('difficulty-easy').click()
await page.getByTestId('auto-place').click()
await page.getByTestId('confirm-placement').click({ noWaitAfter: true })
await page.getByTestId('battle').waitFor({ timeout: 60_000 })
await page.waitForTimeout(1500)
await page.keyboard.press('v')
await page.getByTestId('deck-hud').waitFor({ timeout: 60_000 })
await frames(6)

const uids = await page.evaluate(() => window.__perf.store().getState().playerBoard.ships.map((s) => s.uid))
for (const uid of uids) {
  await page.evaluate((u) => window.__perf.store().getState().boardShip(u), uid)
  await frames(6)
  const name = (await page.getByTestId('deck-ship-name').textContent()) ?? uid
  if (onlyShips && !onlyShips.includes(key(name))) continue
  const slug = name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '')
  await shot(`${slug}-deck`)
  for (const i of stationsFor(name)) {
    await page.evaluate((idx) => window.__perf.store().getState().manStation(idx), i)
    await page.waitForTimeout(400)
    await shot(`${slug}-gun${String(i).padStart(2, '0')}`)
  }
  await page.evaluate(() => window.__perf.store().getState().manStation(null))
  await frames(2)
}
if (errors.length) console.log('page errors:\n' + errors.join('\n'))
await browser.close()
