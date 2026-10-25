import { type DragEvent, type KeyboardEvent, useCallback } from 'react'
import { BOARD_SIZE, coordLabel, type CellView, type Coord } from '../engine'

export type GridCellState = CellView | 'ship'

export interface GridCellInfo {
  state: GridCellState
  /** Placement preview overlay. */
  preview?: 'valid' | 'invalid'
  /** Extra class names (e.g. `pulse` for the latest shot). */
  className?: string
  /** Lets a ship cell be picked back up during placement. */
  title?: string
}

interface GridProps {
  testId: string
  label: string
  cell: (c: Coord) => GridCellInfo
  onCell?: (c: Coord) => void
  onHover?: (c: Coord | null) => void
  onDrop?: (c: Coord) => void
  /** Disable firing on resolved cells (battle) – placement grids pass false. */
  lockResolved?: boolean
  disabled?: boolean
  showLabels?: boolean
  size?: number
}

export function Grid({
  testId,
  label,
  cell,
  onCell,
  onHover,
  onDrop,
  lockResolved = true,
  disabled = false,
  showLabels = true,
  size = BOARD_SIZE,
}: GridProps) {
  const onKey = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, c: Coord) => {
      const delta: Record<string, Coord> = {
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
      }
      const d = delta[e.key]
      if (!d) return
      e.preventDefault()
      const next = { x: (c.x + d.x + size) % size, y: (c.y + d.y + size) % size }
      const el = e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(
        `[data-testid="${testId}-${next.x}-${next.y}"]`,
      )
      el?.focus()
    },
    [size, testId],
  )

  return (
    <div
      className={`grid-wrap${showLabels ? ' with-labels' : ''}`}
      data-size={size}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
    >
      {showLabels && (
        <div className="grid-cols" aria-hidden>
          {Array.from({ length: size }, (_, x) => (
            <span key={x}>{String.fromCharCode(65 + x)}</span>
          ))}
        </div>
      )}
      {showLabels && (
        <div className="grid-rows" aria-hidden>
          {Array.from({ length: size }, (_, y) => (
            <span key={y}>{y + 1}</span>
          ))}
        </div>
      )}
      <div
        className="grid"
        data-testid={testId}
        role="grid"
        aria-label={label}
        style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
      >
        {Array.from({ length: size * size }, (_, i) => {
          const c = { x: i % size, y: Math.floor(i / size) }
          const info = cell(c)
          const resolved = info.state === 'miss' || info.state === 'hit' || info.state === 'sunk'
          const isDisabled = disabled || !onCell || (lockResolved && resolved)
          return (
            <button
              key={i}
              type="button"
              role="gridcell"
              className={`cell cell-${info.state}${info.preview ? ` preview-${info.preview}` : ''}${info.className ? ` ${info.className}` : ''}`}
              data-testid={`${testId}-${c.x}-${c.y}`}
              data-state={info.state}
              data-preview={info.preview}
              aria-label={`${coordLabel(c)}${info.state !== 'unknown' ? `, ${info.state}` : ''}`}
              title={info.title}
              disabled={isDisabled}
              tabIndex={i === 0 ? 0 : -1}
              onClick={onCell ? () => onCell(c) : undefined}
              onMouseEnter={onHover ? () => onHover(c) : undefined}
              onFocus={onHover ? () => onHover(c) : undefined}
              onKeyDown={(e) => onKey(e, c)}
              onDragOver={
                onDrop
                  ? (e: DragEvent) => {
                      e.preventDefault()
                      onHover?.(c)
                    }
                  : undefined
              }
              onDrop={
                onDrop
                  ? (e: DragEvent) => {
                      e.preventDefault()
                      onDrop(c)
                    }
                  : undefined
              }
            />
          )
        })}
      </div>
    </div>
  )
}
