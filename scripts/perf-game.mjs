// `npm run perf:game` — plays the real game in Chromium with `?perf` and records renderer.info /
// heap at each checkpoint (menu, placement with 5 ships, battle start, after 30 / 60 shots, after a
// rematch) for one tier. Needs a built app (`npm run build`) or PERF_URL pointing at a server.
// GPU-less VM: PERF_HEADED=1 under `xvfb-run -a -s "-screen 0 1440x900x24"` (SwiftShader).
//   PERF_TIER=medium|low|high  PERF_SHOTS=60  PERF_VIEWPORT=1440x900  PERF_OUT=perf-medium.json
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const tier = process.env.PERF_TIER ?? 'medium'
const SHOTS = Number(process.env.PERF_SHOTS ?? 60)
const [vw, vh] = (process.env.PERF_VIEWPORT ?? '1440x900').split('x').map(Number)
const base = process.env.PERF_URL ?? 'http://localhost:4173'
const SHOT_DIR = process.env.PERF_SHOT_DIR ?? ''

let preview
if (!process.env.PERF_URL) {
  preview = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
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
  headless: process.env.PERF_HEADED !== '1',
  executablePath: process.env.PERF_CHROME || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
})
const page = await browser.newPage({ viewport: { width: vw, height: vh } })
// fast turns: cinematics off, Easy, sfx muted
await page.addInitScript(() => {
  localStorage.setItem('battleship-devin.settings', JSON.stringify({ cinematics: 'off', sfxVolume: 0, musicVolume: 0, reducedMotion: false }))
  localStorage.setItem('battleship-devin.ui', JSON.stringify({ state: { dismissedHints: ['placement', 'battle'] }, version: 0 }))
})
const rows = []
page.on('console', (m) => { if (m.text().startsWith('[bake]')) console.log(m.text()) })
const snap = async (label) => {
  // let a few frames render so gl.info reflects the new scene
  const f0 = await page.evaluate(() => window.__perf?.stats.frames ?? 0)
  await page.waitForFunction((n) => (window.__perf?.stats.frames ?? 0) > n + 3, f0, { timeout: 120_000 }).catch(() => {})
  const s = await page.evaluate(() => {
    const st = window.__perf.stats
    const mem = performance.memory
    return { tier: window.__perf.tier(), drawCalls: st.drawCalls, triangles: st.triangles, geometries: st.geometries, textures: st.textures, programs: st.programs, heapMb: mem ? Math.round(mem.usedJSHeapSize / 1048576) : -1, frameMs: Math.round(st.frameMs), jsMs: Math.round((st.jsMs ?? -1) * 100) / 100, renderMs: Math.round(st.renderMs ?? -1) }
  })
  rows.push({ label, ...s })
  console.log(label, JSON.stringify(s))
  if (process.env.PERF_DUMP) {
    const dump = await page.evaluate(() => window.__perf.dump().slice(0, 200))
    console.log(`  dump total: ${dump.reduce((a, d) => a + d.draws, 0)} draws ${dump.reduce((a, d) => a + d.tris, 0)} tris in ${dump.length} rows`)
    for (const d of dump) console.log(`  dump ${d.tris.toString().padStart(7)} tris ${d.draws.toString().padStart(4)} draws ${d.castShadow ? 'S ' : '  '}${d.path} ${d.type}`)
    const progs = await page.evaluate(() => window.__perf.programs().slice(0, 12))
    for (const p of progs) console.log(`  prog x${p.programs} used ${p.usedTimes} ${p.key.slice(0, 160)}`)
  }
  if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/${tier}-${label.replace(/\W+/g, '_')}.png` })
}
const yourTurn = async () => {
  await page.getByTestId('status').filter({ hasText: /your turn/i }).waitFor({ timeout: 120_000 })
}
try {
  await page.goto(`${base}/?perf&quality=${tier}&gpu=${tier}`)
  await page.getByTestId('main-menu').waitFor({ timeout: 60_000 })
  await page.waitForFunction(() => (window.__perf?.stats.frames ?? 0) > 15, null, { timeout: 120_000 })
  await snap('menu')
  await page.getByTestId('difficulty-easy').click()
  await page.getByTestId('placement').waitFor()
  await page.getByTestId('auto-place').click()
  await page.getByTestId('placed-count').filter({ hasText: /5/ }).waitFor({ timeout: 30_000 }).catch(() => {})
  await snap('placement-5-ships')
  if (process.env.PERF_STOP === 'placement') throw new Error('stop')
  await page.getByTestId('confirm-placement').click()
  await page.getByTestId('battle').waitFor({ timeout: 60_000 })
  await yourTurn()
  await snap('battle-start')
  let fired = 0
  const cells = []
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) cells.push([x, y])
  // row-major sweep hits ships early; alternate rows for a realistic mix
  for (const [x, y] of cells) {
    if (fired >= SHOTS) break
    if ((await page.getByTestId('ui-root').getAttribute('data-phase')) !== 'battle') break
    const cell = page.getByTestId(`enemy-grid-${x}-${y}`)
    if ((await cell.getAttribute('data-state')) && (await cell.getAttribute('data-state')) !== 'unknown') continue
    await cell.click({ force: true })
    fired++
    const confirm = page.getByTestId('fire-confirm-yes')
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await Promise.race([yourTurn(), page.getByTestId('gameover').waitFor({ timeout: 120_000 })])
    if (fired === 30) await snap('after-30-shots')
  }
  await snap(`after-${fired}-shots`)
  if ((await page.getByTestId('ui-root').getAttribute('data-phase')) === 'battle') await page.getByTestId('quit').click().catch(() => {})
  const quitConfirm = page.getByTestId('quit-confirm')
  if (await quitConfirm.isVisible().catch(() => false)) await quitConfirm.click()
  const rematch = page.getByTestId('rematch')
  if (await rematch.isVisible().catch(() => false)) {
    await rematch.click()
  } else {
    await page.getByTestId('main-menu').waitFor({ timeout: 60_000 })
    await snap('menu-after-game')
    await page.getByTestId('difficulty-easy').click()
  }
  await page.getByTestId('placement').waitFor({ timeout: 60_000 })
  await page.getByTestId('auto-place').click()
  await page.getByTestId('confirm-placement').click()
  await page.getByTestId('battle').waitFor({ timeout: 60_000 })
  await yourTurn()
  await snap('rematch-battle-start')
} finally {
  if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify(rows, null, 2))
  console.log('| checkpoint | tier | draw calls | triangles | geometries | textures | programs | heap MB | JS ms/frame | gl ms |\n|---|---|---|---|---|---|---|---|---|---|')
  for (const r of rows) console.log(`| ${r.label} | ${r.tier} | ${r.drawCalls} | ${r.triangles} | ${r.geometries} | ${r.textures} | ${r.programs} | ${r.heapMb} | ${r.jsMs} | ${r.renderMs} |`)
  await browser.close()
  preview?.kill()
}
