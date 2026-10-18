import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openBusiness } from '../src/business/index.js';
import { batchSchema, editSegmentSchema } from '../src/shared/contracts.js';

test('旧项目补齐空画面说明，独立修改、清空、重开及新增均保留正确内容', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-visual-note-'));
  t.onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const id = randomUUID();
  const legacy = new DatabaseSync(join(directory, 'clapgrid.sqlite'));
  try {
    legacy.exec('CREATE TABLE segments (id TEXT PRIMARY KEY, position INTEGER NOT NULL UNIQUE, text TEXT NOT NULL)');
    legacy.prepare('INSERT INTO segments VALUES (?, 1, ?)').run(id, '旧文案');
  } finally { legacy.close(); }
  const business = openBusiness(directory);
  let initialClosed = false;
  t.onTestFinished(async () => { if (!initialClosed) await business.close(); });
  assert.equal(business.getSnapshot().segments[0]!.visualNote, '');
  business.updateSegment(id, { visualNote: '产品特写\n切换全景' });
  business.editSegment(id, '新文案');
  assert.equal(business.getSnapshot().segments[0]!.visualNote, '产品特写\n切换全景');
  await business.close(); initialClosed = true;
  const reopened = openBusiness(directory);
  t.onTestFinished(() => reopened.close());
  assert.deepEqual(reopened.getSnapshot().segments[0], { id, order: 1, text: '新文案', visualNote: '产品特写\n切换全景', video: null });
  reopened.updateSegment(id, { visualNote: '' });
  assert.equal(reopened.getSnapshot().segments[0]!.text, '新文案');
  reopened.addSegment('新增文案');
  const token = reopened.acquire('codex');
  await reopened.modifyBatch(token, { changes: [{ kind: 'paste', text: '粘贴一\n粘贴二' }] });
  reopened.release(token);
  assert.ok(reopened.getSnapshot().segments.every(segment => segment.visualNote === ''));
});

test('说明变化使旧完整快照失效，范围编辑只更改说明，查找仍只搜索文案', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-note-conflict-'));
  t.onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const business = openBusiness(directory);
  t.onTestFinished(() => business.close());
  const original = business.addSegment('原文').segments[0]!;
  business.updateSegment(original.id, { visualNote: '仅说明包含的关键词' });
  const token = business.acquire('codex');
  const stale = await business.modifyBatch(token, { changes: [
    { kind: 'edit', expected: original, text: '过时文案' },
    { kind: 'delete', expected: original },
    { kind: 'video', expected: original, assetId: null, start: 0 },
  ] });
  assert.deepEqual(stale.results.map(result => result.outcome), ['changed', 'changed', 'changed']);
  const current = business.getSnapshot().segments[0]!;
  const applied = await business.processScope(token, {
    scope: { kind: 'ids', ids: [current.id] }, expected: [current], action: { kind: 'edit', visualNote: '' },
  });
  assert.equal(applied.results[0]!.outcome, 'applied');
  business.release(token);
  assert.equal(business.getSnapshot().segments[0]!.text, '原文');
  business.updateSegment(current.id, { visualNote: '仅说明包含的关键词' });
  assert.equal(business.querySegments({ kind: 'query', textContains: '关键词' }).segments.length, 0);
  assert.equal(editSegmentSchema.safeParse({ id: current.id }).success, false);
  assert.equal(batchSchema.safeParse({ changes: [{ kind: 'edit', expected: current }] }).success, false);
});
