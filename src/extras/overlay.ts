/** Tiny external store for a single open overlay (replay / photo) so a hook, a window event and a button all agree. */
import { useSyncExternalStore } from 'react'

export interface OverlayStore<T> {
  get(): T | null
  open(value: T): void
  close(): void
  subscribe(listener: () => void): () => void
}

export function createOverlayStore<T>(): OverlayStore<T> {
  let value: T | null = null
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((l) => l())
  return {
    get: () => value,
    open: (v) => {
      value = v
      emit()
    },
    close: () => {
      if (value === null) return
      value = null
      emit()
    },
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

export function useOverlay<T>(store: OverlayStore<T>): T | null {
  return useSyncExternalStore(store.subscribe, store.get, () => null)
}

/** Subscribes to a `window` CustomEvent while mounted. */
export function useWindowEvent<T>(name: string, handler: (detail: T | undefined) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<T>).detail)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handler identity is not stable; re-subscribing per render is cheap
  useSyncExternalStore(
    (notify) => {
      void notify
      window.addEventListener(name, listener)
      return () => window.removeEventListener(name, listener)
    },
    () => 0,
    () => 0,
  )
}
