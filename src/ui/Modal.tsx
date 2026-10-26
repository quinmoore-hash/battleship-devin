import { createPortal } from 'react-dom'
import { type ReactNode, useEffect, useRef } from 'react'
import { withSfx } from './sfx'

interface ModalProps {
  title: string
  testId: string
  onClose: () => void
  children: ReactNode
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ title, testId, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.tabIndex >= 0)
    focusables()[0]?.focus()
    // everything behind the dialog is inert while it is open (focus trap + no stray clicks on the HUD, BUG-325)
    const root = document.getElementById('root')
    root?.setAttribute('inert', '')
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key !== 'Tab' || !ref.current) return
      const items = focusables()
      if (items.length === 0) return e.preventDefault()
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      const inside = ref.current.contains(current)
      if (e.shiftKey && (!inside || current === first)) (e.preventDefault(), last.focus())
      else if (!e.shiftKey && (!inside || current === last)) (e.preventDefault(), first.focus())
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      root?.removeAttribute('inert')
      previous?.focus()
    }
  }, [onClose])

  return createPortal(
    <div className="modal-backdrop ui-portal" onClick={onClose} data-testid={`${testId}-backdrop`}>
      <div
        ref={ref}
        className="modal panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${testId}-title`}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id={`${testId}-title`}>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            data-testid={`${testId}-close`}
            onClick={withSfx(onClose)}
          >
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
