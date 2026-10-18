import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const root = process.cwd();
const files: string[] = process.env.CLAPGRID_PLAYWRIGHT_FILES
  ? JSON.parse(process.env.CLAPGRID_PLAYWRIGHT_FILES)
  : JSON.parse(readFileSync(resolve(root, 'scripts/test-inventory.json'), 'utf8')).files.filter((item: { executor: string }) => item.executor === 'playwright').map((item: { file: string }) => item.file);
if (!files.length) throw Error('Playwright 必须有明确的非空执行清单');
export default defineConfig({
  testDir: resolve(root, 'tests'),
  testMatch: files.map(file => resolve(root, file)),
  fullyParallel: false,
  workers: Number(process.env.CLAPGRID_TEST_CONCURRENCY ?? 2),
  retries: 0,
  forbidOnly: true,
  timeout: 40000,
  outputDir: process.env.CLAPGRID_PLAYWRIGHT_OUTPUT ?? resolve(root, 'logs/playwright-results'),
  metadata: { executionId: process.env.CLAPGRID_TEST_EXECUTION_ID },
  reporter: [['list'], ['json', { outputFile: process.env.CLAPGRID_PLAYWRIGHT_NATIVE }]],
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
