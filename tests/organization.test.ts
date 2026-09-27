import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openBusiness } from '../src/business/index.js';

test('多行粘贴忽略空白行，原子重排保留稳定身份并拒绝过时顺序', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-organization-'));
  const business = openBusiness(root);
  t.after(() => { business.close(); rmSync(root, { recursive: true, force: true }); });
  const token = business.acquire('codex');
  await business.modifyBatch(token, { changes: [{ kind: 'paste', text: '\n甲\r\n \t\n乙\r丙\n' }] });
  const original = business.getSnapshot().segments;
  assert.deepEqual(original.map(s => s.text), ['甲', '乙', '丙']);
  const ids = original.map(s => s.id);
  const result = await business.modifyBatch(token, { changes: [{ kind: 'reorder', expectedIds: ids, ids: [ids[2]!, ids[0]!, ids[1]!] }] });
  assert.equal(result.summary.applied, 1);
  assert.deepEqual(business.getSnapshot().segments.map(s => [s.id, s.order]), [[ids[2], 1], [ids[0], 2], [ids[1], 3]]);
  const stale = await business.modifyBatch(token, { changes: [{ kind: 'reorder', expectedIds: ids, ids }] });
  assert.equal(stale.summary.changed, 1);
  const invalid = await business.modifyBatch(token, { changes: [{ kind: 'reorder', expectedIds: [ids[2]!, ids[0]!, ids[1]!], ids: [ids[0]!, ids[0]!, ids[1]!] }] });
  assert.equal(invalid.summary.failed, 1);
  assert.deepEqual(business.getSnapshot().segments.map(s => s.text), ['丙', '甲', '乙']);
});

test('选中操作固定稳定身份，改选和断开不扩大范围，明确查询仍可用', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-selection-'));
  const business = openBusiness(root);
  t.after(() => { business.close(); rmSync(root, { recursive: true, force: true }); });
  business.addSegment('甲'); business.addSegment('乙');
  const [a, b] = business.getSnapshot().segments;
  const tableId = business.connectTable();
  business.selectSegments(tableId, [a!.id]);
  const selected = business.querySegments({ kind: 'selected' });
  assert.deepEqual(selected.segments.map(s => s.id), [a!.id]);
  const token = business.acquire('codex');
  const pending = business.processScope(token, { scope: { kind: 'selected' }, expected: selected.segments, action: { kind: 'edit', text: '固定目标' } });
  business.selectSegments(tableId, [b!.id]);
  business.disconnectTable(tableId);
  const result = await pending;
  assert.equal(result.summary.applied, 1);
  assert.deepEqual(business.getSnapshot().segments.map(s => s.text), ['固定目标', '乙']);
  assert.equal(business.querySegments({ kind: 'selected' }).availability, 'unavailable');
  await assert.rejects(business.processScope(token, { scope: { kind: 'selected' }, expected: [b!], action: { kind: 'delete' } }), /无可用选择/);
  assert.deepEqual(business.querySegments({ kind: 'ids', ids: [b!.id] }).segments, [b]);
  assert.deepEqual(business.querySegments({ kind: 'query', textContains: '乙' }).segments, [b]);
  const reconnected = business.connectTable();
  assert.equal(business.querySegments({ kind: 'selected' }).availability, 'unavailable');
  business.selectSegments(reconnected, [b!.id]);
  const other = business.connectTable();
  assert.equal(business.querySegments({ kind: 'selected' }).availability, 'ambiguous');
  assert.deepEqual(business.querySegments({ kind: 'selected', tableId: reconnected }).segments, [b]);
  assert.throws(() => business.selectSegments(tableId, [a!.id]), /表格连接已断开/);
  business.disconnectTable(other);
  await assert.rejects(business.processScope(token, { scope: { kind: 'selected' }, expected: [a!], action: { kind: 'delete' } }), /重新查询/);
});

test('删除后项目序号连续，批量删除不会因自身引起的序号变化跳过目标', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-delete-order-'));
  const business = openBusiness(root);
  t.after(() => { business.close(); rmSync(root, { recursive: true, force: true }); });
  for (const text of ['甲', '乙', '丙']) business.addSegment(text);
  const [a, b, c] = business.getSnapshot().segments;
  const token = business.acquire('codex');
  const result = await business.modifyBatch(token, { changes: [{ kind: 'delete', expected: a! }, { kind: 'delete', expected: b! }] });
  assert.equal(result.summary.applied, 2);
  assert.deepEqual(business.getSnapshot().segments, [{ ...c!, order: 1 }]);
});

test('条件查询后的内容变化和明确身份删除逐项反馈，不静默丢失旧目标', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-stale-scope-'));
  const business = openBusiness(root);
  t.after(() => { business.close(); rmSync(root, { recursive: true, force: true }); });
  business.addSegment('原条件甲'); business.addSegment('原条件乙');
  const expected = business.querySegments({ kind: 'query', textContains: '原条件' }).segments;
  const token = business.acquire('codex');
  await business.modifyBatch(token, { changes: [{ kind: 'edit', expected: expected[0]!, text: '新内容' }, { kind: 'delete', expected: expected[1]! }] });
  const result = await business.processScope(token, { scope: { kind: 'query', textContains: '原条件' }, expected, action: { kind: 'delete' } });
  assert.deepEqual(result.results.map(r => r.outcome), ['changed', 'deleted']);
  const explicit = await business.processScope(token, { scope: { kind: 'ids', ids: [expected[1]!.id] }, expected: [expected[1]!], action: { kind: 'delete' } });
  assert.equal(explicit.results[0]!.outcome, 'deleted');
  assert.equal(business.getSnapshot().segments[0]!.text, '新内容');
});

test('超过五百个片段仍可全选查询和按固定范围处理', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-large-selection-'));
  const business = openBusiness(root);
  t.after(() => { business.close(); rmSync(root, { recursive: true, force: true }); });
  const token = business.acquire('codex');
  await business.modifyBatch(token, { changes: [{ kind: 'paste', text: Array.from({ length: 501 }, (_, i) => `片段${i}`).join('\n') }] });
  const segments = business.getSnapshot().segments;
  const tableId = business.connectTable();
  business.selectSegments(tableId, segments.map(segment => segment.id));
  const selected = business.querySegments({ kind: 'selected' });
  assert.equal(selected.segments.length, 501);
  const result = await business.processScope(token, { scope: { kind: 'selected' }, expected: selected.segments, action: { kind: 'delete' } });
  assert.equal(result.summary.applied, 501);
  assert.equal(business.getSnapshot().segments.length, 0);
});
