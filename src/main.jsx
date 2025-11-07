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

  const shouldReplace = (scriptURL) => {
    try {
      const url = scriptURL instanceof URL ? scriptURL : new URL(scriptURL, window.location.href);
      const pathname = url.pathname;
      return pathname.startsWith('/assets/') && pathname.includes('service-worker');
    } catch {
      return false;
    }
  };

  navigator.serviceWorker.register = (scriptURL, options) => {
    if (shouldReplace(scriptURL)) {
      const mergedOptions = { ...options, scope: '/' };
      if (mergedOptions.type === 'module') {
        delete mergedOptions.type; // our worker is classic JS
      }
      return originalRegister('/react-py-sw.js', mergedOptions);
    }

    return originalRegister(scriptURL, options);
  };
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
