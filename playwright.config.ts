import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 2,
  retries: 0,
  forbidOnly: true,
  timeout: 40000,
  expect: { timeout: 10000 },
  outputDir: 'logs/playwright-results',
  reporter: [['list'], ['html', { outputFolder: 'logs/playwright-report', open: 'never' }]],
  use: {
    browserName: 'chromium',
    channel: process.env.CHROME_BIN ? undefined : 'chrome',
    launchOptions: { executablePath: process.env.CHROME_BIN, args: ['--no-sandbox', '--disable-dev-shm-usage'] },
    viewport: { width: 1600, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
