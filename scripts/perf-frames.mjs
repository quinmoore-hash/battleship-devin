// `node scripts/perf-frames.mjs` — plays N turns on one tier and records EVERY rendered frame's draw
// calls plus a white-canvas probe (readPixels on the composited frame), so one-frame spikes / blow-outs
// (BUG-223 / BUG-503) show up even though `perf:game` only samples a frame per checkpoint.
// Needs a built app or PERF_URL. GPU-less VM: PERF_HEADED=1 under xvfb-run (SwiftShader).
//   PERF_TIER=high PERF_SHOTS=24 PERF_CINEMATICS=full PERF_FRAMES_OUT=frames.json PERF_SHOT_DIR=dir
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const tier = process.env.PERF_TIER ?? 'high'
const SHOTS = Number(process.env.PERF_SHOTS ?? 24)
const CINE = process.env.PERF_CINEMATICS ?? 'full'
const SPIKE = Number(process.env.PERF_SPIKE ?? 600)
const base = process.env.PERF_URL ?? 'http://localhost:4173'
const SHOT_DIR = process.env.PERF_SHOT_DIR ?? ''
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })

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
const press = async (page, id) => {
  const el = page.getByTestId(id)
  await el.waitFor({ timeout: 60_000 })
  await page.waitForFunction((id) => { const b = document.querySelector(`[data-testid="${id}"]`); return b && !b.disabled }, id, { timeout: 60_000 })
  await el.evaluate((b) => b.click())
}

const browser = await chromium.launch({
  headless: process.env.PERF_HEADED !== '1',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript((cine) => {
  localStorage.setItem('battleship-devin.settings', JSON.stringify({ cinematics: cine, sfxVolume: 0, musicVolume: 0, reducedMotion: false }))
  localStorage.setItem('battleship-devin.ui', JSON.stringify({ state: { hintsSeen: ['placement', 'battle'] }, version: 1 }))
}, CINE)
page.on('console', (m) => { if (/^\[(frames|bake)\]/.test(m.text())) console.log(m.text()) })

const summary = async () => page.evaluate(() => window.__frames.summary())

try {
  await page.goto(`${base}/?perf&quality=${tier}&gpu=${tier}`)
  await page.getByTestId('main-menu').waitFor({ timeout: 60_000 })
  await page.waitForFunction(() => !!window.__perf?.gl(), null, { timeout: 60_000 })
  // per-frame probe: runs after r3f's render in the same rAF turn (registered later), reads the
  // composited default framebuffer before the browser presents it
  await page.evaluate((spike) => {
    const gl = window.__perf.gl()
    const ctx = gl.getContext()
    const px = new Uint8Array(4 * 64)
    const frames = []
    const whites = []
    const spikes = []
    const objects = []
    const orig = gl.renderBufferDirect.bind(gl)
    gl.renderBufferDirect = (cam, scene, geo, mat, obj, group) => {
      let n = obj
      const path = []
      while (n && path.length < 4) {
        if (n.name) path.push(n.name)
        n = n.parent
      }
      objects.push(`${path.reverse().join('/') || obj.type}|${mat.type}${mat.name ? ':' + mat.name : ''}`)
      return orig(cam, scene, geo, mat, obj, group)
    }
    let last = -1
    const probe = () => {
      requestAnimationFrame(probe)
      const st = window.__perf.stats
      if (st.frames === last) return
      last = st.frames
      const calls = st.drawCalls
      gl.setRenderTarget(null)
      const w = ctx.drawingBufferWidth, h = ctx.drawingBufferHeight
      let white = 0, nan = 0
      for (let i = 0; i < 64; i++) {
        ctx.readPixels(Math.floor(((i % 8) + 0.5) * w / 8), Math.floor((Math.floor(i / 8) + 0.5) * h / 8), 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px, i * 4)
        if (px[i * 4] >= 250 && px[i * 4 + 1] >= 250 && px[i * 4 + 2] >= 250) white++
        if (px[i * 4] === 0 && px[i * 4 + 1] === 0 && px[i * 4 + 2] === 0) nan++
      }
      const row = { f: st.frames, calls, white: white / 64, black: nan / 64, phase: document.querySelector('[data-testid=ui-root]')?.getAttribute('data-phase'), shot: window.__frames.shot }
      frames.push(row)
      const bad = row.white > 0.9 || calls > spike
      if (bad && whites.length + spikes.length < 6) {
        const counts = {}
        for (const o of objects) counts[o] = (counts[o] ?? 0) + 1
        const detail = { ...row, objects: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 40), png: whites.length < 3 ? ctx.canvas.toDataURL('image/png') : null }
        ;(row.white > 0.9 ? whites : spikes).push(detail)
        console.info('[frames] bad frame', JSON.stringify({ ...row, top: detail.objects.slice(0, 8) }))
      }
      window.__frames.last = objects.slice()
      objects.length = 0
    }
    requestAnimationFrame(probe)
    window.__frames = {
      shot: 0,
      last: [],
      lastCounts: () => {
        const counts = {}
        for (const o of window.__frames.last) counts[o] = (counts[o] ?? 0) + 1
        return Object.entries(counts).sort((a, b) => b[1] - a[1])
      },
      summary: () => {
        const battle = frames.filter((r) => r.phase === 'battle')
        const calls = battle.map((r) => r.calls)
        return { frames: frames.length, battleFrames: battle.length, maxCalls: Math.max(...calls), meanCalls: Math.round(calls.reduce((a, b) => a + b, 0) / Math.max(1, calls.length)), whiteFrames: frames.filter((r) => r.white > 0.9).length, spikeFrames: battle.filter((r) => r.calls > spike).length, whites: whites.map((w) => ({ ...w, png: undefined })), spikes, pngs: whites.map((w) => w.png).filter(Boolean), hist: frames.map((r) => r.calls) }
      },
    }
  }, SPIKE)
  await press(page, 'difficulty-easy')
  await page.getByTestId('placement').waitFor({ timeout: 60_000 })
  await press(page, 'auto-place')
  await press(page, 'confirm-placement')
  await page.getByTestId('battle').waitFor({ timeout: 60_000 })
  const yourTurn = () => page.getByTestId('status').filter({ hasText: /your turn/i }).waitFor({ timeout: 120_000 })
  await yourTurn()
  let fired = 0
  const cells = []
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) cells.push([x, y])
  for (const [x, y] of cells) {
    if (fired >= SHOTS) break
    if ((await page.getByTestId('ui-root').getAttribute('data-phase')) !== 'battle') break
    const cell = page.getByTestId(`enemy-grid-${x}-${y}`)
    if ((await cell.getAttribute('data-state')) && (await cell.getAttribute('data-state')) !== 'unknown') continue
    await cell.click({ force: true })
    fired++
    await page.evaluate((n) => { window.__frames.shot = n }, fired)
    const confirm = page.getByTestId('fire-confirm-yes')
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await Promise.race([yourTurn(), page.getByTestId('gameover').waitFor({ timeout: 120_000 })])
    if (SHOT_DIR && fired % 5 === 0) await page.screenshot({ path: `${SHOT_DIR}/${tier}-turn-${fired}.png` })
  }
  const s = await summary()
  if (process.env.PERF_DUMP === '1') {
    const counts = await page.evaluate(() => window.__frames.lastCounts())
    console.log(`[frames] last frame draws by object (${counts.reduce((a, c) => a + c[1], 0)} total):`)
    for (const [k, n] of counts.slice(0, 60)) console.log(`  ${String(n).padStart(4)}  ${k}`)
  }
  console.log(`[frames] tier=${tier} turns=${fired} frames=${s.frames} battleFrames=${s.battleFrames} maxCalls=${s.maxCalls} meanCalls=${s.meanCalls} whiteFrames=${s.whiteFrames} spikeFrames(>${SPIKE})=${s.spikeFrames}`)
  for (const w of s.whites) console.log('[frames] WHITE', JSON.stringify({ ...w, objects: w.objects.slice(0, 15) }))
  for (const w of s.spikes) console.log('[frames] SPIKE', JSON.stringify({ ...w, objects: w.objects.slice(0, 15) }))
  if (SHOT_DIR) s.pngs.forEach((p, i) => writeFileSync(`${SHOT_DIR}/${tier}-white-${i}.png`, Buffer.from(p.split(',')[1], 'base64')))
  if (process.env.PERF_FRAMES_OUT) writeFileSync(process.env.PERF_FRAMES_OUT, JSON.stringify(s, null, 2))
} finally {
  await browser.close()
  preview?.kill()
}
