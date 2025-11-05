import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'configure-response-headers',
      configureServer: (server) => {
        server.middlewares.use((_req, res, next) => {
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
          next();
        });
      },
    },
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
