import { defineConfig } from '@playwright/test';

/** Production-only browser checks for generated PWA resources and service-worker lifecycle behavior. */
export default defineConfig({
  testDir: './tests/pwa',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:3310',
    headless: true,
    viewport: { height: 900, width: 1440 },
  },
  webServer: {
    command: 'node .output/server/index.mjs',
    env: { HOST: '127.0.0.1', PORT: '3310' },
    reuseExistingServer: false,
    timeout: 30_000,
    url: 'http://127.0.0.1:3310',
  },
  projects: [{ name: 'chromium' }],
});
