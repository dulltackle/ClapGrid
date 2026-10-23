import { test, type ResourceFixtures } from './helpers/resource-test.js';
import { expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beginEdit, modifyBatch, modifyUserBatch, queryStatus, saveExportSettings, saveSegment } from '../src/shared/client.js';

type Resources = Pick<ResourceFixtures, 'createDirectory' | 'openConnection' | 'startService'>;

async function project(t: Pick<Resources, 'createDirectory' | 'startService'>) {
  const directory = await t.createDirectory(join(tmpdir(), 'clapgrid-editing-http-'));
  const panelDirectory = join(directory, 'panel'); await mkdir(panelDirectory);
  await writeFile(join(panelDirectory, 'index.html'), '<!doctype html><div id="root"></div>');
  const service = await t.startService({ projectDirectory: join(directory, 'project'), panelDirectory, port: 0 });
  return service;
}

test('真实HTTP修改权阻止另一客户端写入，保存后继续持有直到面板释放且SQLite保留文案', async ({ createDirectory, openConnection, startService }) => {
  const t = { createDirectory, startService };
  const service = await project(t);
  await modifyBatch(service.url, { changes: [{ kind: 'add', text: '原文' }] });
  const first = await openConnection(() => beginEdit(service.url));
  await expect(beginEdit(service.url)).rejects.toThrow();
  await expect(modifyBatch(service.url, { changes: [{ kind: 'add', text: '禁止新增' }] })).rejects.toThrow();
  const id = first.status.snapshot.segments[0]!.id;
  await saveSegment(service.url, { id, text: '已保存' }, first.token);
  expect((await queryStatus(service.url)).modification).toEqual({ owner: 'user' });
  await expect(beginEdit(service.url)).rejects.toThrow();
  await first.close();
  await first.closed;
  expect((await queryStatus(service.url)).snapshot.segments.map(segment => segment.text)).toEqual(['已保存']);
  await expect(saveSegment(service.url, { id, text: '过期租约覆盖' }, first.token)).rejects.toThrow();
  const second = await beginEdit(service.url); await second.close();
  expect((await queryStatus(service.url)).snapshot.segments[0]!.text).toBe('已保存');
});

test('真实HTTP相对新增拒绝旧锚点及顺序，粘贴空行过滤和顺序持久化', async ({ createDirectory, openConnection, startService }) => {
  const t = { createDirectory, startService };
  const service = await project(t);
  await modifyBatch(service.url, { changes: [{ kind: 'paste', text: 'A\n\nB\n  \nC' }] });
  const before = (await queryStatus(service.url)).snapshot.segments;
  expect(before.map(segment => segment.text)).toEqual(['A', 'B', 'C']);
  await modifyBatch(service.url, { changes: [{ kind: 'edit', expected: before[0]!, text: '外部A' }] });
  const edit = await openConnection(() => beginEdit(service.url));
  const result = await modifyUserBatch(service.url, { changes: [{ kind: 'add', text: '', relative: { anchor: before[0]!, placement: 'after', expectedIds: before.map(segment => segment.id) } }] }, edit.token);
  expect(result.summary.applied).toBe(0);
  expect((await queryStatus(service.url)).snapshot.segments.map(segment => segment.text)).toEqual(['外部A', 'B', 'C']);
});


test('口播片段与导出设置在同一次用户修改会话中连续保存，主动释放后才允许Codex修改', async ({ createDirectory, openConnection, startService }) => {
  const service = await project({ createDirectory, startService });
  await modifyBatch(service.url, { changes: [{ kind: 'add', text: '原文' }] });
  const edit = await openConnection(() => beginEdit(service.url));
  const id = edit.status.snapshot.segments[0]!.id;
  await saveSegment(service.url, { id, text: '第一次保存' }, edit.token);
  const settings = edit.status.snapshot.exportSettings;
  const saved = await saveExportSettings(service.url, { expected: settings, settings: { ...settings, fps: 25 } }, edit.token);
  expect(saved.status.modification).toEqual({ owner: 'user' });
  await saveSegment(service.url, { id, text: '第二次保存' }, edit.token);
  await saveExportSettings(service.url, { expected: saved.settings, settings: { ...saved.settings, fps: 60 } }, edit.token);
  await expect(modifyBatch(service.url, { changes: [{ kind: 'add', text: '不得抢占' }] })).rejects.toThrow();
  await edit.close();
  await modifyBatch(service.url, { changes: [{ kind: 'add', text: 'Codex接续' }] });
  const after = await queryStatus(service.url);
  expect(after.modification).toBeNull();
  expect(after.snapshot.segments.map(segment => segment.text)).toEqual(['第二次保存', 'Codex接续']);
  expect(after.snapshot.exportSettings.fps).toBe(60);
});
