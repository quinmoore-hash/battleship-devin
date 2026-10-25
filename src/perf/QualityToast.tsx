import { useEffect } from 'react'
import { usePerfStore } from './store'
import './perf.css'

const AUTO_HIDE_MS = 9000

/** One-time toast shown when the watchdog lowered the quality tier. Announced via role="status". */
export function QualityToast() {
  const notice = usePerfStore((s) => s.notice)
  const dismiss = usePerfStore((s) => s.dismissNotice)
  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(dismiss, AUTO_HIDE_MS)
    return () => window.clearTimeout(id)
  }, [notice, dismiss])
  if (!notice) return null
  return (
    <div className="perf-toast" role="status" data-testid="quality-toast">
      <span>{notice}</span>
      <button type="button" onClick={dismiss} aria-label="Dismiss notice">
        ×
      </button>
    </div>
  )
}
