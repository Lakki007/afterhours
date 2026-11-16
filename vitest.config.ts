import { defineConfig } from 'vitest/config';

// `npm test` runs every test that does not need a browser: shared + server + pure web logic.
// Browser flows live in e2e/ and run with `npm run e2e` (Playwright).
export default defineConfig({
  test: {
    include: ['shared/src/**/*.test.ts', 'server/{src,test}/**/*.test.ts', 'web/src/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    testTimeout: 20_000,
  },
});
