/**
 * Placeholder audio API. The audio child session implements it with Howler
 * (SFX for fire / hit / miss / sunk / win / lose, background music, volume + mute,
 * settings persisted to localStorage). Keep these function names stable.
 */
export type Sfx = 'fire' | 'hit' | 'miss' | 'sunk' | 'victory' | 'defeat' | 'ui-click' | 'place'

export function playSfx(_name: Sfx): void {}
export function startMusic(): void {}
export function stopMusic(): void {}
export function setSfxVolume(_volume: number): void {}
export function setMusicVolume(_volume: number): void {}
