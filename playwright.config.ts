import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 3,
  // The WebGL smoke test gets SwiftShader to itself: several software GL contexts starting at once
  // make the canvas fail to mount (bugs.md BUG-030), so it runs after the flow tests finish.
  projects: [
    { name: 'flows', testIgnore: /scene\.spec\.ts/ },
    { name: 'scene', testMatch: /scene\.spec\.ts/, dependencies: ['flows'] },
  ],
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
