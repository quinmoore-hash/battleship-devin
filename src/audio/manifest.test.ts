/// <reference types="node" />
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { AUDIO_FORMATS, LOOP_FILES, SFX_FILES, SFX_NAMES, audioUrls, type Sfx } from './manifest'

const AUDIO_DIR = fileURLToPath(new URL('../../public/assets/audio', import.meta.url))

const ALL_SFX: Sfx[] = ['fire', 'hit', 'miss', 'sunk', 'victory', 'defeat', 'ui-click', 'place']

describe('audio manifest', () => {
  it('covers every Sfx name', () => {
    expect([...SFX_NAMES].sort()).toEqual([...ALL_SFX].sort())
  })

  it.each(ALL_SFX)('%s maps to files that exist in public/assets/audio (ogg + mp3)', (name) => {
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

  it('fire / hit / miss have 2-3 variants', () => {
    for (const name of ['fire', 'hit', 'miss'] as const) {
      expect(SFX_FILES[name].length).toBeGreaterThanOrEqual(2)
      expect(SFX_FILES[name].length).toBeLessThanOrEqual(3)
    }
  })

  it('music and ambience loops exist', () => {
    for (const file of Object.values(LOOP_FILES)) {
      for (const ext of AUDIO_FORMATS) expect(existsSync(join(AUDIO_DIR, `${file}.${ext}`))).toBe(true)
    }
  })

  it('keeps the total audio payload under 3 MB', () => {
    const files: string[] = readdirSync(AUDIO_DIR).filter((f: string) => /\.(ogg|mp3)$/.test(f))
    const total = files.reduce((sum, f) => sum + statSync(join(AUDIO_DIR, f)).size, 0)
    expect(total).toBeLessThan(3 * 1024 * 1024)
  })

  it('builds URLs under the Vite base', () => {
    expect(audioUrls('fire-1')).toEqual(['/assets/audio/fire-1.ogg', '/assets/audio/fire-1.mp3'])
  })
})
