/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served from https://quinmoore-hash.github.io/battleship-devin/
  base: process.env.GITHUB_PAGES ? '/battleship-devin/' : '/',
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Vite 8 (rolldown): vendor groups, first match wins. Keeps three/drei/postprocessing/gsap/howler
        // out of the app chunk so the initial download stays < 600 kB gzip (BUG-022).
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'postprocessing', test: /node_modules[\\/](@react-three[\\/]postprocessing|postprocessing)[\\/]/ },
            { name: 'drei', test: /node_modules[\\/](@react-three[\\/]drei|three-stdlib|maath|camera-controls|three-mesh-bvh|stats-gl|troika|@mediapipe|hls\.js)[\\/]/ },
            { name: 'gsap', test: /node_modules[\\/]gsap[\\/]/ },
            { name: 'howler', test: /node_modules[\\/]howler[\\/]/ },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|zustand|@react-three[\\/]fiber|its-fine|suspend-react|react-reconciler|react-use-measure)[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
})
