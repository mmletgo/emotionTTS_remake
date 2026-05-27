import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Vite config for EmotionTTS React UI.
// Dev: proxy /api /v1 /outputs /characters to FastAPI on :9880.
// Build: emit to ../webapp/frontend so FastAPI's static mount serves the SPA.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api':        { target: 'http://127.0.0.1:9880', changeOrigin: true },
      '/v1':         { target: 'http://127.0.0.1:9880', changeOrigin: true },
      '/outputs':    { target: 'http://127.0.0.1:9880', changeOrigin: true },
      '/characters': { target: 'http://127.0.0.1:9880', changeOrigin: true },
    },
  },
  build: {
    outDir: '../webapp/frontend',
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
  },
})
