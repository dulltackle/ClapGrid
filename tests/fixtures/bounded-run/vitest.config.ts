import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  test: {
    include: ['tests/fixtures/bounded-run/scenarios.fixture.ts'],
    pool: 'forks', maxWorkers: 1, fileParallelism: false,
    testTimeout: 500, hookTimeout: 10000,
    retry: 0, allowOnly: false, passWithNoTests: false,
  },
});
