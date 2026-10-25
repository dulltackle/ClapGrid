import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-playwright-config-'));
  directories.push(directory);
  return directory;
}

function loadConfig(runDirectory?: string, workerIndex?: string, acceptance = false) {
  const env = { ...process.env };
  delete env.CLAPGRID_PLAYWRIGHT_RUN_DIR;
  delete env.TEST_WORKER_INDEX;
  if (runDirectory !== undefined) env.CLAPGRID_PLAYWRIGHT_RUN_DIR = runDirectory;
  if (workerIndex !== undefined) env.TEST_WORKER_INDEX = workerIndex;
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import config from './${acceptance ? 'playwright.acceptance.config.ts' : 'playwright.config.ts'}';
    console.log(JSON.stringify({
      outputDir: config.outputDir, reporter: config.reporter,
      testDir: config.testDir, testMatch: config.testMatch, timeout: config.timeout,
      grep: String(config.grep), workers: config.workers, retries: config.retries, forbidOnly: config.forbidOnly,
      runDirectory: process.env.CLAPGRID_PLAYWRIGHT_RUN_DIR, pid: process.pid,
    }));
  `], { cwd: resolve('.'), env, encoding: 'utf8' });
}

test('显式运行目录承载全部 Playwright 原生产物', () => {
  const directory = join(temporaryDirectory(), 'explicit');
  const result = loadConfig(directory);
  expect(result.status, result.stderr).toBe(0);
  const config = JSON.parse(result.stdout);
  expect(config.outputDir).toBe(join(directory, 'results'));
  expect(config.reporter).toEqual([
    ['list'], ['html', { outputFolder: join(directory, 'report'), open: 'never' }],
    ['json', { outputFile: join(directory, 'report.json') }],
  ]);
});

test('默认生成 UTC 时间戳和主进程 PID 目录并写回环境变量', () => {
  const result = loadConfig();
  expect(result.status, result.stderr).toBe(0);
  const config = JSON.parse(result.stdout);
  expect(config.runDirectory).toMatch(new RegExp(`/logs/playwright/\\d{4}-\\d{2}-\\d{2}T[\\d-]+Z-${config.pid}$`));
  expect(config.outputDir).toBe(join(config.runDirectory, 'results'));
});

test('显式目录非空时在运行测试前拒绝，保留已有证据', () => {
  const directory = temporaryDirectory();
  writeFileSync(join(directory, 'evidence.txt'), 'previous run');
  const result = loadConfig(directory);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('CLAPGRID_PLAYWRIGHT_RUN_DIR');
  expect(result.stderr).toContain('非空');
});

test('worker 重新加载配置时沿用主进程目录，允许本轮已有附件', () => {
  const directory = temporaryDirectory();
  writeFileSync(join(directory, 'attachment.txt'), 'current run');
  const result = loadConfig(directory, '0');
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).outputDir).toBe(join(directory, 'results'));
});

test('显式相对路径按工作目录解析，已有空目录可用', () => {
  const directory = temporaryDirectory();
  const result = loadConfig(relative(resolve('.'), directory));
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).outputDir).toBe(join(directory, 'results'));
});


test('验收入口单独收集，普通浏览器测试不收集验收场景', () => {
  const regular = loadConfig();
  expect(regular.status, regular.stderr).toBe(0);
  expect(JSON.parse(regular.stdout).testMatch).toBe('**/*.spec.ts');
  const acceptance = loadConfig(undefined, undefined, true);
  expect(acceptance.status, acceptance.stderr).toBe(0);
  expect(JSON.parse(acceptance.stdout)).toMatchObject({
    testDir: './tests/acceptance', testMatch: '**/*.acceptance.ts',
    timeout: 0, grep: '/空项目$/', workers: 1, retries: 0, forbidOnly: true,
  });
});
