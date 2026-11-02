/**
 * deck module — the "On deck" first-person mode (session A).
 *
 *   <DeckController />                 inside <OceanScene> in battle: owns the camera while `deck.on` (eye height, drag-to-look;
 *                                      the gunner's eye at a manned gun; stands down while the director holds `deckCameraLease`)
 *   useDeckStore / resetDeckRuntime    transient runtime the HTML HUD reads (near gun, approach, fade, nudge)
 *   math.ts                            pure walk / jump / collision / station geometry (unit-tested)
 *   contract.ts                        shared types + `deckBus` (sessions A / B / C)
 */
export * from './contract'
export { DeckController, mannedCannon, SWING_DELAY_MS } from './DeckController'
export { useDeckStore, resetDeckRuntime, type DeckRuntime } from './deckStore'
export { fallbackDeckAnchors, resolveDeckAnchors, stationsOf, stationUsable, afloatUids, cycleShip, WALK_SPEED, RUN_SPEED, JUMP_APEX, JUMP_TIME, type Station } from './math'
export { DeckAudio, useDeckAudioStore, isAudioDebug } from './audio'
