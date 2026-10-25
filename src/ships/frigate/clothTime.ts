import { createContext } from 'react'

/** Shared animation clock for every cloth on one ship (one `useFrame` per ship, not per sail). */
export const ClothTime = createContext<{ value: number }>({ value: 0 })
