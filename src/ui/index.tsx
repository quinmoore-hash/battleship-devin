import { useCallback, useEffect, useMemo, useState } from 'react'
import { playSfx } from '../audio'
import { is3dDisabled } from '../scene/flags'
import { useGameStore } from '../store/gameStore'
import { BattleScreen } from './Battle'
import { GameOverScreen } from './GameOver'
import { HowToPlayModal } from './HowToPlay'
import { MainMenu } from './MainMenu'
import { PlacementScreen } from './Placement'
import { SettingsModal } from './SettingsPanel'
import { UiContext, type UiModal } from './UiContext'
import './ui.css'

export { GameWorld } from './world/GameWorld'
export { setDirector, getDirector } from './turnFlow'

export function GameUI() {
  const phase = useGameStore((s) => s.phase)
  const reducedMotion = useGameStore((s) => s.settings.reducedMotion)
  const winner = useGameStore((s) => s.winner)
  const updateSettings = useGameStore((s) => s.updateSettings)
  const colorblind = useGameStore((s) => s.settings.colorblind)
  const [modal, setModal] = useState<UiModal>(null)

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) updateSettings({ reducedMotion: true })
  }, [updateSettings])

  useEffect(() => {
    document.body.style.cursor = ''
  }, [phase])

  useEffect(() => {
    if (phase === 'gameover') playSfx(winner === 'human' ? 'victory' : 'defeat')
  }, [phase, winner])

  const openModal = useCallback((m: UiModal) => setModal(m), [])
  const closeModal = useCallback(() => setModal(null), [])
  const ctx = useMemo(() => ({ openModal }), [openModal])

  return (
    <UiContext.Provider value={ctx}>
      <div className="ui-root" data-testid="ui-root" data-phase={phase} data-reduced-motion={reducedMotion} data-colorblind={colorblind} data-no3d={is3dDisabled()}>
        {phase !== 'menu' && (
          <nav className="corner-nav">
            <button type="button" className="icon-btn" aria-label="How to play" title="How to play" data-testid="nav-how-to-play" onClick={() => (playSfx('ui-click'), setModal('how-to-play'))}>
              ?
            </button>
            <button type="button" className="icon-btn" aria-label="Settings" title="Settings" data-testid="nav-settings" onClick={() => (playSfx('ui-click'), setModal('settings'))}>
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
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="currentColor" d="M19.4 13a7.9 7.9 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a8 8 0 0 0-1.7-1L15 3H9l-.3 2.9a8 8 0 0 0-1.7 1l-2.5-1-2 3.5L4.6 11a7.9 7.9 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a8 8 0 0 0 1.7 1L9 21h6l.3-2.9a8 8 0 0 0 1.7-1l2.5 1 2-3.5ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" />
    </svg>
  )
}
