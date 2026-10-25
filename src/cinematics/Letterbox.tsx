import { useEffect, type CSSProperties } from 'react'
import { useStore } from 'zustand'
import { director as defaultDirector, type Director } from './director'

export interface LetterboxProps {
  director?: Director
  /** Show the "click / space / esc to skip" hint (default true). */
  hint?: boolean
}

const bar: CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  height: '9vh',
  background: '#000',
  transition: 'transform 0.55s cubic-bezier(.4,0,.2,1)',
  zIndex: 5,
  pointerEvents: 'none',
}

/** Click, Space or Escape skips the running sequence. Buttons and form controls keep their own clicks. */
export function useSkipInput(director: Director = defaultDirector, enabled = true) {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (!director.busy) return
      if (e.code === 'Space' || e.code === 'Escape') {
        e.preventDefault()
        director.skip()
      }
    }
    const onPointer = (e: PointerEvent) => {
      if (!director.busy) return
      const el = e.target as HTMLElement | null
      if (el?.closest('button, input, select, a, textarea, [data-no-skip]')) return
      director.skip()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [director, enabled])
}

/** Cinema bars that slide in while a sequence plays, plus the skip input. Mount once in the HTML layer. */
export function Letterbox({ director = defaultDirector, hint = true }: LetterboxProps) {
  const visible = useStore(director.store, (s) => s.letterbox)
  useSkipInput(director)
  return (
    <div aria-hidden data-testid="letterbox" data-visible={visible ? 'true' : 'false'}>
      <div style={{ ...bar, top: 0, transform: visible ? 'translateY(0)' : 'translateY(-100%)' }} />
      <div style={{ ...bar, bottom: 0, transform: visible ? 'translateY(0)' : 'translateY(100%)' }} />
      {hint && (
        <div
          style={{
            position: 'fixed',
            right: 24,
            bottom: 'calc(9vh + 14px)',
            zIndex: 6,
            pointerEvents: 'none',
            fontSize: 12,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.75)',
            textShadow: '0 1px 2px rgba(0,0,0,0.8)',
            opacity: visible ? 1 : 0,
            transition: 'opacity 0.4s',
          }}
        >
          Click · Space · Esc to skip
        </div>
      )}
    </div>
  )
}
