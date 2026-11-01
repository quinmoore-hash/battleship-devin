// Eye-height review shots for the "On deck" mode: one screenshot + draws/triangles/heap per class and look.
//   npm run build && npx vite preview --port 4173 &
//   xvfb-run -a node scripts/deck-shots.mjs            (env: SHOT_DIR, SHOT_TIER=medium|high, SHOT_LOOKS=fwd,rail, SHOT_SHIPS, SHOT_EXTRA="&wrecks=6")
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const dir = process.env.SHOT_DIR ?? 'out/deck-shots'
const tier = process.env.SHOT_TIER ?? 'medium'
const looks = (process.env.SHOT_LOOKS ?? 'fwd,rail').split(',')
const ships = (process.env.SHOT_SHIPS ?? 'sloop,brigantine,frigate,galleon,man-o-war').split(',')
const extra = process.env.SHOT_EXTRA ?? ''
const base = process.env.SHOT_URL ?? 'http://localhost:4173/'
mkdirSync(dir, { recursive: true })

const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const rows = []
for (const ship of ships) {
  for (const look of looks) {
    const url = `${base}?deck-demo&ship=${ship}&look=${look}&perf&quality=${tier}&gpu=${tier}${extra}`
    await page.goto(url)
    await page.waitForFunction(() => (window.__perf?.stats?.frames ?? 0) > 90, null, { timeout: 120_000 })
    await page.evaluate(() => window.__perf.reset())
    await page.waitForFunction(() => (window.__perf?.stats?.frames ?? 0) > 30, null, { timeout: 60_000 })
    const s = await page.evaluate(() => ({ ...window.__perf.stats }))
    const file = `${dir}/${ship}-${look}.png`
    await page.screenshot({ path: file })
    rows.push({ ship, look, draws: s.drawCalls, tris: s.triangles, heap: s.heapMb, geoms: s.geometries, progs: s.programs, renderMs: s.renderMs })
    console.log(`${ship} ${look}: ${s.drawCalls} draws, ${s.triangles} tris, ${s.heapMb.toFixed(0)} MB -> ${file}`)
  }
}
await browser.close()
console.log(`\n| class | look | draws | triangles | heap MB |\n|---|---|---|---|---|`)
for (const r of rows) console.log(`| ${r.ship} | ${r.look} | ${r.draws} | ${r.tris} | ${r.heap.toFixed(0)} |`)
