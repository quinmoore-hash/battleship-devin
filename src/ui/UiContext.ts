import { createContext, useContext } from 'react'

export type UiModal = 'settings' | 'how-to-play' | null

export interface UiContextValue {
  openModal: (modal: UiModal) => void
}

export const UiContext = createContext<UiContextValue>({ openModal: () => {} })

export const useUi = () => useContext(UiContext)
