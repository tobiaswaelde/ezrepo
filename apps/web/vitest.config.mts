import { defineConfig } from 'vitest/config';

/** Keep Playwright browser scenarios out of the fast Vitest unit-test suite. */
export default defineConfig({
  test: {
    exclude: ['node_modules/**', 'dist/**', '.idea/**', '.git/**', '.cache/**', 'tests/e2e/**', 'tests/pwa/**'],
  },
});
