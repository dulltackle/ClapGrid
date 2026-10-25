import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';

// worker 继承主进程分配的目录；只在主进程启动时拒绝覆盖旧证据。
if (process.env.CLAPGRID_PLAYWRIGHT_RUN_DIR !== undefined && process.env.TEST_WORKER_INDEX === undefined) {
  const directory = resolve(process.env.CLAPGRID_PLAYWRIGHT_RUN_DIR);
  if (existsSync(directory) && readdirSync(directory).length > 0) {
    throw new Error(`CLAPGRID_PLAYWRIGHT_RUN_DIR 指定的目录非空：${directory}。请换名或手动删除旧目录后重试。`);
  }
}
export const runDirectory = resolve(process.env.CLAPGRID_PLAYWRIGHT_RUN_DIR
  ?? `logs/playwright/${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`);
process.env.CLAPGRID_PLAYWRIGHT_RUN_DIR = runDirectory;

export const sharedConfig = {
  globalSetup: './tests/helpers/panel-setup.ts',
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  outputDir: join(runDirectory, 'results'),
  reporter: [['list'], ['html', { outputFolder: join(runDirectory, 'report'), open: 'never' }], ['json', { outputFile: join(runDirectory, 'report.json') }]],
} satisfies PlaywrightTestConfig;
