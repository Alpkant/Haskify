import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['pyodide', 'pyodide.asm.js']
  },
  build: {
    // optionally avoid bundling wasm modules
    rollupOptions: {
      external: ['pyodide']
    }
  }
})
