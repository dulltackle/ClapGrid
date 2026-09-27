import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
