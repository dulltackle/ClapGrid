import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  test: { include: ['tests/fixtures/service-cleanup/scenario.fixture.ts'], pool: 'forks', maxWorkers: 1, testTimeout: 20000, hookTimeout: 5000, retry: 0, allowOnly: false },
});
