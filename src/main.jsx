// if (import.meta.env.MODE === 'production') {
//   console.log = () => {}
//   console.error = () => {}
//   console.debug = () => {}
// }

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
