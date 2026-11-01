/**
 * deck module — the "Third person" seat (session A).
 *
 *   <DeckController />                 inside <OceanScene> in battle: owns the camera while `deck.on`; third person
 *                                      behind the player's pirate, first person at a manned gun
 *   <Pirate ref livery gait />         the low-poly figure (reusable by the crew module), `createGait()`
 *   useDeckStore / resetDeckRuntime    transient runtime the HTML HUD reads (near gun, approach, fade, nudge)
 *   math.ts / camera.ts                pure walk / jump / station / orbit / spring-arm / blend geometry (unit-tested)
 *   contract.ts                        shared types + `deckBus` (sessions A / B / C)
 */
export * from './contract'
export { DeckController, mannedCannon, SWING_DELAY_MS } from './DeckController'
export { Pirate, createGait, PIRATE_HEIGHT, type PirateGait } from './Pirate'
export { useDeckStore, resetDeckRuntime, type DeckRuntime } from './deckStore'
export { fallbackDeckAnchors, resolveDeckAnchors, stationsOf, stationUsable, afloatUids, cycleShip, WALK_SPEED, RUN_SPEED, JUMP_APEX, JUMP_TIME, type Station } from './math'
export { TP_BACK, TP_UP, TP_FOV, BLEND_SECONDS, thirdPersonPose, springArm } from './camera'
export { DeckAudio, useDeckAudioStore, isAudioDebug } from './audio'
