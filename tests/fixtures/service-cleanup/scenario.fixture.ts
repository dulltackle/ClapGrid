import { test, expect, vi } from 'vitest';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { startService } from '../../../src/service/server.js';
import { queryStatus, modifyBatch, submitSpeech } from '../../../src/shared/client.js';
const { processIdentity, ownerAlive } = await import(new URL('../../helpers/product-process.mjs', import.meta.url).href);
const root = process.env.CLAPGRID_CLEANUP_ROOT!;
const mode = process.env.CLAPGRID_CLEANUP_FAULT!;
const options = { projectDirectory: join(root, 'project'), panelDirectory: root, port: 0 };
const observe = (data: unknown) => writeFileSync(join(root, 'observed.json'), JSON.stringify(data));

function guardianOwner() {
  const children = readFileSync(`/proc/self/task/${process.pid}/children`, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number);
  return children.map(pid => ({ pid, args: readFileSync(`/proc/${pid}/cmdline`, 'utf8') })).find(child => child.args.includes('media-worker') && child.args.split('\0').includes(options.projectDirectory))!;
}

test(`真实服务异常清理 ${mode}`, async t => {
  if (mode === 'initialization') {
    const first = await startService(options); await first.close();
    const db = new DatabaseSync(join(options.projectDirectory, 'clapgrid.sqlite'));
    db.exec("INSERT INTO export_settings VALUES (1, 'broken-json')"); db.close();
    // 系统数据库 close 故障：在业务句柄尚未返回时拒绝释放。
    const leaked = new Set<DatabaseSync>();
    const close = DatabaseSync.prototype.close;
    vi.spyOn(DatabaseSync.prototype, 'close').mockImplementation(function (this: DatabaseSync) {
      leaked.add(this); throw new Error('受控 SQLite 关闭失败');
    });
    t.onTestFinished(() => {
      vi.restoreAllMocks();
      for (const db of leaked) close.call(db);
    });
    const error = await startService(options).catch(error => error);
    expect(String(error)).toMatch(/JSON.*SQLite 关闭失败/);
    expect(error.resourcesReleased).toBe(false);
    vi.restoreAllMocks();
    await expect(startService(options)).rejects.toThrow('另一服务');
    observe({ retained: existsSync(options.projectDirectory), originalAndCleanup: String(error), protected: true });
    throw error;
  }

  const independent = await startService({ ...options, projectDirectory: join(root, 'independent') });
  t.onTestFinished(() => independent.close());
  let cancelled = false;
  let startedSpeech!: () => void;
  const speechStarted = new Promise<void>(resolve => { startedSpeech = resolve; });
  const service = await startService({ ...options, ...(mode === 'http-stall' ? { speechRuntime: {
    key: () => 'controlled', configPath: 'controlled', fetch: async (_url: unknown, input?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      input!.signal!.addEventListener('abort', () => { cancelled = true; reject(new Error('受控配音取消')); }, { once: true }); startedSpeech();
    }),
  } } : {}) });
  await modifyBatch(service.url, { changes: [{ kind: 'add', text: '收尾前数据' }] });
  if (mode === 'http-stall') {
    const segment = (await queryStatus(service.url)).snapshot.segments[0]!;
    await submitSpeech(service.url, { requestId: randomUUID(), segmentId: segment.id });
    await speechStarted;
  }
  const child = guardianOwner();
  const owner = processIdentity(child.pid);
  expect(owner).toBeTruthy();
  t.onTestFinished(async () => {
    vi.restoreAllMocks();
    if (ownerAlive(owner) === true) process.kill(owner.pid, 'SIGCONT');
    await expect.poll(() => ownerAlive(owner)).toBe(false);
    // 关闭失败后媒体仍已退出，独立项目仍然可用；主项目保护保持。
    expect((await queryStatus(independent.url)).snapshot.project.directory).toBe(join(root, 'independent'));
    const files = readdirSync(options.projectDirectory);
    observe({ retained: existsSync(options.projectDirectory), files, guardianExited: true, independentAlive: true, elapsed: performance.now() - started, shutdownElapsed, cancelled });
  });
  if (mode === 'http-stall') {
    const close = Server.prototype.close;
    vi.spyOn(Server.prototype, 'close').mockImplementation(function (this: Server, _callback?: (error?: Error) => void) { return close.call(this); });
  } else if (mode === 'deadline') {
    process.kill(owner.pid, 'SIGSTOP');
    const close = Server.prototype.close;
    vi.spyOn(Server.prototype, 'close').mockImplementation(function (this: Server, callback?: (error?: Error) => void) {
      return close.call(this, error => { setTimeout(() => callback?.(error), 1800); });
    });
  } else {
    // HTTP 关闭已完成但系统回调报错；安全的后续业务、媒体清理仍应执行。
    const close = Server.prototype.close;
    vi.spyOn(Server.prototype, 'close').mockImplementation(function (this: Server, callback?: (error?: Error) => void) {
      return close.call(this, () => callback?.(new Error('受控 HTTP 关闭失败')));
    });
  }
  const started = performance.now();
  const error = await service.close().catch(error => error);
  const shutdownElapsed = performance.now() - started;
  expect(error.resourcesReleased).toBe(false);
  await expect(fetch(`${service.url}/api/status`)).rejects.toThrow();
  await expect(startService(options)).rejects.toThrow('另一服务');
  if (mode === 'http-stall') expect(cancelled).toBe(true);
  // 两阶段共享预算；断开 IPC 或关闭端口均不够，超时必须仍然保护目录。
  if (mode === 'deadline') {
    expect(ownerAlive(owner)).toBe(true);
    expect(shutdownElapsed).toBeGreaterThanOrEqual(9900);
    expect(shutdownElapsed).toBeLessThan(11000);
  }
  throw error;
});
