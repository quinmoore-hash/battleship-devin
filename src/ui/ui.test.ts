// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLEET } from '../engine'
import { useGameStore } from '../store/gameStore'
import { GameUI } from './index'
import { DIALOGUE_LINE_COUNT, pickLine } from './dialogue'
import { clampOrigin } from './placementUtils'

const store = () => useGameStore.getState()
const ui = () => render(createElement(GameUI))
const cell = (grid: string, x: number, y: number) => screen.getByTestId(`${grid}-${x}-${y}`)

beforeEach(() => {
  store().reset()
  store().updateSettings({ reducedMotion: false })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('main menu', () => {
  it('renders three difficulty cards and starts placement', () => {
    ui()
    expect(screen.getByTestId('ui-root').dataset.phase).toBe('menu')
    for (const d of ['easy', 'medium', 'hard']) expect(screen.getByTestId(`difficulty-${d}`)).toBeTruthy()
    fireEvent.click(screen.getByTestId('difficulty-hard'))
    expect(store().phase).toBe('placement')
    expect(store().difficulty).toBe('hard')
    expect(screen.getByTestId('ui-root').dataset.phase).toBe('placement')
    expect(screen.getByTestId('placement')).toBeTruthy()
  })

  it('opens how-to-play and settings modals and binds reduced motion to the store', () => {
    ui()
    fireEvent.click(screen.getByTestId('open-how-to-play'))
    expect(screen.getByTestId('how-to-play')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('how-to-play')).toBeNull()

    fireEvent.click(screen.getByTestId('open-settings'))
    fireEvent.click(screen.getByTestId('setting-reduced-motion'))
    expect(store().settings.reducedMotion).toBe(true)
    fireEvent.change(screen.getByTestId('setting-sfx'), { target: { value: '0.25' } })
    expect(store().settings.sfxVolume).toBeCloseTo(0.25)
    fireEvent.click(screen.getByTestId('settings-close'))
    expect(screen.queryByTestId('settings')).toBeNull()
  })
})

describe('placement', () => {
  beforeEach(() => store().startGame('easy'))

  it('selects the first unplaced ship and previews a valid footprint on hover', () => {
    ui()
    expect(screen.getByTestId('ship-tray-kelp-carrier').getAttribute('aria-pressed')).toBe('true')
    fireEvent.mouseEnter(cell('player-grid', 2, 3))
    for (let x = 2; x < 7; x++) expect(cell('player-grid', x, 3).dataset.preview).toBe('valid')
    expect(cell('player-grid', 7, 3).dataset.preview).toBeUndefined()
  })

  it('clamps the footprint to the board near an edge', () => {
    ui()
    fireEvent.mouseEnter(cell('player-grid', 9, 0))
    for (let x = 5; x < 10; x++) expect(cell('player-grid', x, 0).dataset.preview).toBe('valid')
    expect(clampOrigin({ x: 9, y: 9 }, 3, 'vertical')).toEqual({ x: 9, y: 7 })
  })

  it('places on click, rotates with R, flags overlaps as invalid and picks ships back up', () => {
    ui()
    fireEvent.click(cell('player-grid', 0, 0))
    expect(store().playerBoard.ships.map((s) => s.spec.id)).toEqual(['kelp-carrier'])
    for (let x = 0; x < 5; x++) expect(cell('player-grid', x, 0).dataset.state).toBe('ship')
    expect(screen.getByTestId('ship-tray-kelp-carrier').dataset.placed).toBe('true')
    expect(screen.getByTestId('ship-tray-clam-cruiser').getAttribute('aria-pressed')).toBe('true')

    fireEvent.keyDown(window, { key: 'r' })
    fireEvent.mouseEnter(cell('player-grid', 1, 0))
    for (let y = 0; y < 4; y++) expect(cell('player-grid', 1, y).dataset.preview).toBe('invalid')

    fireEvent.mouseEnter(cell('player-grid', 7, 2))
    for (let y = 2; y < 6; y++) expect(cell('player-grid', 7, y).dataset.preview).toBe('valid')
    fireEvent.click(cell('player-grid', 7, 2))
    expect(store().playerBoard.ships.find((s) => s.spec.id === 'clam-cruiser')?.orientation).toBe('vertical')

    fireEvent.click(cell('player-grid', 3, 0))
    expect(store().playerBoard.ships.map((s) => s.spec.id)).toEqual(['clam-cruiser'])
    expect(screen.getByTestId('ship-tray-kelp-carrier').getAttribute('aria-pressed')).toBe('true')
  })

  it('supports drag and drop from the tray', () => {
    ui()
    const dt = { setData: vi.fn(), effectAllowed: '' }
    fireEvent.dragStart(screen.getByTestId('ship-tray-pebble-patrol'), { dataTransfer: dt })
    fireEvent.dragOver(cell('player-grid', 4, 4), { dataTransfer: dt })
    expect(cell('player-grid', 4, 4).dataset.preview).toBe('valid')
    expect(cell('player-grid', 5, 4).dataset.preview).toBe('valid')
    fireEvent.drop(cell('player-grid', 4, 4), { dataTransfer: dt })
    expect(store().playerBoard.ships.map((s) => s.spec.id)).toEqual(['pebble-patrol'])
  })

  it('auto-place / clear / start battle', () => {
    ui()
    const confirm = screen.getByTestId('confirm-placement') as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByTestId('auto-place'))
    expect(store().playerBoard.ships).toHaveLength(FLEET.length)
    expect(screen.getByTestId('placed-count').textContent).toBe('5/5 placed')
    expect((screen.getByTestId('confirm-placement') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByTestId('clear-placement'))
    expect(store().playerBoard.ships).toHaveLength(0)
    fireEvent.click(screen.getByTestId('auto-place'))
    fireEvent.click(screen.getByTestId('confirm-placement'))
    expect(store().phase).toBe('battle')
    expect(screen.getByTestId('battle')).toBeTruthy()
  })
})

describe('battle', () => {
  beforeEach(() => {
    store().startGame('medium')
    store().autoPlacePlayerFleet()
    store().confirmPlacement()
  })

  it('fires, blocks input while Devin thinks, then hands the turn back', () => {
    vi.useFakeTimers()
    ui()
    expect(screen.getByTestId('status').textContent).toContain('Your turn')
    fireEvent.click(cell('enemy-grid', 0, 0))
    expect(store().events).toHaveLength(1)
    expect(cell('enemy-grid', 0, 0).dataset.state).not.toBe('unknown')
    expect(screen.getByTestId('status').textContent).not.toContain('Your turn')

    fireEvent.click(cell('enemy-grid', 1, 0))
    expect(store().events).toHaveLength(1)

    act(() => vi.advanceTimersByTime(800))
    expect(screen.getByTestId('status').textContent).toContain('Devin is thinking')
    expect(screen.getByTestId('devin-bubble').dataset.mood).toBe('think')

    act(() => vi.advanceTimersByTime(1400))
    expect(store().events).toHaveLength(2)
    expect(store().events[1].by).toBe('otter')
    act(() => vi.advanceTimersByTime(600))
    expect(screen.getByTestId('status').textContent).toContain('Your turn')
    expect(screen.getByTestId('shot-log').querySelectorAll('li')).toHaveLength(2)
  })

  it('shows fleet status that greys out sunk ships', () => {
    const target = store().otterBoard.ships.find((s) => s.spec.id === 'pebble-patrol')!
    ui()
    vi.useFakeTimers()
    for (const c of target.cells) {
      fireEvent.click(cell('enemy-grid', c.x, c.y))
      act(() => vi.advanceTimersByTime(3000))
    }
    expect(screen.getByTestId('fleet-status-enemy-pebble-patrol').dataset.sunk).toBe('true')
    expect(screen.getByTestId('fleet-status-enemy-afloat').textContent).toBe('4/5 afloat')
  })
})

describe('game over', () => {
  it('shows stats and offers play again / rematch', () => {
    store().startGame('hard')
    store().autoPlacePlayerFleet()
    store().confirmPlacement()
    for (const ship of store().otterBoard.ships) {
      for (const c of ship.cells) {
        if (store().phase !== 'battle') break
        if (store().fireAt(c)) store().otterTurn()
      }
    }
    expect(store().phase).toBe('gameover')
    ui()
    const over = screen.getByTestId('gameover')
    expect(over.dataset.winner).toBe(store().winner)
    expect(screen.getByTestId('stat-shots').textContent).toBe(String(store().events.filter((e) => e.by === 'human').length))
    fireEvent.click(screen.getByTestId('rematch'))
    expect(store().phase).toBe('placement')
    expect(store().difficulty).toBe('hard')
    store().autoPlacePlayerFleet()
    act(() => {
      store().confirmPlacement()
      useGameStore.setState({ phase: 'gameover', winner: 'human' })
    })
    expect(screen.getByTestId('confetti')).toBeTruthy()
    fireEvent.click(screen.getByTestId('play-again'))
    expect(store().phase).toBe('menu')
    expect(screen.getByTestId('main-menu')).toBeTruthy()
  })
})

describe('dialogue', () => {
  it('has a healthy pool of lines and fills placeholders', () => {
    expect(DIALOGUE_LINE_COUNT).toBeGreaterThanOrEqual(40)
    const line = pickLine('player-sunk', { difficulty: 'easy', shipId: 'kelp-carrier', coord: 'B4' }, () => 0)
    expect(line).toContain('Kelp Carrier')
    expect(line).not.toContain('{')
  })
})
