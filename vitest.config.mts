import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The slow ones: two-person motions on every pair of builds, one-person motions on every build, the coverages on every build, whole films and scenarios. */
const SLOW = ['tests/unit/pairs-*.test.ts', 'tests/unit/builds-matrix.test.ts', 'tests/unit/coverage-*.test.ts', 'tests/unit/films.test.ts', 'tests/unit/stagedfilms.test.ts', 'tests/unit/scenarios.test.ts'];

/**
 * About how long each slow file takes alone in CI (seconds): CI's shards (--shard) take them by it,
 * the longest first, each to the shard with the least so far, so no shard waits on two long ones
 * (by file name, as vitest does, two could fall together: one shard 11 minutes, another 2). A file
 * not listed counts a minute; list it once it has run.
 */
const SECONDS: Record<string, number> = {
  'stagedfilms.test.ts': 300, 'pairs-captured.test.ts': 60, 'films.test.ts': 30, 'pairs-carry.test.ts': 15, 'scenarios.test.ts': 10, 'builds-matrix.test.ts': 5,
  'coverage-woman.test.ts': 180, 'coverage-man.test.ts': 180, 'coverage-tall-man.test.ts': 180, 'coverage-big-man.test.ts': 180, 'coverage-tall-woman.test.ts': 180, 'coverage-child.test.ts': 180,
};

class Balanced extends BaseSequencer {
  async shard(files: TestSpecification[]) {
    const { index, count } = this.ctx.config.shard!;
    const cost = (f: TestSpecification) => SECONDS[basename(f.moduleId)] ?? 60;
    const shards = Array.from({ length: count }, () => ({ cost: 0, files: [] as TestSpecification[] }));
    for (const f of [...files].sort((a, b) => cost(b) - cost(a) || a.moduleId.localeCompare(b.moduleId))) {
      const least = shards.reduce((m, s) => (s.cost < m.cost ? s : m));
      least.files.push(f);
      least.cost += cost(f);
    }
    return shards[index - 1].files;
  }
}

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
    sequence: { sequencer: Balanced },
    // Two sets: the unit tests (a minute or two), and the slow ones (`npm run test:slow`: the
    // matrices over builds, whole films; most of the time, run in CI).
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], exclude: SLOW } },
      // (The matrices keep every build's scenes and cameras worked out in one worker: more room than node's default.)
      { extends: true, test: { name: 'slow', include: SLOW, execArgv: ['--max-old-space-size=8192'] } },
    ],
  },
});
