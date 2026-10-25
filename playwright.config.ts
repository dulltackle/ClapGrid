import { defineConfig } from '@playwright/test';
import { sharedConfig } from './tests/helpers/playwright-config.js';

export default defineConfig({
  ...sharedConfig,
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  workers: 3,
  timeout: 40000,
  expect: { timeout: 10000 },
  use: {
    browserName: 'chromium',
    channel: process.env.CHROME_BIN ? undefined : 'chrome',
    launchOptions: { executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage'] },
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
