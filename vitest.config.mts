import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** The slow ones: two-person motions on every pair of builds, one-person motions on every build, the coverages on every build, whole films and scenarios. */
const SLOW = ['tests/unit/pairs-*.test.ts', 'tests/unit/builds-matrix.test.ts', 'tests/unit/coverage-matrix.test.ts', 'tests/unit/films.test.ts', 'tests/unit/stagedfilms.test.ts', 'tests/unit/scenarios.test.ts'];

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
    // Two sets: the unit tests (a minute or two), and the slow ones (`npm run test:slow`: the
    // matrices over builds, whole films; most of the time, run in CI).
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], exclude: SLOW } },
      { extends: true, test: { name: 'slow', include: SLOW } },
    ],
  },
});
