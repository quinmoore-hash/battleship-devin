import type { ReactNode } from 'react'

/** Compass rose; `heading` rotates the needle (0 = north = your turn, 180 = enemy). */
export function CompassRose({ heading = 0, size = 72, spinning = false, className = '' }: { heading?: number; size?: number; spinning?: boolean; className?: string }) {
  return (
    <svg className={`compass ${spinning ? 'compass-spin' : ''} ${className}`} width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <circle cx="50" cy="50" r="47" className="compass-ring" />
      <circle cx="50" cy="50" r="40" className="compass-face" />
      {Array.from({ length: 16 }, (_, i) => (
        <line key={i} x1="50" y1="8" x2="50" y2={i % 4 === 0 ? 16 : 12} transform={`rotate(${i * 22.5} 50 50)`} className="compass-tick" />
      ))}
      <g className="compass-star">
        <polygon points="50,14 54,46 50,50 46,46" />
        <polygon points="50,86 54,54 50,50 46,54" />
        <polygon points="14,50 46,46 50,50 46,54" />
        <polygon points="86,50 54,46 50,50 54,54" />
        <polygon points="26,26 47,45 50,50 45,47" className="minor" />
        <polygon points="74,26 55,45 50,50 53,47" className="minor" />
        <polygon points="26,74 45,53 50,50 47,55" className="minor" />
        <polygon points="74,74 53,55 50,50 55,53" className="minor" />
      </g>
      <text x="50" y="25" textAnchor="middle" className="compass-letter">N</text>
      <text x="50" y="82" textAnchor="middle" className="compass-letter">S</text>
      <text x="22" y="54" textAnchor="middle" className="compass-letter">W</text>
      <text x="78" y="54" textAnchor="middle" className="compass-letter">E</text>
      <g className="compass-needle" style={{ transform: `rotate(${heading}deg)`, transformOrigin: '50px 50px' }}>
        <polygon points="50,18 54,50 46,50" className="needle-n" />
        <polygon points="50,82 54,50 46,50" className="needle-s" />
        <circle cx="50" cy="50" r="3.5" className="needle-pin" />
      </g>
    </svg>
  )
}

export function WaxSeal({ children, tone = 'crimson', className = '' }: { children?: ReactNode; tone?: 'crimson' | 'teal' | 'gold'; className?: string }) {
  return (
    <span className={`wax-seal wax-${tone} ${className}`} aria-hidden>
      <span className="wax-inner">{children ?? '☠'}</span>
    </span>
  )
}

export function Skull({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="skull">
      <path fill="currentColor" d="M12 2a8 8 0 0 0-8 8c0 2.6 1.2 4.7 3 6v3a1 1 0 0 0 1 1h1v2h2v-2h2v2h2v-2h1a1 1 0 0 0 1-1v-3c1.8-1.3 3-3.4 3-6a8 8 0 0 0-8-8Zm-3.5 11A2 2 0 1 1 10 11a2 2 0 0 1-1.5 2Zm7 0A2 2 0 1 1 17 11a2 2 0 0 1-1.5 2ZM12 17l-1.5-3h3Z" />
    </svg>
  )
}

/** Dismissable first-play hint pinned to a HUD corner. */
export function Hint({ id, children, seen, onDismiss }: { id: string; children: ReactNode; seen: boolean; onDismiss: (id: string) => void }) {
  if (seen) return null
  return (
    <div className="hint ink-in" role="note" data-testid={`hint-${id}`}>
      <span className="hint-text">{children}</span>
      <button type="button" className="hint-close" aria-label="Dismiss hint" onClick={() => onDismiss(id)}>
        ×
      </button>
    </div>
  )
}
