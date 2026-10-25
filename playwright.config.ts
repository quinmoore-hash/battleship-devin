import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 3,
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1024, height: 700 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // Headless Chromium has no GPU; SwiftShader gives us a software WebGL context.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
