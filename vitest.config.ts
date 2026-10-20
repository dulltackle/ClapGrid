import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: { '@': fileURLToPath(new URL('./src/panel', import.meta.url)) } },
  test: {
    environment: 'node', includeTaskLocation: true,
    include: ['tests/**/*.test.ts'],
    pool: 'forks', maxWorkers: 1, fileParallelism: false, isolate: true,
    testTimeout: 15000, hookTimeout: 10000,
    expect: { poll: { timeout: 5000, interval: 20 } },
    retry: 0, allowOnly: false, passWithNoTests: false,
  },
});
