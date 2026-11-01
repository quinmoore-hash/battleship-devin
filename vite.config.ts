/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The app stylesheet is small but render-blocking, and on a slow connection it queues behind the preloaded
 * chunks — the inline boot splash in index.html could not paint until it arrived (~2.2 s on Fast 3G).
 * Load it async (preload → stylesheet on load); App.tsx keeps the splash up until the sheet has applied.
 */
const asyncAppCss = {
  name: 'battleship:async-app-css',
  transformIndexHtml(html: string) {
    return html.replace(/<link rel="stylesheet" crossorigin href="([^"]+\.css)">/, (_m, href: string) => `<link rel="preload" as="style" crossorigin href="${href}" data-app-css onload="this.onload=null;this.rel='stylesheet'">`)
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), asyncAppCss],
  // Served from https://quinmoore-hash.github.io/battleship-devin/
  base: process.env.GITHUB_PAGES ? '/battleship-devin/' : '/',
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Vite 8 (rolldown): vendor groups, first match wins. Keeps three/drei/gsap/howler out of the
        // app chunk so the initial download stays < 600 kB gzip (BUG-022). `postprocessing` is deliberately
        // not grouped: only the lazy `Effects` chunk imports it, so left alone it stays off the menu's
        // critical path (a dedicated group dragged ~80 kB gzip of it into the eager preload list).
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
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
