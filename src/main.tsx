import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/libre-caslon-text/400.css'
import '@fontsource/libre-caslon-text/400-italic.css'
import '@fontsource/archivo/400.css'
import '@fontsource/archivo/500.css'
import '@fontsource/archivo/600.css'
import '@fontsource/dm-mono/400.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/table.css'
import './styles/stage.css'
import './styles/tray.css'
import './styles/dialog.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
