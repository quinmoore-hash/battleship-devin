export type Sfx = 'fire' | 'hit' | 'miss' | 'sunk' | 'victory' | 'defeat' | 'ui-click' | 'place'

/**
 * Every SFX maps to one or more variant files (basenames, no extension) in public/assets/audio/.
 * Each variant exists as .ogg and .mp3; Howler picks the first format the browser can decode.
 * Regenerate with `node scripts/generate-audio.mjs`.
 */
export const SFX_FILES: Record<Sfx, readonly string[]> = {
  fire: ['fire-1', 'fire-2', 'fire-3'],
  hit: ['hit-1', 'hit-2', 'hit-3'],
  miss: ['miss-1', 'miss-2', 'miss-3'],
  sunk: ['sunk'],
  victory: ['victory'],
  defeat: ['defeat'],
  'ui-click': ['ui-click'],
  place: ['place'],
}

export const SFX_NAMES = Object.keys(SFX_FILES) as Sfx[]

export const LOOP_FILES = {
  music: 'music',
  ambience: 'ambience',
} as const

export const AUDIO_FORMATS = ['ogg', 'mp3'] as const

/** Public URLs for a basename, honouring Vite's `base` (GitHub Pages serves from /battleship-devin/). */
export function audioUrls(basename: string): string[] {
  const base = import.meta.env.BASE_URL ?? '/'
  return AUDIO_FORMATS.map((ext) => `${base}assets/audio/${basename}.${ext}`)
}
