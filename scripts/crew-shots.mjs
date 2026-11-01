// Headed-Chromium (SwiftShader under Xvfb) screenshots of the crew: `xvfb-run -a node scripts/crew-shots.mjs`
// against `vite preview` on :4173 (SHOT_BASE). Writes to SHOT_DIR (default ~/shots). Scenes: SHOT_SCENES=overview,deck,two,mobile,off
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const base = process.env.SHOT_BASE ?? 'http://localhost:4173'
const dir = process.env.SHOT_DIR ?? join(homedir(), 'shots')
const scenes = (process.env.SHOT_SCENES ?? 'overview,deck,two,mobile,off').split(',')
const quality = process.env.SHOT_QUALITY ?? 'medium'
mkdirSync(dir, { recursive: true })

const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function open(viewport, settings = {}, query = '') {
  const page = await browser.newPage({ viewport })
  await page.addInitScript((s) => localStorage.setItem('battleship-devin.settings', JSON.stringify({ cinematics: 'fast', ...s })), settings)
  await page.goto(`${base}/?perf&quality=${quality}&gpu=${quality}${query}`)
  await page.getByTestId('main-menu').waitFor({ timeout: 90_000 })
  await page.waitForFunction(() => !!window.__perf?.gl(), null, { timeout: 90_000 })
  return page
}
const click = async (page, id) => {
  const el = page.getByTestId(id)
  await el.waitFor({ timeout: 60_000 })
  await page.waitForFunction((id) => { const b = document.querySelector(`[data-testid="${id}"]`); return b && !b.disabled }, id, { timeout: 60_000 })
  await el.evaluate((b) => b.click())
}
const state = (page) => page.evaluate(() => { const s = window.__perf.store().getState(); return { turn: s.turn, phase: s.phase, deck: s.deck, player: s.playerBoard.ships.map((x) => ({ uid: x.uid, id: x.spec.id, len: x.spec.length, hits: x.hits.length, origin: x.origin, o: x.orientation })), enemy: s.enemyBoard.ships.map((x) => ({ uid: x.uid, id: x.spec.id, len: x.spec.length, hits: x.hits.length, origin: x.origin, o: x.orientation })), shots: s.enemyBoard.shots.length } })
const crew = (page) => page.evaluate(() => JSON.stringify(window.__crewPerf))
const perf = (page) => page.evaluate(() => { const s = window.__perf.stats; return `calls ${s.drawCalls} tris ${s.triangles}` })
const shot = async (page, name) => { await page.screenshot({ path: join(dir, `${name}.png`) }); log('shot', name) }
const settle = async (page, ms) => { const t = Date.now(); while (Date.now() - t < ms) await page.waitForTimeout(500) }

async function startSingle(page) {
  await click(page, 'mode-single')
  await click(page, 'rules-next')
  await click(page, 'difficulty-easy')
  await click(page, 'auto-place')
  await click(page, 'confirm-placement')
  await page.getByTestId('battle').waitFor({ timeout: 60_000 })
}
const cellsOf = (sh) => Array.from({ length: sh.len }, (_, i) => (sh.o === 'horizontal' ? { x: sh.origin.x + i, y: sh.origin.y } : { x: sh.origin.x, y: sh.origin.y + i }))
const fire = async (page, c) => { await click(page, `enemy-grid-${c.x}-${c.y}`); return 'clicked' }
async function waitTurn(page, who, ms = 240_000) {
  await page.waitForFunction((who) => { const s = window.__perf.store().getState(); return s.turn === who && s.phase === 'battle' && !document.querySelector('[data-testid="battle"][data-cinematic="true"]') || s.phase === 'gameover' }, who, { timeout: ms })
}

if (scenes.includes('overview')) {
  const page = await open({ width: 1440, height: 900 })
  await startSingle(page)
  await settle(page, 45_000)
  log('overview', await crew(page), await perf(page))
  await shot(page, 'overview-crew')
  // play: sink the enemy's smallest ship cell by cell (hit cells are hidden until sunk → the sink empties the deck),
  // meanwhile the easy AI fires back and eventually hits one of ours → a figure goes overboard.
  let st = await state(page)
  const queue = [...st.enemy].sort((a, b) => a.len - b.len)
  let target = queue.shift()
  let hitSeen = false
  let sinkSeen = false
  for (let round = 0; round < 40 && (!hitSeen || !sinkSeen); round++) {
    await waitTurn(page, 'human')
    st = await state(page)
    if (st.phase !== 'battle') break
    if (target.hits >= target.len) target = queue.shift()
    if (!target) break
    const cells = cellsOf(target)
    const next = cells[target.hits]
    const r = await fire(page, next)
    log('round', round, 'fired', next, r)
    target.hits++
    const watchUntil = Date.now() + 120_000
    while (Date.now() < watchUntil) {
      await page.waitForTimeout(400)
      const s2 = await state(page)
      const ownHit = s2.player.some((p) => p.hits > 0)
      const foeSinking = s2.enemy.some((e) => e.hits >= e.len) && !sinkSeen
      const c = JSON.parse(await crew(page))
      if (ownHit && c.thrown > 0 && !hitSeen) { await shot(page, 'hit-thrown'); log('thrown', c) }
      if (ownHit && c.swim > 0 && !hitSeen && !foeSinking) { await shot(page, 'hit-swim'); hitSeen = true; log('swim', c) }
      if (s2.enemy.find((e) => e.uid === target.uid).hits >= target.len && !sinkSeen) { await shot(page, 'sink-jump'); await settle(page, 12000); await shot(page, 'sink-deck-empty'); sinkSeen = true; log('sink', await crew(page)) }
      const cine = await page.evaluate(() => document.querySelector('[data-testid="battle"]')?.getAttribute('data-cinematic'))
      if (s2.turn === 'human' && cine === 'false') break
    }
  }
  log('overview done', await crew(page), await perf(page))
  await page.close()
}

if (scenes.includes('deck')) {
  const page = await open({ width: 1440, height: 900 })
  await startSingle(page)
  for (const id of ['frigate', 'man-o-war']) {
    const st = await state(page)
    const ship = st.player.find((s) => s.id === id)
    await page.evaluate((uid) => { const s = window.__perf.store().getState(); if (!s.deck.on) s.setDeck(true); s.boardShip(uid) }, ship.uid)
    await page.waitForFunction(() => document.querySelector('[data-testid="battle"]')?.getAttribute('data-deck') === 'true', null, { timeout: 60_000 })
    await settle(page, 30_000)
    log('deck', id, await crew(page), await perf(page))
    await shot(page, `deck-${id}`)
    // keyboard look (pointer lock is refused under automation): turn and walk a little so the crew come into frame
    await page.mouse.click(720, 600)
    await page.waitForTimeout(1000)
    if (process.env.SHOT_WALK) {
      // walk forward into the waist so the gunners and the lookout come into frame
      await page.keyboard.down('w')
      await page.waitForTimeout(Number(process.env.SHOT_WALK))
      await page.keyboard.up('w')
      await settle(page, 8000)
      await shot(page, `deck-${id}-walk`)
    }
    for (const [name, key, ms] of [['left', 'ArrowLeft', 1500], ['back', 'ArrowLeft', 1500], ['right', 'ArrowLeft', 1500]]) {
      await page.keyboard.down(key)
      await page.waitForTimeout(ms)
      await page.keyboard.up(key)
      await settle(page, 8000)
      await shot(page, `deck-${id}-${name}`)
    }
  }
  await page.close()
}

if (scenes.includes('two')) {
  const page = await open({ width: 1440, height: 900 })
  await click(page, 'mode-two')
  await click(page, 'rules-next')
  await click(page, 'names-start')
  await click(page, 'auto-place')
  await click(page, 'confirm-placement')
  for (const id of ['handoff-ready', 'auto-place', 'confirm-placement', 'handoff-ready']) { try { await click(page, id) } catch { log('skip', id) } }
  await page.getByTestId('battle').waitFor({ timeout: 60_000 })
  await settle(page, 45_000)
  log('two', await crew(page), await perf(page))
  await shot(page, 'two-captains')
  await page.close()
}

if (scenes.includes('mobile')) {
  const page = await open({ width: 375, height: 812 })
  await startSingle(page)
  await settle(page, 40_000)
  log('mobile', await crew(page))
  await shot(page, 'mobile-375')
  await page.close()
}

if (scenes.includes('off')) {
  const page = await open({ width: 1440, height: 900 }, { crew: false })
  await startSingle(page)
  await settle(page, 30_000)
  log('off', await page.evaluate(() => window.__crewPerf ?? null), await perf(page))
  await shot(page, 'crew-off')
  await page.close()
}
await browser.close()
