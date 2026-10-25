import { createPortal } from 'react-dom'
import { type ReactNode, useEffect, useRef } from 'react'
import { withSfx } from './sfx'

interface ModalProps {
  title: string
  testId: string
  onClose: () => void
  children: ReactNode
}

export function Modal({ title, testId, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus()
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
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
