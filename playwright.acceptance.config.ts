import { defineConfig } from '@playwright/test';
import { sharedConfig } from './tests/helpers/playwright-config.js';

// 进程组的 SIGTERM 交给验收 worker 正常结束测试和 teardown。
// SIGINT 继续由 Playwright 原生中断流程执行 teardown。
if (process.env.TEST_WORKER_INDEX === undefined) process.on('SIGTERM', () => {});

export default defineConfig({
  ...sharedConfig,
  metadata: { acceptance: true },
  testDir: './tests/acceptance',
  testMatch: '**/*.acceptance.ts',
  grep: process.argv.some(argument => argument === '--grep' || argument === '-g' || argument.startsWith('--grep=') || argument.startsWith('-g=')) ? undefined : /空项目$/,
  workers: 1,
  timeout: 0,
});
