import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { AudioDemo } from './AudioDemo'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AudioDemo />
  </StrictMode>,
)
