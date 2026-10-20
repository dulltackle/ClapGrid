import { test, expect } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { build } from 'esbuild';
import { command } from './helpers/command.js';
declare module 'vitest' { interface TaskMeta { boundedRun?: { mode: string; elapsedMs: number; status: number | null; retained: boolean; outerFallback: boolean } } }
const { processIdentity, ownerAlive } = await import(new URL('./helpers/product-process.mjs', import.meta.url).href);

for (const mode of ['timeout', 'cancel', 'refuse-term', 'cleanup-failure', 'cleanup-stall', 'startup-timeout', 'startup-partial', 'unknown-owner', 'command-cleanup-failure']) {
  test(`外部观察 ${mode}：运行退出、原因及项目资源结果`, { timeout: 20000 }, async t => {
    const root = mkdtempSync(join(tmpdir(), `clapgrid-bounded-${mode}-`));
    const report = join(root, 'vitest.json');
    let foreign: ReturnType<typeof command> | undefined;
    let run: ReturnType<typeof command> | undefined;
    t.onTestFinished(async () => {
      const results = await Promise.allSettled([run?.stop(), foreign?.stop()]);
      const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
      if (failures.length) throw new AggregateError(failures, `外层拥有资源尚未退出，保留 ${root}`);
    }, 4000);
    let foreignOwner: any;
    let foreignReady: { url: string; pid: number } | undefined;
    let port = 0;
    if (mode === 'startup-timeout' || mode === 'cancel' || mode === 'unknown-owner') {
      mkdirSync(join(root, 'dist/panel'), { recursive: true }); writeFileSync(join(root, 'package.json'), '{"type":"module"}');
      writeFileSync(join(root, 'dist/panel/index.html'), '受控就绪回执');
      await build({ entryPoints: ['src/runtime.ts', 'src/service/main.ts', 'src/business/media-worker.ts'], outbase: 'src', outdir: join(root, 'dist'), bundle: true, platform: 'node', format: 'esm', external: ['vite'], banner: { js: "import {createRequire} from 'node:module';const require=createRequire(import.meta.url);" } });
      const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
      port = (socket.address() as import('node:net').AddressInfo).port;
      await new Promise<void>(resolve => socket.close(() => resolve()));
    }
    if (mode === 'unknown-owner') {
      foreign = command(process.execPath, [join(root, 'dist/service/main.js'), '--project', join(root, 'foreign-project'), '--port', String(port)], { timeout: 18000 });
      void foreign.catch(() => {});
      foreignOwner = processIdentity(foreign.child.pid);
      let output = '';
      foreign.child.stdout!.on('data', chunk => {
        output += String(chunk);
        if (output.includes('\n')) foreignReady = JSON.parse(output.split('\n')[0]!);
      });
      await expect.poll(() => Boolean(foreignReady)).toBe(true);
      expect((await fetch(`${foreignReady!.url}/api/status`)).ok).toBe(true);
    }
    const start = performance.now();
    run = command(process.execPath, mode === 'cancel' ? [resolve('tests/fixtures/bounded-run/cancel.mjs'), report] : [resolve('node_modules/vitest/vitest.mjs'), 'run', '--config', 'tests/fixtures/bounded-run/vitest.config.ts', '--reporter=json', '--outputFile', report], {
      timeout: 14000, signal: t.signal, input: mode === 'cancel' ? null : undefined,
      env: { ...process.env, CLAPGRID_TEST_FAULT: mode, CLAPGRID_FAULT_ROOT: root, CLAPGRID_FAULT_PORT: String(port), CLAPGRID_FOREIGN_OWNER: JSON.stringify(foreignOwner) },
    });
    void run.catch(() => {});
    // 外层兜底只对本次 command 已登记的出生身份生效；一旦需要兜底，await run 必须失败。

    let serviceOwner: any;
    if (mode === 'cancel' || mode === 'startup-timeout') {
      await expect.poll(() => existsSync(join(root, 'ready.json')), { timeout: 5000 }).toBe(true);
      const ready = JSON.parse(readFileSync(join(root, 'ready.json'), 'utf8'));
      serviceOwner = processIdentity(ready.pid);
      expect(serviceOwner).toBeTruthy();
      expect((await fetch(`${ready.url}/api/status`)).ok).toBe(true);
      if (mode === 'cancel') run.child.stdin!.write('cancel\n');
    }
    const result = await run;
    const elapsed = performance.now() - start;
    expect(run.remainingProcesses(), '被测运行结束时不得仍依赖外层终止本例进程').toEqual([]);
    expect(elapsed).toBeLessThan(14000);
    expect(result.status).not.toBe(0);
    expect(existsSync(report)).toBe(true);
    const native = readFileSync(report, 'utf8');
    const observation = JSON.parse(readFileSync(join(root, 'observed.json'), 'utf8'));
    const retained = ['cleanup-failure', 'cleanup-stall', 'startup-partial', 'unknown-owner', 'command-cleanup-failure'].includes(mode);
    expect(observation.directoryExists).toBe(retained);
    if (mode.startsWith('cleanup-') || mode === 'unknown-owner') {
      expect(native).toContain('原始测试失败');
      expect(native).toMatch(/关闭失败|关闭未确认|出生身份不明/);
      expect(existsSync(join(root, 'independent-closed.json'))).toBe(true);
    }
    if (mode === 'command-cleanup-failure') { expect(native).toContain('命令超时'); expect(native).toContain('未确认退出'); }
    if (mode === 'refuse-term') expect(native).toContain('命令超时');
    if (mode === 'timeout' || mode === 'startup-timeout') expect(native).toContain('timed out');
    if (serviceOwner) expect(ownerAlive(serviceOwner)).toBe(false);
    if (mode === 'cancel') { expect(result.status).toBe(1); expect(observation.cancelled).toBe(true); expect(observation.reason).toMatch(/aborted by the user/); }
    if (foreignOwner) {
      expect(ownerAlive(foreignOwner)).toBe(true);
      const status = await (await fetch(`${foreignReady!.url}/api/status`)).json();
      expect(status.snapshot.project.directory).toBe(join(root, 'foreign-project'));
      expect(status.taskLocked).toBe(false);
    }
    await foreign?.stop();
    if (foreign) await foreign;
    // 保留专项观测摘要到原生 metadata；异常现场目录由预期的失败结果决定。
    t.task.meta.boundedRun = { mode, elapsedMs: Math.round(elapsed), status: result.status, retained, outerFallback: false };
    if (!retained) rmSync(root, { recursive: true, force: true });
  });
}
