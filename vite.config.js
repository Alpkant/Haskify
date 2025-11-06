import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import crossOriginIsolation from 'vite-plugin-cross-origin-isolation'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Only use crossOriginIsolation plugin in development
    // Vercel handles these headers via vercel.json
    ...(process.env.NODE_ENV !== 'production' ? [crossOriginIsolation()] : [])
  ],
  optimizeDeps: {
    exclude: ['pyodide', 'react-py'],
    esbuildOptions: {
      target: 'esnext'
    }
  },
  build: {
    target: 'esnext',
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
    plugins: () => []
  }
})
