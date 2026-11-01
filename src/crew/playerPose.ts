/** Where the On-deck player stands (ship-local), published by DeckController each frame so crew can step aside. */
export const playerDeck = { uid: null as string | null, x: 0, z: 0, station: -1 }

export function setPlayerDeck(uid: string | null, x = 0, z = 0, station = -1): void {
  playerDeck.uid = uid
  playerDeck.x = x
  playerDeck.z = z
  playerDeck.station = station
}
