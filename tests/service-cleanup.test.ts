import { test, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { command } from './helpers/command.js';

declare module 'vitest' { interface TaskMeta { serviceCleanup?: { mode: string; shutdownElapsed?: number; retained: boolean; guardianExited?: boolean } } }

for (const mode of ['initialization', 'http', 'deadline', 'http-stall']) {
  test(`原生异常报告及真实资源：${mode}`, { timeout: 25000 }, async t => {
    const root = await mkdtemp(join(tmpdir(), `clapgrid-cleanup-${mode}-`));
    await writeFile(join(root, 'index.html'), 'ClapGrid');
    const report = join(root, 'vitest.json');
    const run = command(process.execPath, [resolve('node_modules/vitest/vitest.mjs'), 'run', '--config', 'tests/fixtures/service-cleanup/vitest.config.ts', '--reporter=json', '--outputFile', report], {
      timeout: 22000, env: { ...process.env, CLAPGRID_CLEANUP_ROOT: root, CLAPGRID_CLEANUP_FAULT: mode },
    });
    let confirmed = false;
    try {
      const result = await run;
      expect(result.status).toBe(1);
      expect(run.remainingProcesses()).toEqual([]);
      const native = JSON.parse(await readFile(report, 'utf8'));
      expect(native.numFailedTests).toBe(1);
      expect(native.testResults.flatMap((suite: any) => suite.assertionResults.flatMap((item: any) => item.failureMessages))).toHaveLength(mode === 'initialization' || mode === 'http-stall' ? 2 : 1);
      const errors = native.testResults.flatMap((suite: any) => suite.assertionResults.flatMap((item: any) => item.failureMessages)).join('\n');
      expect(errors).not.toMatch(/AssertionError|Cannot read properties|Hook timed out/);
      expect(errors).toMatch(mode === 'initialization' ? /JSON.*SQLite 关闭失败/ : mode === 'http' ? /HTTP 关闭失败/ : /超时，未确认释放/);
      const observation = JSON.parse(await readFile(join(root, 'observed.json'), 'utf8'));
      expect(observation.retained).toBe(true);
      if (mode !== 'initialization') {
        expect(observation.guardianExited).toBe(true);
        expect(observation.independentAlive).toBe(true);
        if (mode === 'http-stall') expect(observation.cancelled).toBe(true);
      }
      t.task.meta.serviceCleanup = { mode, ...observation };
      confirmed = true;
    } finally {
      await run.stop();
      // 子 suite 及媒体均已退出，才由外层释放本次故障现场。
      if (confirmed) await rm(root, { recursive: true, force: true });
    }
  });
}
