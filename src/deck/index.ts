/**
 * deck module — the "On deck" first-person mode (session A).
 *
 *   <DeckController />                 inside <OceanScene> in battle: owns the camera while `deck.on`
 *   useDeckStore / resetDeckRuntime    transient runtime the HTML HUD reads (near gun, pointer lock, crosshair cell, fade)
 *   math.ts                            pure walk / station / aim geometry (unit-tested)
 *   contract.ts                        shared types + `deckBus` (sessions A / B / C)
 */
export * from './contract'
export { DeckController, mannedCannon, SWING_DELAY_MS } from './DeckController'
export { useDeckStore, resetDeckRuntime, type DeckRuntime } from './deckStore'
export { fallbackDeckAnchors, resolveDeckAnchors, stationsOf, stationUsable, afloatUids, cycleShip, type Station } from './math'
export { DeckAudio, useDeckAudioStore, isAudioDebug } from './audio'
