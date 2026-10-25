/// <reference types="node" />
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ALL_AUDIO_FILES, AMBIENCE_FILES, AUDIO_FORMATS, LEGACY_SFX, LOOPING_SFX, LOOP_FILES, MUSIC_FILES, SFX_FILES, SFX_NAMES, audioUrls, resolveSfx, type CanonicalSfx } from './manifest'

const AUDIO_DIR = fileURLToPath(new URL('../../public/assets/audio', import.meta.url))
const GENERATOR = fileURLToPath(new URL('../../scripts/generate-audio.mjs', import.meta.url))

const REQUIRED: CanonicalSfx[] = [
  'cannon-fire', 'cannon-whistle', 'splash-miss', 'impact-wood', 'fire-loop', 'hull-creak', 'mast-snap', 'sinking-groan', 'bubbles',
  'crew-shout-hit', 'crew-cheer', 'bell-victory', 'drum-defeat', 'ui-click', 'ui-hover', 'place-ship', 'rotate-ship', 'sail-flap', 'thunder', 'gull',
]

describe('audio manifest', () => {
  it('covers every required pirate SFX and nothing else', () => {
    expect([...SFX_NAMES].sort()).toEqual([...REQUIRED].sort())
  })

  it.each(REQUIRED)('%s maps to files that exist in public/assets/audio (ogg + mp3)', (name) => {
    const variants = SFX_FILES[name]
    expect(variants.length).toBeGreaterThan(0)
    for (const v of variants) {
      for (const ext of AUDIO_FORMATS) {
        const file = join(AUDIO_DIR, `${v}.${ext}`)
        expect(existsSync(file), `${file} missing`).toBe(true)
        expect(statSync(file).size).toBeGreaterThan(500)
      }
    }
  })

  it('cannon-fire / splash-miss / impact-wood have exactly 3 variants', () => {
    for (const name of ['cannon-fire', 'splash-miss', 'impact-wood'] as const) expect(SFX_FILES[name]).toHaveLength(3)
  })

  it('legacy names resolve to pirate sounds and share their files', () => {
    expect(resolveSfx('fire')).toBe('cannon-fire')
    expect(resolveSfx('place')).toBe('place-ship')
    expect(resolveSfx('thunder')).toBe('thunder')
    for (const [legacy, target] of Object.entries(LEGACY_SFX)) expect(SFX_FILES[legacy as keyof typeof SFX_FILES]).toBe(SFX_FILES[target])
    expect(SFX_NAMES).not.toContain('fire')
  })

  it('loops are the sustained sounds', () => {
    expect([...LOOPING_SFX].sort()).toEqual(['bubbles', 'fire-loop'])
  })

  it('music variants, sting and ambience beds exist; LOOP_FILES still points at playable loops', () => {
    for (const file of [...Object.values(MUSIC_FILES), ...Object.values(AMBIENCE_FILES), ...Object.values(LOOP_FILES)]) {
      for (const ext of AUDIO_FORMATS) expect(existsSync(join(AUDIO_DIR, `${file}.${ext}`)), `${file}.${ext}`).toBe(true)
    }
  })

  it('every file on disk is in the manifest and the generator renders exactly the manifest', () => {
    const onDisk = new Set(readdirSync(AUDIO_DIR).filter((f) => /\.(ogg|mp3)$/.test(f)).map((f) => f.replace(/\.(ogg|mp3)$/, '')))
    expect([...onDisk].sort()).toEqual([...ALL_AUDIO_FILES].sort())
    const generator = readFileSync(GENERATOR, 'utf8')
    for (const name of ALL_AUDIO_FILES) expect(generator, `${name} missing from generate-audio.mjs`).toMatch(new RegExp(`['"]?${name}['"]?:\\s*\\[`))
  })

  it('ships a LICENSES.md that states the audio is generated', () => {
    expect(readFileSync(join(AUDIO_DIR, 'LICENSES.md'), 'utf8')).toMatch(/generate-audio\.mjs/)
  })

  it('keeps the total audio payload under 5 MB', () => {
    const files = readdirSync(AUDIO_DIR).filter((f) => /\.(ogg|mp3)$/.test(f))
    const total = files.reduce((sum, f) => sum + statSync(join(AUDIO_DIR, f)).size, 0)
    expect(total).toBeLessThan(5 * 1024 * 1024)
  })

  it('builds URLs under the Vite base', () => {
    expect(audioUrls('cannon-fire-1')).toEqual(['/assets/audio/cannon-fire-1.ogg', '/assets/audio/cannon-fire-1.mp3'])
  })
})
