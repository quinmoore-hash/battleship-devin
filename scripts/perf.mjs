// `npm run perf` — loads `?perf-demo` (10 ships + ocean + HUD) at each quality tier in Chromium and
// prints median FPS / draw calls / triangles. Needs a built app: run `npm run build` first (or set
// PERF_URL to a running dev/preview server). On GPU-less machines (SwiftShader) the absolute FPS is
// meaningless; compare tiers relative to each other.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const TIERS = ['low', 'medium', 'high']
const SECONDS = Number(process.env.PERF_SECONDS ?? 6)
const base = process.env.PERF_URL ?? 'http://localhost:4173'

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

// PERF_HEADED=1 runs a headed Chromium (e.g. under `xvfb-run`) — headless SwiftShader drops the WebGL context on heavy scenes
const browser = await chromium.launch({
  headless: process.env.PERF_HEADED !== '1',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'],
})
// PERF_FRAMES / PERF_TIMEOUT_MS: frames to collect per tier and how long to wait for them (software GL renders ~0.5 fps)
const FRAMES = Number(process.env.PERF_FRAMES ?? 60)
const TIMEOUT_MS = Number(process.env.PERF_TIMEOUT_MS ?? 120_000)
const rows = []
try {
  for (const tier of TIERS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    await page.goto(`${base}/?perf-demo&perf&quality=${tier}&view=battle`)
    await page.getByTestId('perf-tier').waitFor()
    await page.waitForFunction((n) => (window.__perf?.stats.frames ?? 0) > n, FRAMES, { timeout: TIMEOUT_MS })
    await page.evaluate(() => window.__perf.reset())
    await sleep(SECONDS * 1000)
    const s = await page.evaluate(() => ({ ...window.__perf.summary(), tier: window.__perf.tier(), heapMb: Math.round(window.__perf.stats.heapMb) }))
    rows.push({ tier, medianFps: s.medianFps, minFps: s.minFps, drawCalls: s.medianDrawCalls, triangles: s.triangles, heapMb: s.heapMb, frames: s.frames })
    await page.close()
  }
} finally {
  await browser.close()
  preview?.kill()
}
const renderer = rows.length ? 'see ?perf overlay for the renderer string' : ''
console.log(`perf-demo (${SECONDS}s per tier, 1280x720) ${renderer}`)
console.table(rows)
console.log('| tier | median FPS | min FPS | draw calls | triangles | heap MB |\n|---|---|---|---|---|---|')
for (const r of rows) console.log(`| ${r.tier} | ${r.medianFps} | ${r.minFps} | ${r.drawCalls} | ${r.triangles} | ${r.heapMb} |`)
