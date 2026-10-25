import { isSunk } from '../engine'
import { BoardGrid } from '../scene'
import { BOARD_LAYOUT } from '../scene/layout'
import { Fleet, type Lod } from '../ships'
import { Flotsam, placedShipSeed, ShotMarkers } from '../vfx'
import type { ReplayBoards } from './replayModel'
import type { Board } from '../engine'

/** Sunk ships stay as listing wrecks instead of vanishing below the waves, so replay/photo show what was lost. */
const WRECK_SINK = 0.6
const wrecks = (board: Board): Partial<Record<string, number>> =>
  Object.fromEntries(board.ships.filter(isSunk).map((s) => [s.spec.id, WRECK_SINK]))

export interface BattlefieldProps {
  boards: ReplayBoards
  /** Draw the enemy fleet even while afloat (replay / photo mode). Default true. */
  revealEnemy?: boolean
  lod?: Lod
  quality?: 'low' | 'high'
  /** Burning hit markers (default true). */
  fires?: boolean
  flotsam?: boolean
  grids?: boolean
}

/** Both fleets on their boards with every shot marker and the wreckage of sunk ships — the whole battlefield at one moment. */
export function Battlefield({ boards, revealEnemy = true, lod = 0, quality, fires = true, flotsam = true, grids = true }: BattlefieldProps) {
  const P = BOARD_LAYOUT.player
  const E = BOARD_LAYOUT.enemy
  return (
    <>
      {grids && <BoardGrid origin={E.origin} />}
      {grids && <BoardGrid origin={P.origin} color="#e6cfa3" />}
      <Fleet ships={boards.playerBoard.ships} livery="pirate" boardOrigin={P.origin} sinkProgress={wrecks(boards.playerBoard)} lod={lod} quality={quality} />
      <Fleet ships={boards.enemyBoard.ships} livery="navy" revealed={revealEnemy} boardOrigin={E.origin} sinkProgress={wrecks(boards.enemyBoard)} lod={lod} quality={quality} />
      <ShotMarkers shots={boards.enemyBoard.shots} boardOrigin={E.origin} fires={fires} />
      <ShotMarkers shots={boards.playerBoard.shots} boardOrigin={P.origin} fires={fires} />
      {flotsam &&
        boards.playerBoard.ships
          .filter(isSunk)
          .map((s) => <Flotsam key={`p-${s.spec.id}`} cells={s.cells} boardOrigin={P.origin} seed={placedShipSeed(s)} livery="pirate" />)}
      {flotsam &&
        boards.enemyBoard.ships
          .filter(isSunk)
          .map((s) => <Flotsam key={`e-${s.spec.id}`} cells={s.cells} boardOrigin={E.origin} seed={placedShipSeed(s)} livery="navy" />)}
    </>
  )
}
