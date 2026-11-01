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
    // The flow tests run `?no3d`: no WebGL, so no SwiftShader flags — with them every `click()` waits ~5× longer for the
    // software-composited page to settle and a 100-turn game outgrows the test timeout on a loaded runner (BUG-716).
    { name: 'flows', testIgnore: /(scene|vfx-.*)\.spec\.ts/ },
    {
      name: 'scene',
      testMatch: /(scene|vfx-.*)\.spec\.ts/,
      dependencies: ['flows'],
      workers: 1,
      use: {
        launchOptions: {
          // Headless Chromium has no GPU; SwiftShader gives us a software WebGL context.
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1024, height: 700 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
