/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Served from https://quinmoore-hash.github.io/battleship-devin/
  base: process.env.GITHUB_PAGES ? '/battleship-devin/' : '/',
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
})
