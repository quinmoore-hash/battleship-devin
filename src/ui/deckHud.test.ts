// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { director } from '../cinematics'
import { CANNON_RELEASED, useDeckStore } from '../deck/deckStore'
import { useGameStore } from '../store/gameStore'
import { GameUI } from './index'

const store = () => useGameStore.getState()
const esc = (target: Element = document.body) => fireEvent.keyDown(target, { key: 'Escape', code: 'Escape' })
const hud = () => screen.getByTestId('deck-hud')

// The deck HUD without a scene: the store drives deck mode (`setDeck` / `manStation`) exactly as the controller would.
describe('deck HUD: Esc leaves the cannon', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    store().reset()
    store().startGame('medium')
    store().autoPlacePlayerFleet()
    store().confirmPlacement()
    render(createElement(GameUI))
    act(() => store().setDeck(true))
    act(() => store().manStation(0))
  })
  afterEach(() => {
    cleanup()
    director.store.setState({ busy: false })
    useDeckStore.setState({ nudge: null })
    vi.useRealTimers()
  })

  it('shows the way out while manning, in cannon wording', () => {
    expect(hud().dataset.view).toBe('gun')
    expect(screen.getByTestId('deck-prompt').textContent).toContain('Esc — Leave the cannon')
    expect(screen.getByTestId('deck-station').textContent).toMatch(/^Manning the (port|starboard) cannon \d+$/)
    expect(screen.getByTestId('deck-step-away').textContent).toContain('Leave the cannon')
    expect(screen.getByTestId('deck-hud').textContent).not.toMatch(/\bgun\b/i)
  })

  it('Esc releases the cannon, keeps deck mode, opens nothing and toasts "Cannon released" for 1.5 s', () => {
    act(() => void esc())
    expect(store().deck.station).toBeNull()
    expect(store().deck.on).toBe(true)
    expect(hud().dataset.view).toBe('walk')
    expect(screen.getByTestId('deck-station').textContent).toBe('Walking the deck')
    expect(screen.getByTestId('deck-prompt').textContent).toBe(CANNON_RELEASED)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    act(() => void vi.advanceTimersByTime(1400))
    expect(screen.getByTestId('deck-prompt').textContent).toBe(CANNON_RELEASED)
    act(() => void vi.advanceTimersByTime(200))
    expect(screen.getByTestId('deck-prompt').textContent).not.toBe(CANNON_RELEASED)
    // a second Esc while walking changes nothing on deck
    act(() => void esc())
    expect(store().deck.on).toBe(true)
    expect(screen.getByTestId('deck-prompt').textContent).not.toBe(CANNON_RELEASED)
  })

  it('the HUD button releases with the same toast', () => {
    fireEvent.click(screen.getByTestId('deck-step-away'))
    expect(store().deck.station).toBeNull()
    expect(screen.getByTestId('deck-prompt').textContent).toBe(CANNON_RELEASED)
  })

  it('a running cinematic keeps the seat (Esc skips the cinematic instead)', () => {
    director.store.setState({ busy: true })
    act(() => void esc())
    expect(store().deck.station).toBe(0)
    expect(screen.getByTestId('deck-prompt').textContent).not.toBe(CANNON_RELEASED)
  })

  it('an open dialog owns Esc: the quit prompt closes, the cannon stays manned', () => {
    fireEvent.click(screen.getByTestId('quit'))
    expect(screen.getByTestId('quit-modal')).toBeTruthy()
    act(() => void esc())
    expect(screen.queryByTestId('quit-modal')).toBeNull()
    expect(store().deck.station).toBe(0)
    expect(store().phase).toBe('battle')
  })

  it('Esc with modifiers or inside a text field is ignored', () => {
    act(() => void fireEvent.keyDown(document.body, { key: 'Escape', ctrlKey: true }))
    expect(store().deck.station).toBe(0)
    const input = document.createElement('input')
    document.body.appendChild(input)
    act(() => void esc(input))
    expect(store().deck.station).toBe(0)
    input.remove()
  })
})
