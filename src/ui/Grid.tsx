import { type DragEvent, type FocusEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
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
  // roving tabindex: the last focused cell is the grid's single tab stop; when it gets disabled
  // (the fired cell resolves, or the whole grid locks during the enemy turn) the stop moves to
  // the first enabled cell and keyboard focus follows it, so Tab can always re-enter the grid
  const [active, setActive] = useState<Coord>({ x: 0, y: 0 })
  const rootRef = useRef<HTMLDivElement>(null)
  const hadFocus = useRef(false)
  const isDisabledAt = useCallback(
    (c: Coord) => {
      const st = cell(c).state
      return disabled || !onCell || (lockResolved && (st === 'miss' || st === 'hit' || st === 'sunk'))
    },
    [cell, disabled, lockResolved, onCell],
  )
  let tabStop = active
  if (isDisabledAt(active)) {
    outer: for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        if (!isDisabledAt({ x, y })) {
          tabStop = { x, y }
          break outer
        }
  }
  const stopDisabled = isDisabledAt(tabStop)
  useEffect(() => {
    if (!hadFocus.current || stopDisabled) return
    const root = rootRef.current
    const ae = document.activeElement
    if (!root || (ae && root.contains(ae) && !(ae as HTMLButtonElement).disabled)) return
    if (ae && ae !== document.body && !root.contains(ae)) return
    root.querySelector<HTMLButtonElement>(`[data-testid="${testId}-${tabStop.x}-${tabStop.y}"]`)?.focus()
  }, [stopDisabled, tabStop.x, tabStop.y, testId])
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const to = e.relatedTarget as Node | null
    if (to && !e.currentTarget.contains(to)) hadFocus.current = false
  }

  const onKey = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, c: Coord) => {
      const delta: Record<string, Coord> = {
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
      }
      const d = delta[e.key]
      let next: Coord
      if (d) next = { x: (c.x + d.x + size) % size, y: (c.y + d.y + size) % size }
      else if (e.key === 'Home') next = { x: 0, y: e.ctrlKey ? 0 : c.y }
      else if (e.key === 'End') next = { x: size - 1, y: e.ctrlKey ? size - 1 : c.y }
      else return
      e.preventDefault()
      const el = e.currentTarget.closest('.grid')?.querySelector<HTMLButtonElement>(
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
        ref={rootRef}
        className="grid"
        data-testid={testId}
        role="grid"
        aria-label={label}
        style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
        onFocus={() => {
          hadFocus.current = true
        }}
        onBlur={onBlur}
      >
        {Array.from({ length: size }, (_, y) => (
          <div key={y} role="row" aria-rowindex={y + 1} style={{ display: 'contents' }}>
            {Array.from({ length: size }, (_, x) => {
              const i = y * size + x
              const c = { x, y }
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
              aria-colindex={x + 1}
              title={info.title}
              disabled={isDisabled}
              tabIndex={x === tabStop.x && y === tabStop.y ? 0 : -1}
              onClick={onCell ? () => onCell(c) : undefined}
              onMouseEnter={onHover ? () => onHover(c) : undefined}
              onFocus={() => {
                setActive(c)
                onHover?.(c)
              }}
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
        ))}
      </div>
    </div>
  )
}
