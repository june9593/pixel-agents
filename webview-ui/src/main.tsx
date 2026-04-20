import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { initLocale } from './i18n.ts'
import App from './App.tsx'

initLocale()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
