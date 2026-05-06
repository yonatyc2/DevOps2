import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api/logs':     { target: 'http://localhost:3001', changeOrigin: true },
      '/api/certs':    { target: 'http://localhost:3001', changeOrigin: true },
      '/api/registry': { target: 'http://localhost:3001', changeOrigin: true },
      '/api/health':   { target: 'http://localhost:3001', changeOrigin: true },
      '/api':          { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
  build: {
    outDir: 'build'
  },
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.js',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**'
    ],
    reporters: ['verbose', 'junit', 'html'],
    outputFile: {
      junit: './reports/junit.xml',
      html: './reports/html/index.html'
    }
  }
})
