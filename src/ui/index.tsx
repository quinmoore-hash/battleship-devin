import { useCallback, useEffect, useMemo, useState } from 'react'
import { playSfx } from '../audio'
import { useGameStore } from '../store/gameStore'
import { BattleScreen } from './Battle'
import { GameOverScreen } from './GameOver'
import { HowToPlayModal } from './HowToPlay'
import { MainMenu } from './MainMenu'
import { PlacementScreen } from './Placement'
import { SettingsModal } from './SettingsPanel'
import { UiContext, type UiModal } from './UiContext'
import './ui.css'

export function GameUI() {
  const phase = useGameStore((s) => s.phase)
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const winner = useGameStore((s) => s.winner)
  const updateSettings = useGameStore((s) => s.updateSettings)
  const [modal, setModal] = useState<UiModal>(null)

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) updateSettings({ reducedMotion: true })
  }, [updateSettings])

  useEffect(() => {
    if (phase === 'gameover') playSfx(winner === 'human' ? 'victory' : 'defeat')
  }, [phase, winner])

  const openModal = useCallback((m: UiModal) => setModal(m), [])
  const closeModal = useCallback(() => setModal(null), [])
  const ctx = useMemo(() => ({ openModal }), [openModal])

  return (
    <UiContext.Provider value={ctx}>
      <div className="ui-root" data-testid="ui-root" data-phase={phase} data-reduced-motion={reducedMotion}>
        {phase !== 'menu' && (
          <nav className="corner-nav">
            <button
              type="button"
              className="icon-btn"
              aria-label="How to play"
              title="How to play"
              data-testid="nav-how-to-play"
              onClick={() => (playSfx('ui-click'), setModal('how-to-play'))}
            >
              ?
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Settings"
              title="Settings"
              data-testid="nav-settings"
              onClick={() => (playSfx('ui-click'), setModal('settings'))}
            >
              <GearIcon />
            </button>
          </nav>
        )}
        <div className="phase" key={phase}>
          {phase === 'menu' && <MainMenu />}
          {phase === 'placement' && <PlacementScreen />}
          {phase === 'battle' && <BattleScreen />}
          {phase === 'gameover' && <GameOverScreen />}
        </div>
        {modal === 'settings' && <SettingsModal onClose={closeModal} />}
        {modal === 'how-to-play' && <HowToPlayModal onClose={closeModal} />}
      </div>
    </UiContext.Provider>
  )
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  )
}
