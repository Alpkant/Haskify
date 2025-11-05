import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import crossOriginIsolation from 'vite-plugin-cross-origin-isolation'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    crossOriginIsolation()
  ],
  optimizeDeps: {
    exclude: ['pyodide', 'react-py']
  },
  build: {
    rollupOptions: {
      external: ['pyodide'],
      output: {
        globals: {
          pyodide: 'pyodide'
        }
      }
    }
  },
  define: {
    global: 'globalThis',
  },
  worker: {
    format: 'es',
  }
})
