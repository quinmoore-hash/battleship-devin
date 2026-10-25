#!/usr/bin/env node
/**
 * Procedurally generates every sound shipped in public/assets/audio (see public/assets/audio/LICENSES.md).
 * Pure Node DSP (scripts/audio/*.mjs, no npm deps); ffmpeg on PATH encodes OGG + MP3.
 *
 *   node scripts/generate-audio.mjs              # regenerate everything
 *   node scripts/generate-audio.mjs cannon music # only names containing one of the filters
 *   node scripts/generate-audio.mjs --wav        # also keep WAV intermediates next to the encoded files
 *
 * Output is deterministic (seeded RNG) so re-running produces identical files.
 * The file list here must match src/audio/manifest.ts (checked by src/audio/manifest.test.ts).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ambienceSea, ambienceStorm } from './audio/ambience.mjs'
import { SR, wavBytes } from './audio/dsp.mjs'
import { musicBattle, musicIntro, musicMenu } from './audio/music.mjs'
import * as sfx from './audio/sfx.mjs'

const OUT_DIR = resolve(fileURLToPath(import.meta.url), '../../public/assets/audio')
const args = process.argv.slice(2)
const KEEP_WAV = args.includes('--wav')
const filters = args.filter((a) => !a.startsWith('--'))

/** name -> [render, { oggQ, mp3Kbps }] */
const SOUNDS = {
  'cannon-fire-1': [() => sfx.cannonFire(1)], 'cannon-fire-2': [() => sfx.cannonFire(2)], 'cannon-fire-3': [() => sfx.cannonFire(3)],
  'cannon-whistle': [sfx.cannonWhistle],
  'splash-miss-1': [() => sfx.splashMiss(31)], 'splash-miss-2': [() => sfx.splashMiss(32)], 'splash-miss-3': [() => sfx.splashMiss(33)],
  'impact-wood-1': [() => sfx.impactWood(21)], 'impact-wood-2': [() => sfx.impactWood(22)], 'impact-wood-3': [() => sfx.impactWood(23)],
  'fire-loop': [sfx.fireLoop],
  'hull-creak-1': [() => sfx.hullCreak(404)], 'hull-creak-2': [() => sfx.hullCreak(405)],
  'mast-snap': [sfx.mastSnap],
  'sinking-groan': [sfx.sinkingGroan],
  bubbles: [sfx.bubbles],
  'crew-shout-hit': [sfx.crewShoutHit],
  'crew-cheer': [sfx.crewCheer],
  'bell-victory': [sfx.bellVictory],
  'drum-defeat': [sfx.drumDefeat],
  'ui-click': [sfx.uiClick],
  'ui-hover': [sfx.uiHover],
  'place-ship': [sfx.placeShip],
  'rotate-ship': [sfx.rotateShip],
  'sail-flap': [sfx.sailFlap],
  thunder: [sfx.thunder],
  'gull-1': [() => sfx.gull(41)], 'gull-2': [() => sfx.gull(42)],
  'music-intro': [musicIntro, { oggQ: 3, mp3Kbps: 96 }],
  'music-menu': [musicMenu, { oggQ: 1, mp3Kbps: 64 }],
  'music-battle': [musicBattle, { oggQ: 1, mp3Kbps: 64 }],
  'ambience-sea': [ambienceSea, { oggQ: 0, mp3Kbps: 56 }],
  'ambience-storm': [ambienceStorm, { oggQ: 0, mp3Kbps: 56 }],
}

function encode(name, samples, tmp, { oggQ = 3, mp3Kbps = 96 } = {}) {
  const wav = join(tmp, `${name}.wav`)
  writeFileSync(wav, wavBytes(samples))
  if (KEEP_WAV) writeFileSync(join(OUT_DIR, `${name}.wav`), wavBytes(samples))
  const ogg = join(OUT_DIR, `${name}.ogg`)
  const mp3 = join(OUT_DIR, `${name}.mp3`)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libvorbis', '-q:a', String(oggQ), ogg])
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', `${mp3Kbps}k`, mp3])
  return { name, seconds: samples.length / SR, ogg: statSync(ogg).size, mp3: statSync(mp3).size }
}

mkdirSync(OUT_DIR, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), 'battleship-audio-'))
const report = []
try {
  for (const [name, [make, enc]] of Object.entries(SOUNDS)) {
    if (filters.length && !filters.some((f) => name.includes(f))) continue
    const t0 = Date.now()
    process.stdout.write(`rendering ${name}... `)
    report.push(encode(name, make(), tmp, enc))
    console.log(`ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`
console.log('\n| file | length | ogg | mp3 |\n| --- | --- | --- | --- |')
let total = 0
for (const row of report) {
  total += row.ogg + row.mp3
  console.log(`| ${row.name} | ${row.seconds.toFixed(2)} s | ${kb(row.ogg)} | ${kb(row.mp3)} |`)
}
console.log(`\nTotal (ogg + mp3): ${kb(total)}`)
