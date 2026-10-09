import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ElementDisplayPage from './features/element-display/ElementDisplayPage.tsx'

const container = document.getElementById('root')
if (!container) throw new Error('#root is missing from display.html')
createRoot(container).render(<StrictMode><ElementDisplayPage /></StrictMode>)
