import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const PAIRS = 'tests/unit/pairs-*.test.ts';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/unit/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: {
    setupFiles: ['tests/unit/setup.ts'],
    environment: 'node',
    // The suite runs its files side by side: under that load even a light test can take seconds.
    testTimeout: 60_000,
    // Two sets: the unit tests (quick), and the two-person motions solved for every pair of builds
    // (most of the time; `npm run test:pairs`, run when holds, bodies or locomotion change).
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], exclude: [PAIRS] } },
      { extends: true, test: { name: 'pairs', include: [PAIRS] } },
    ],
  },
});
