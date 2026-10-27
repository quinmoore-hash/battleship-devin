/**
 * extras — stats & streaks, battle replay, photo mode, salvo / stormy-seas mode UI.
 *
 *   <ExtrasLayer />                                  mount next to <GameUI>; listens for battleship:replay / battleship:photo
 *   <StatsPanel difficulty? compact? />              captain's log (menu + game over)
 *   <ReplayPlayer snapshot />  useReplay()  requestReplay()
 *   <PhotoMode boards />       usePhotoMode()  requestPhotoMode()
 *   useGameWeather()                                 'stormy' while the stormy-seas mode is on, else undefined
 */
export * from './stats'
export { StatsPanel, type StatsPanelProps } from './StatsPanel'
export * from './replayModel'
export { ReplayPlayer, useReplay, useReplayEvent, requestReplay, openReplay, closeReplay, REPLAY_EVENT, type ReplayPlayerProps } from './replay'
export { PhotoMode, usePhotoMode, usePhotoEvent, requestPhotoMode, openPhotoMode, closePhotoMode, capturePng, photoFileName, PHOTO_EVENT, type PhotoModeProps, type PhotoRequest } from './photo'
export * from './camera'
export { FreeCamera, type FreeCameraProps } from './FreeCamera'
export { Battlefield, type BattlefieldProps } from './Battlefield'
export { ExtrasLayer, MenuRules, MenuStats, ModesPicker } from './ExtrasLayer'
export { simulateGame, type SimulateOptions } from './demoGame'
export { useGameWeather, useGameTimeOfDay } from './weather'
