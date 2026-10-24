import { defineConfig } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

// worker 继承主进程分配的目录；只在主进程启动时拒绝覆盖旧证据。
if (process.env.CLAPGRID_PLAYWRIGHT_RUN_DIR !== undefined && process.env.TEST_WORKER_INDEX === undefined) {
  const directory = resolve(process.env.CLAPGRID_PLAYWRIGHT_RUN_DIR);
  if (existsSync(directory) && readdirSync(directory).length > 0) {
    throw new Error(`CLAPGRID_PLAYWRIGHT_RUN_DIR 指定的目录非空：${directory}。请换名或手动删除旧目录后重试。`);
  }
}
const runDirectory = resolve(process.env.CLAPGRID_PLAYWRIGHT_RUN_DIR
  ?? `logs/playwright/${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
process.env.CLAPGRID_PLAYWRIGHT_RUN_DIR = runDirectory;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/helpers/panel-setup.ts',
  fullyParallel: false,
  workers: 3,
  retries: 0,
  forbidOnly: true,
  timeout: 40000,
  expect: { timeout: 10000 },
  outputDir: join(runDirectory, 'results'),
  reporter: [['list'], ['html', { outputFolder: join(runDirectory, 'report'), open: 'never' }], ['json', { outputFile: join(runDirectory, 'report.json') }]],
  use: {
    browserName: 'chromium',
    channel: process.env.CHROME_BIN ? undefined : 'chrome',
    launchOptions: { executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage'] },
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
