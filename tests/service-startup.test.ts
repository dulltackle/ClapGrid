import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readdir, readlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startService } from '../src/service/server.js';

async function openFiles(directory: string) {
  const links = await Promise.all((await readdir('/proc/self/fd')).map(fd => readlink(`/proc/self/fd/${fd}`).catch(() => '')));
  return links.filter(path => path.startsWith(`${directory}/`));
}

test('业务句柄返回前初始化失败，释放数据库和保护并报告原始错误，可从同目录恢复', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clapgrid-startup-'));
  const options = { projectDirectory: join(root, 'project'), panelDirectory: join(root, 'panel'), port: 0 };
  await mkdir(options.panelDirectory);
  await writeFile(join(options.panelDirectory, 'index.html'), 'ClapGrid');
  try {
    const first = await startService(options);
    await first.close();
    const db = new DatabaseSync(join(options.projectDirectory, 'clapgrid.sqlite'));
    db.exec("INSERT INTO export_settings VALUES (1, 'broken-json')"); db.close();
    const error = await startService(options).catch(error => error);
    expect(error).toMatchObject({ resourcesReleased: true });
    expect(String(error)).toMatch(/JSON/);
    expect(await openFiles(root)).toEqual([]);
    const repair = new DatabaseSync(join(options.projectDirectory, 'clapgrid.sqlite'));
    repair.exec('DELETE FROM export_settings'); repair.close();
    const recovered = await startService(options);
    try { expect((await fetch(`${recovered.url}/api/status`)).status).toBe(200); }
    finally { await recovered.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('取消的配音任务实际结束前保留数据库与项目保护，结束后同目录恢复数据', async () => {
  const { modifyBatch, queryStatus, submitSpeech } = await import('../src/shared/client.js');
  const { randomUUID } = await import('node:crypto');
  const root = await mkdtemp(join(tmpdir(), 'clapgrid-drain-'));
  await writeFile(join(root, 'index.html'), 'ClapGrid');
  let finish!: () => void;
  let cancelled!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const aborted = new Promise<void>(resolve => { cancelled = resolve; });
  const options = { projectDirectory: join(root, 'project'), panelDirectory: root, port: 0, speechRuntime: {
    key: () => 'controlled', configPath: 'controlled', fetch: async (_url: unknown, input?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      finish = () => reject(new Error('受控供应商退出'));
      input!.signal!.addEventListener('abort', () => cancelled(), { once: true }); entered();
    }),
  } };
  const service = await startService(options);
  try {
    await modifyBatch(service.url, { changes: [{ kind: 'add', text: '取消后保留文案' }] });
    const before = await queryStatus(service.url);
    await submitSpeech(service.url, { requestId: randomUUID(), segmentId: before.snapshot.segments[0]!.id });
    await started;
    const closing = service.close();
    await aborted;
    expect((await openFiles(options.projectDirectory)).some(path => path.endsWith('clapgrid.sqlite'))).toBe(true);
    await expect(startService(options)).rejects.toThrow('另一服务');
    finish(); await closing;
    expect(await openFiles(options.projectDirectory)).toEqual([]);
    const reopened = await startService(options);
    try { expect((await queryStatus(reopened.url)).snapshot).toEqual(before.snapshot); }
    finally { await reopened.close(); }
  } finally { finish?.(); await service.close(); await rm(root, { recursive: true, force: true }); }
});
