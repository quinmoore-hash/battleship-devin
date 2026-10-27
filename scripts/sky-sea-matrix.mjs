// Sky & sea perf matrix: one Medium battle, then every time × weather preset switched from Settings
// (uniform changes only) — asserts draw calls / triangles stay inside the Medium budget and the shader
// program count stays flat. Also measures Stormy seas (rule) vs Squall. Writes a contact sheet's worth of
// screenshots to SKY_SHOT_DIR. Usage: `npm run build && xvfb-run -a node scripts/sky-sea-matrix.mjs`
// (set SKY_HEADED=0 to try headless; SwiftShader WebGL is only reliable headed under Xvfb).
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from '@playwright/test'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const base = process.env.SKY_URL ?? 'http://localhost:4174'
const SHOT_DIR = process.env.SKY_SHOT_DIR ?? ''
const [vw, vh] = (process.env.SKY_VIEWPORT ?? '1440x900').split('x').map(Number)
const TIMES = ['dawn', 'noon', 'golden', 'dusk', 'night']
const WEATHERS = ['calm', 'overcast', 'squall']
const BUDGET = { drawCalls: 350, triangles: 250_000 }
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })

let preview
if (!process.env.SKY_URL) {
  preview = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { stdio: 'ignore' })
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(base)
      break
    } catch {
      await sleep(500)
    }
  }
}

const browser = await chromium.launch({
  headless: process.env.SKY_HEADED === '0',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const context = await browser.newContext({ viewport: { width: vw, height: vh } })
await context.addInitScript(() => {
  localStorage.setItem('battleship-devin.settings', JSON.stringify({ cinematics: 'off', sfxVolume: 0, musicVolume: 0, reducedMotion: false }))
  localStorage.setItem('battleship-devin.ui', JSON.stringify({ state: { hintsSeen: ['placement', 'battle'] }, version: 1 }))
})
const page = await context.newPage()

const stats = async () => {
  const f0 = await page.evaluate(() => window.__perf?.stats.frames ?? 0)
  await page.waitForFunction((n) => (window.__perf?.stats.frames ?? 0) > n + 4, f0, { timeout: 120_000 }).catch(() => {})
  return page.evaluate(() => {
    const st = window.__perf.stats
    return { drawCalls: st.drawCalls, triangles: st.triangles, programs: st.programs, keys: window.__perf.programs().map((p) => `${p.programs}×${p.key.slice(0, 90)}`) }
  })
}
const newKeys = (prev, next) => next.keys.filter((k) => !prev.keys.includes(k))
const shot = (name) => (SHOT_DIR ? page.screenshot({ path: `${SHOT_DIR}/${name}.png` }) : Promise.resolve())

const toBattle = async (storm) => {
  await page.goto(`${base}/?perf&quality=medium&gpu=medium`)
  await page.getByTestId('main-menu').waitFor({ timeout: 60_000 })
  await page.waitForFunction(() => (window.__perf?.stats.frames ?? 0) > 15, null, { timeout: 120_000 })
  if (storm) await page.getByTestId('mode-storm').check()
  await page.getByTestId('difficulty-easy').click()
  await page.getByTestId('placement').waitFor()
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await page.getByTestId('battle').waitFor({ timeout: 60_000 })
}
const pick = async (tod, weather) => {
  await page.getByTestId('nav-settings').click()
  await page.getByTestId('skysea-time').selectOption(tod)
  if (weather) await page.getByTestId('skysea-weather').selectOption(weather)
  await page.getByTestId('settings-close').click()
  await sleep(400)
}

const rows = []
let fail = false
await toBattle(false)
let prev = await stats()
const startPrograms = prev.programs
console.log(`programs at battle start: ${startPrograms}`)
// pass 1 warms up every lazily compiled program (rain's first frame, shadow-depth variants as the key light
// moves); pass 2 must be flat: switching presets is uniform changes only, never a new shader variant
for (let pass = 1; pass <= 2; pass++) {
  for (const tod of TIMES) {
    for (const weather of WEATHERS) {
      await pick(tod, weather)
      const s = await stats()
      if (s.programs !== prev.programs) console.log(`  pass ${pass} ${tod}/${weather}: programs ${prev.programs} → ${s.programs}; new: ${newKeys(prev, s).join(' | ') || '(none)'}`)
      prev = s
      if (pass === 1) continue
      await shot(`${tod}-${weather}`)
      const ok = s.drawCalls <= BUDGET.drawCalls && s.triangles <= BUDGET.triangles
      if (!ok) fail = true
      rows.push({ label: `${tod} / ${weather}`, drawCalls: s.drawCalls, triangles: s.triangles, programs: s.programs, ok })
    }
  }
}
const squall = rows.filter((r) => r.label.endsWith('/ squall'))
await toBattle(true)
const stormy = []
for (const tod of ['golden', 'night']) {
  await pick(tod)
  const s = await stats()
  await shot(`${tod}-stormy`)
  stormy.push(s)
  rows.push({ label: `${tod} / stormy (rule)`, drawCalls: s.drawCalls, triangles: s.triangles, programs: s.programs, ok: s.drawCalls <= BUDGET.drawCalls })
}
// draw calls wobble by ~±10 frame to frame (frustum culling of bobbing ships / props), so compare averages
const avg = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length)
const squallAvg = avg(squall.map((r) => r.drawCalls))
const stormyAvg = avg(stormy.map((r) => r.drawCalls))
console.log(`\nsquall avg ${squallAvg} draws vs stormy (rule) avg ${stormyAvg} draws`)
if (squallAvg > stormyAvg + 10) {
  fail = true
  console.log('FAIL: squall costs more draw calls than stormy')
}

console.log(`\nMedium ${vw}×${vh} — battle overview, programs at battle start: ${startPrograms}`)
console.log('| combo | draw calls | triangles | programs | ok |\n|---|---|---|---|---|')
for (const r of rows) console.log(`| ${r.label} | ${r.drawCalls} | ${r.triangles} | ${r.programs} | ${r.ok ? 'yes' : 'NO'} |`)
const progs = new Set(rows.filter((r) => !r.label.includes('rule')).map((r) => r.programs))
console.log(`programs across all 15 combos (pass 2): ${[...progs].join(', ')} ${progs.size === 1 ? '(flat)' : '(NOT FLAT)'}`)
if (progs.size !== 1) fail = true

await browser.close()
preview?.kill()
process.exit(fail ? 1 : 0)
