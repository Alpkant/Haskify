// if (import.meta.env.MODE === 'production') {
//   console.log = () => {}
//   console.error = () => {}
//   console.debug = () => {}
// }

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const originalRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);

  navigator.serviceWorker.register = (scriptURL, options) => {
    if (typeof scriptURL === 'string' && scriptURL.includes('/assets/service-worker')) {
      return originalRegister('/react-py-sw.js', { scope: '/' });
    }
    return originalRegister(scriptURL, options);
  };
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
