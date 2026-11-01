// `node scripts/cold-load.mjs` — production cold-load timings for the menu. Serves `dist/` itself with gzip
// (GitHub Pages compresses too; `vite preview` does not), opens a fresh browser context per run (cold cache),
// throttles the network through CDP (default: Chrome's "Fast 3G" preset) and records, per viewport:
//   bytes transferred (compressed), first paint / first contentful paint, the splash (if any), the menu's
//   first DOM paint, the menu interactive (first idle frame after the menu rendered), and the first WebGL draw
//   of the ocean behind the menu. Needs `npm run build` first.
// Env: LOAD_VIEWPORTS=1440x900,375x812  LOAD_RUNS=3  LOAD_NET=fast3g|none  LOAD_QUERY='?no3d'  LOAD_PORT=4180
//      LOAD_HEADED=1 (headed Chromium, e.g. under `xvfb-run -a`)  LOAD_OUT=/path/result.json  LOAD_SHOT_DIR=/path
//      LOAD_DIST=dist (build directory to serve)  LOAD_GL_TIMEOUT_MS=180000 (SwiftShader needs long: the ocean's first frame compiles every shader on the CPU)
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import zlib from 'node:zlib'

const PORT = Number(process.env.LOAD_PORT ?? 4180)
const RUNS = Number(process.env.LOAD_RUNS ?? 3)
const VIEWPORTS = (process.env.LOAD_VIEWPORTS ?? '1440x900,375x812').split(',').map((v) => v.split('x').map(Number))
const NET = process.env.LOAD_NET ?? 'fast3g'
const QUERY = process.env.LOAD_QUERY ?? ''
const OUT = process.env.LOAD_OUT
const SHOT_DIR = process.env.LOAD_SHOT_DIR
const GL_TIMEOUT = Number(process.env.LOAD_GL_TIMEOUT_MS ?? 180_000)
const DIST = path.resolve(process.env.LOAD_DIST ?? 'dist')

// Chrome DevTools "Fast 3G": 1.6 Mbps down, 750 kbps up, 150 ms RTT; DevTools applies ×0.9 to throughput and ×3.75 to latency.
const PROFILES = {
  fast3g: { offline: false, latency: 150 * 3.75, downloadThroughput: ((1.6 * 1024 * 1024) / 8) * 0.9, uploadThroughput: ((750 * 1024) / 8) * 0.9 },
  none: null,
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.png': 'image/png', '.webp': 'image/webp', '.md': 'text/markdown' }
const gzipCache = new Map()
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  let file = path.join(DIST, decodeURIComponent(url.pathname))
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  const ext = path.extname(file)
  const type = MIME[ext] ?? 'application/octet-stream'
  const compressible = /^(text\/|application\/(json|javascript)|image\/svg)/.test(type)
  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')
  let body = fs.readFileSync(file)
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', 'no-store')
  if (compressible && acceptsGzip) {
    if (!gzipCache.has(file)) gzipCache.set(file, zlib.gzipSync(body, { level: 6 }))
    body = gzipCache.get(file)
    res.setHeader('Content-Encoding', 'gzip')
  }
  res.setHeader('Content-Length', body.length)
  res.end(body)
})
await new Promise((resolve) => server.listen(PORT, resolve))

// Runs before any page script: timestamps the splash, the menu's DOM, the first idle frame after it, and the first WebGL draw.
const INIT = `(() => {
  const L = (window.__load = { splashSeen: null, splashFade: null, splashFadePainted: null, splashGone: null, menuDom: null, menuInteractive: null, loadingSeen: null, loadingGone: null, firstGlDraw: null, longTasks: [] })
  const now = () => performance.now()
  const splash = () => document.getElementById('boot-splash')
  const obs = new MutationObserver(() => {
    if (L.splashSeen === null && splash()) L.splashSeen = now()
    if (L.splashFade === null && splash()?.hasAttribute('data-done')) {
      L.splashFade = now()
      requestAnimationFrame(() => requestAnimationFrame(() => { L.splashFadePainted = now() }))
    }
    if (L.splashSeen !== null && L.splashGone === null && !splash()) L.splashGone = now()
    if (L.menuDom === null && document.querySelector('[data-testid="main-menu"]')) {
      L.menuDom = now()
      requestAnimationFrame(() => setTimeout(() => { L.menuInteractive = now() }, 0))
    }
    // the React "Rigging the ships…" card (MainMenu.tsx LoadingScreen) covers the menu until the world's first frame
    const loading = document.querySelector('[data-testid="loading"]')
    if (L.loadingSeen === null && loading) L.loadingSeen = now()
    if (L.loadingSeen !== null && L.loadingGone === null && !loading) L.loadingGone = now()
    if (L.menuInteractive !== null && (L.splashSeen === null || L.splashGone !== null) && (L.loadingSeen === null || L.loadingGone !== null)) obs.disconnect()
  })
  obs.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-done'] })
  try { new PerformanceObserver((list) => { for (const e of list.getEntries()) L.longTasks.push([Math.round(e.startTime), Math.round(e.duration)]) }).observe({ type: 'longtask', buffered: true }) } catch {}
  for (const Ctx of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!Ctx) continue
    for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
      const orig = Ctx.prototype[name]
      if (!orig) continue
      Ctx.prototype[name] = function () { if (L.firstGlDraw === null) L.firstGlDraw = now(); return orig.apply(this, arguments) }
    }
  }
})()`

const browser = await chromium.launch({
  headless: process.env.LOAD_HEADED !== '1',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const no3d = /[?&]no3d/.test(QUERY)
const results = []
const chunks = new Map()
try {
  for (const [width, height] of VIEWPORTS) {
    for (let run = 1; run <= RUNS; run++) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 500 ? 3 : 1, isMobile: width < 500, hasTouch: width < 500 })
      const page = await context.newPage()
      await page.addInitScript(INIT)
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable')
      if (PROFILES[NET]) await cdp.send('Network.emulateNetworkConditions', PROFILES[NET])
      const requests = new Map()
      cdp.on('Network.responseReceived', (e) => requests.set(e.requestId, { url: e.response.url, type: e.type, bytes: 0 }))
      cdp.on('Network.loadingFinished', (e) => {
        const r = requests.get(e.requestId)
        if (r) r.bytes = e.encodedDataLength
      })
      const label = `${width}x${height}-run${run}`
      const t0 = Date.now()
      await page.goto(`http://localhost:${PORT}/${QUERY}`, { waitUntil: 'commit' })
      if (SHOT_DIR) {
        // the splash (when present) is in the HTML, so it is on screen long before the menu
        await page.waitForSelector('#boot-splash', { state: 'attached', timeout: 10_000 }).then(() => page.screenshot({ path: path.join(SHOT_DIR, `${label}-splash.png`) })).catch(() => {})
      }
      await page.waitForFunction(() => window.__load.menuInteractive !== null, undefined, { timeout: 120_000 })
      if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, `${label}-menu.png`) })
      let glTimedOut = false
      if (!no3d) {
        await page.waitForFunction(() => window.__load.firstGlDraw !== null, undefined, { timeout: GL_TIMEOUT }).catch(() => (glTimedOut = true))
        // the React loading card fades once the world has drawn its first frame; wait for it so the column is filled in
        await page.waitForFunction(() => window.__load.loadingSeen === null || window.__load.loadingGone !== null, undefined, { timeout: 30_000 }).catch(() => {})
        if (SHOT_DIR && !glTimedOut) await page.screenshot({ path: path.join(SHOT_DIR, `${label}-ocean.png`) })
      }
      // prove the menu really is interactive: step 1 → step 2 of the menu
      await page.getByTestId('mode-single').click()
      await page.getByTestId('rules-next').waitFor({ timeout: 15_000 })
      // let late requests (module preloads, fonts) settle before summing bytes
      await page.waitForTimeout(1500)
      const m = await page.evaluate(() => {
        const paint = Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, Math.round(e.startTime)]))
        const nav = performance.getEntriesByType('navigation')[0]
        const L = window.__load
        const tbt = L.longTasks.filter(([s]) => s < (L.menuInteractive ?? Infinity)).reduce((a, [, d]) => a + Math.max(0, d - 50), 0)
        return {
          firstPaint: paint['first-paint'] ?? null,
          fcp: paint['first-contentful-paint'] ?? null,
          responseStart: Math.round(nav.responseStart),
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
          splashSeen: L.splashSeen && Math.round(L.splashSeen),
          splashFade: L.splashFade && Math.round(L.splashFade),
          splashFadePainted: L.splashFadePainted && Math.round(L.splashFadePainted),
          splashGone: L.splashGone && Math.round(L.splashGone),
          menuDom: Math.round(L.menuDom),
          menuInteractive: Math.round(L.menuInteractive),
          loadingGone: L.loadingGone && Math.round(L.loadingGone),
          firstGlDraw: L.firstGlDraw && Math.round(L.firstGlDraw),
          blockingMsBeforeMenu: Math.round(tbt),
          longTasks: L.longTasks.length,
        }
      })
      const list = [...requests.values()]
      const bytes = list.reduce((a, r) => a + r.bytes, 0)
      const byType = {}
      for (const r of list) byType[r.type] = (byType[r.type] ?? 0) + r.bytes
      for (const r of list) {
        const name = r.url.replace(/^.*\//, '')
        if (/\.(js|css)$/.test(name)) chunks.set(name, Math.max(chunks.get(name) ?? 0, r.bytes))
      }
      results.push({ viewport: `${width}x${height}`, run, ...m, glTimedOut, requests: list.length, bytesKb: Math.round(bytes / 1024), byTypeKb: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v / 1024)])), wallMs: Date.now() - t0 })
      console.log(label, JSON.stringify(results.at(-1)))
      await context.close()
    }
  }
} finally {
  await browser.close()
  server.close()
}

const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)] : null
}
const fmt = (ms) => (ms === null ? '—' : `${(ms / 1000).toFixed(2)} s`)
const summary = []
for (const [width, height] of VIEWPORTS) {
  const rows = results.filter((r) => r.viewport === `${width}x${height}`)
  summary.push({
    viewport: `${width}x${height}`,
    runs: rows.length,
    bytesKb: median(rows.map((r) => r.bytesKb)),
    requests: median(rows.map((r) => r.requests)),
    firstPaint: median(rows.map((r) => r.firstPaint)),
    fcp: median(rows.map((r) => r.fcp)),
    splashSeen: median(rows.map((r) => r.splashSeen)),
    menuDom: median(rows.map((r) => r.menuDom)),
    menuInteractive: median(rows.map((r) => r.menuInteractive)),
    loadingGone: median(rows.map((r) => r.loadingGone)),
    firstGlDraw: rows.some((r) => r.glTimedOut) ? null : median(rows.map((r) => r.firstGlDraw)),
    blockingMsBeforeMenu: median(rows.map((r) => r.blockingMsBeforeMenu)),
  })
}
console.log(`\ncold load · net=${NET} · query='${QUERY}' · median of ${RUNS} run(s)`)
console.table(summary)
console.log('| viewport | transferred (gzip) | requests | first paint | FCP | splash | menu DOM | menu interactive | loading card gone | first 3D draw | main-thread blocking before menu |')
console.log('|---|---|---|---|---|---|---|---|---|---|')
for (const s of summary) console.log(`| ${s.viewport} | ${s.bytesKb} kB | ${s.requests} | ${fmt(s.firstPaint)} | ${fmt(s.fcp)} | ${fmt(s.splashSeen)} | ${fmt(s.menuDom)} | ${fmt(s.menuInteractive)} | ${fmt(s.loadingGone)} | ${fmt(s.firstGlDraw)} | ${s.blockingMsBeforeMenu} ms |`)
console.log('\nlargest transfers (gzip):')
for (const [name, b] of [...chunks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`  ${String(Math.round(b / 1024)).padStart(5)} kB  ${name}`)
if (OUT) fs.writeFileSync(OUT, JSON.stringify({ net: NET, query: QUERY, summary, results, chunks: Object.fromEntries(chunks) }, null, 2))
