// Headed spawn evidence (GPU-less VM: `xvfb-run -a -s "-screen 0 1440x900x24" node scripts/deck-spawn-evidence.mjs`).
// Single-player Classic; places the whole fleet TP_ORIENT=horizontal|vertical through the store, then V and Tab through the
// five ships, screenshotting the first frame and +5 s standing still. TP_WALK=1 also walks the Man-o'-War deck and prints
// the max draw calls. Env: TP_URL (default http://localhost:4173), TP_OUT.
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const base = process.env.TP_URL ?? 'http://localhost:4173'
const orient = process.env.TP_ORIENT ?? 'horizontal'
const out = process.env.TP_OUT ?? `test-results/spawn-${orient}`
const walk = process.env.TP_WALK === '1'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
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
  console.log(`${file}  draws=${st?.d ?? '?'} tris=${st?.t ?? '?'}  ship=${ship}`)
  return file
}
const frames = async (k = 3) => {
  const f0 = await page.evaluate(() => window.__perf?.stats.frames ?? 0)
  await page.waitForFunction((n) => (window.__perf?.stats.frames ?? 0) > n, f0 + k, { timeout: 60_000 }).catch(() => {})
}
const hold = async (keys, ms) => {
  for (const k of keys) await page.keyboard.down(k)
  await page.waitForTimeout(ms)
  for (const k of keys) await page.keyboard.up(k)
}
const shipName = async () => (await page.getByTestId('deck-ship-name').textContent().catch(() => '')) ?? ''

await page.goto(`${base}/?quality=medium&gpu=medium&perf`)
await page.getByTestId('main-menu').waitFor({ timeout: 60_000 })
await page.getByTestId('mode-single').click()
await page.getByTestId('rules-next').click()
await page.getByTestId('difficulty-easy').click()
await page.getByTestId('placement').waitFor({ timeout: 30_000 })
await page.waitForFunction(() => !!window.__perf?.store, null, { timeout: 30_000 })
const placed = await page.evaluate((o) => {
  const st = window.__perf.store().getState()
  // the two outer rows / columns, so no own ship sits in the first look of another one
  const at = o === 'horizontal'
    ? { 'man-o-war': { x: 0, y: 0 }, galleon: { x: 6, y: 0 }, frigate: { x: 0, y: 9 }, brigantine: { x: 4, y: 9 }, sloop: { x: 8, y: 9 } }
    : { 'man-o-war': { x: 0, y: 0 }, galleon: { x: 9, y: 0 }, frigate: { x: 0, y: 6 }, brigantine: { x: 9, y: 5 }, sloop: { x: 4, y: 8 } }
  return st.fleets.human.map((spec) => [spec.id, st.placePlayerShip(spec, at[spec.id], o)])
}, orient)
console.log('placed', orient, JSON.stringify(placed))
await page.getByTestId('confirm-placement').click({ noWaitAfter: true })
await page.getByTestId('battle').waitFor({ timeout: 60_000 })
await page.waitForTimeout(1500)
await frames(3)

await page.keyboard.press('v')
const seen = new Set()
for (let i = 0; i < 6; i++) {
  await frames(4)
  const name = await shipName()
  if (!name || seen.has(name)) break
  seen.add(name)
  const slug = name.replace(/[^a-z]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()
  await shot(`${slug}-${orient}-t0`)
  await page.waitForTimeout(5000)
  await shot(`${slug}-${orient}-t5`)
  await page.keyboard.press('Tab')
}

if (process.env.TP_VSHIP) {
  // Tab to the ship, leave the deck and board again with V: the first frame after V on that ship
  const re = new RegExp(process.env.TP_VSHIP, 'i')
  for (let i = 0; i < 6 && !re.test(await shipName()); i++) {
    await page.keyboard.press('Tab')
    await frames(3)
  }
  await page.keyboard.press('v')
  await frames(3)
  await page.keyboard.press('v')
  await frames(4)
  await shot(`${process.env.TP_VSHIP.toLowerCase()}-${orient}-after-v`)
  await page.waitForTimeout(5000)
  await shot(`${process.env.TP_VSHIP.toLowerCase()}-${orient}-after-v-t5`)
}
if (walk) {
  for (let i = 0; i < 6 && !/Man/.test(await shipName()); i++) {
    await page.keyboard.press('Tab')
    await frames(3)
  }
  await page.evaluate(() => {
    window.__dmax = 0
    window.__dint = setInterval(() => (window.__dmax = Math.max(window.__dmax, window.__perf?.stats.drawCalls ?? 0)), 40)
  })
  await shot('mow-walk-start')
  await hold(['w'], 7000)
  await shot('mow-walk-bow')
  await hold(['a'], 2000)
  await hold(['s'], 14000)
  await shot('mow-walk-stern')
  await hold(['d'], 3500)
  await hold(['w'], 7000)
  await shot('mow-walk-end')
  const dmax = await page.evaluate(() => (clearInterval(window.__dint), window.__dmax))
  console.log('man-o-war walk max draws:', dmax)
}
console.log('errors:', errors.length ? errors : 'none')
await browser.close()
