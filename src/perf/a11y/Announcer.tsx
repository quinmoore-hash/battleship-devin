import { useCallback, useEffect, useState } from 'react'

type Listener = (msg: string, assertive: boolean) => void
const listeners = new Set<Listener>()

/** Push a message to the screen-reader live region (works outside React, e.g. from the store). */
export function announce(message: string, assertive = false): void {
  listeners.forEach((l) => l(message, assertive))
}

export function useAnnouncer(): (message: string, assertive?: boolean) => void {
  return useCallback((m: string, a = false) => announce(m, a), [])
}

/** Two visually-hidden live regions (polite + assertive). Mount once near the root. */
export function Announcer() {
  const [polite, setPolite] = useState('')
  const [assertive, setAssertive] = useState('')
  useEffect(() => {
    const l: Listener = (msg, a) => {
      // re-announce identical strings by toggling a trailing zero-width space
      if (a) setAssertive((p) => (p === msg ? msg + '\u200b' : msg))
      else setPolite((p) => (p === msg ? msg + '\u200b' : msg))
    }
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="announcer-polite">
        {polite}
      </div>
      <div className="sr-only" role="alert" aria-live="assertive" aria-atomic="true" data-testid="announcer-assertive">
        {assertive}
      </div>
    </>
  )
}
