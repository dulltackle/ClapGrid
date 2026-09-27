import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBusiness } from '../src/business/index.js';

test('共享业务层初始化 SQLite，重开后保留项目标识与创建时间', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-business-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = openBusiness(directory);
  const initial = first.getSnapshot();
  first.close();
  const reopened = openBusiness(directory);
  t.after(() => reopened.close());
  assert.match(initial.project.id, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isFinite(Date.parse(initial.project.createdAt)));
  assert.deepEqual(reopened.getSnapshot(), initial);
  assert.deepEqual(initial.segments, []);
  assert.equal(initial.storage.database, join(directory, 'clapgrid.sqlite'));
  assert.equal(initial.storage.mediaDirectory, join(directory, 'media'));
});

test('新增与编辑口播片段后重开，稳定身份、文案和项目顺序保留', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-edit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = openBusiness(directory);
  const added = first.addSegment('第一句');
  const id = added.segments[0]!.id;
  first.addSegment('第二句');
  const saved = first.editSegment(id, '修改后的第一句\n保留换行');
  assert.deepEqual(saved.segments.map(s => [s.order, s.text]), [[1, '修改后的第一句\n保留换行'], [2, '第二句']]);
  assert.equal(saved.segments[0]!.id, id);
  first.close();
  const reopened = openBusiness(directory);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getSnapshot(), saved);
});

for (const entry of ['clapgrid.sqlite', 'clapgrid.sqlite-wal', 'clapgrid.sqlite-shm', 'clapgrid.sqlite-journal', 'media']) {
  test(`拒绝项目内 ${entry} 符号链接，不触碰项目外文件`, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'clapgrid-boundary-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const directory = join(root, 'project');
    mkdirSync(directory);
    const outside = join(root, 'outside');
    if (entry === 'media') mkdirSync(outside);
    else writeFileSync(outside, '项目外原始内容');
    symlinkSync(outside, join(directory, entry));
    assert.throws(() => openBusiness(directory), /项目.*路径/);
    if (entry !== 'media') assert.equal(readFileSync(outside, 'utf8'), '项目外原始内容');
  });
}
