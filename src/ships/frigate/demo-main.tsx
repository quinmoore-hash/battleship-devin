import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { FrigateDemoApp } from './demo'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FrigateDemoApp />
  </StrictMode>,
)
