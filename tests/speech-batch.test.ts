import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openBusiness } from '../src/business/index.js';

const success = () => new Response('data: {"code":0,"data":"SUQz"}\n\ndata: {"code":20000000}\n\n');
const settle = async (business: ReturnType<typeof openBusiness>) => {
  for (let i = 0; i < 200 && business.getSpeechStatus().locked; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(business.getSpeechStatus().locked, false);
};

test('批量固定勾选、局部失败继续、整批终态解锁且重发不重复付费', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-batch-'));
  const responses: ((value: Response) => void)[] = [];
  let calls = 0;
  const business = openBusiness(directory, { key: () => 'key', configPath: '/tmp/.env', fetch: (async () => {
    calls++; return new Promise<Response>(resolve => responses.push(resolve));
  }) as typeof fetch });
  try {
    business.addSegment('失败'); business.addSegment('成功'); business.addSegment('不在范围');
    const [a, b, c] = business.getSnapshot().segments;
    const tableId = business.connectTable(); business.selectSegments(tableId, [a!.id, b!.id]);
    const input = { requestId: randomUUID(), mode: 'generate' as const, scope: { kind: 'selected' as const, tableId } };
    const batch = business.submitSpeechBatch(input);
    assert.deepEqual(batch.results.map(item => item.outcome), ['accepted', 'accepted']);
    business.selectSegments(tableId, [c!.id]); business.disconnectTable(tableId);
    assert.equal(business.submitSpeechBatch(input).id, batch.id);
    assert.throws(() => business.addSegment('锁定'), /配音/);
    await new Promise(resolve => setImmediate(resolve));
    responses.shift()!(new Response('', { status: 401 }));
    for (let i = 0; i < 100 && calls < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(business.getSpeechStatus().locked, true);
    const progress = business.getSpeechStatus().operations.find(item => item.id === batch.id)!;
    assert.equal(progress.summary.failed, 1);
    assert.equal(progress.summary.completed, 1);
    responses.shift()!(success()); await settle(business);
    const result = business.submitSpeechBatch(input);
    assert.deepEqual(result.results.map(item => item.state), ['failed', 'succeeded']);
    assert.deepEqual(result.results.map(item => item.outcome), ['existing', 'existing']);
    assert.equal(result.summary.completed, 2); assert.equal(result.summary.succeeded, 1);
    assert.equal(calls, 2);
  } finally { business.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('失败范围限定操作，显式重试读取最新输入并跳过已成功与已删除目标', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-retry-'));
  let fail = true;
  const texts: string[] = [];
  const business = openBusiness(directory, { key: () => 'key', configPath: '/tmp/.env', fetch: (async (_url, options) => {
    texts.push(JSON.parse(String(options?.body)).req_params.text);
    return fail ? new Response('', { status: 401 }) : success();
  }) as typeof fetch });
  try {
    business.addSegment('第一批'); business.addSegment('第二批');
    const [a, b] = business.getSnapshot().segments;
    const first = business.submitSpeechBatch({ requestId: randomUUID(), mode: 'generate', scope: { kind: 'ids', ids: [a!.id] } }); await settle(business);
    business.submitSpeechBatch({ requestId: randomUUID(), mode: 'generate', scope: { kind: 'ids', ids: [b!.id] } }); await settle(business);
    business.editSegment(a!.id, '最新文案'); business.setVoice({ speaker: 'zh_male_ruyayichen_saturn_bigtts', speechRate: 20 }); fail = false;
    const retry = business.submitSpeechBatch({ requestId: randomUUID(), mode: 'retry', scope: { kind: 'failed_operation', operationId: first.id } });
    assert.deepEqual(retry.results.map(item => item.segmentId), [a!.id]); await settle(business);
    const latest = business.getSpeechStatus().tasks.at(-1)!;
    assert.equal(latest.input.text, '最新文案'); assert.equal(latest.input.voice.speechRate, 20);
    const skip = business.submitSpeechBatch({ requestId: randomUUID(), mode: 'retry', scope: { kind: 'failed_operation', operationId: first.id } });
    assert.equal(skip.results[0]!.outcome, 'skipped'); assert.match(skip.results[0]!.message, /已成功/);
    const project = business.submitSpeechBatch({ requestId: randomUUID(), mode: 'retry', scope: { kind: 'failed_project' } });
    assert.deepEqual(project.results.map(item => item.segmentId), [b!.id]); await settle(business);
    const token = business.acquire('codex');
    await business.modifyBatch(token, { changes: [{ kind: 'delete', expected: business.getSnapshot().segments[0]! }] }); business.release(token);
    const deleted = business.submitSpeechBatch({ requestId: randomUUID(), mode: 'retry', scope: { kind: 'failed_operation', operationId: first.id } });
    assert.match(deleted.results[0]!.message, /已删除/);
    assert.deepEqual(texts, ['第一批', '第二批', '最新文案', '第二批']);
  } finally { business.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('缺失或待更新范围、空选择及逐项拒绝不会静默扩大或追加任务', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-scope-'));
  const business = openBusiness(directory, { key: () => 'key', configPath: '/tmp/.env', fetch: (async () => success()) as typeof fetch });
  try {
    business.addSegment('已成功'); business.addSegment('待更新');
    business.submitSpeechBatch({ requestId: randomUUID(), mode: 'generate', scope: { kind: 'all' } }); await settle(business);
    const [a, b] = business.getSnapshot().segments; business.editSegment(b!.id, '新文案'); business.addSegment('');
    assert.throws(() => business.submitSpeechBatch({ requestId: randomUUID(), mode: 'generate', scope: { kind: 'selected' } }), /无可用选择/);
    const table = business.connectTable();
    assert.throws(() => business.submitSpeechBatch({ requestId: randomUUID(), mode: 'generate', scope: { kind: 'selected', tableId: table } }), /无可用选择/);
    const empty = business.submitSpeechBatch({ requestId: randomUUID(), mode: 'generate', scope: { kind: 'ids', ids: [] } }); assert.equal(empty.results.length, 0);
    const batch = business.submitSpeechBatch({ requestId: randomUUID(), mode: 'generate', scope: { kind: 'missing_or_stale' } });
    assert.deepEqual(batch.results.map(item => item.outcome), ['accepted', 'rejected']);
    assert.equal(batch.results[0]!.segmentId, b!.id);
    const concurrent = business.submitSpeechBatch({ requestId: randomUUID(), mode: 'generate', scope: { kind: 'ids', ids: [a!.id, b!.id, randomUUID(), business.getSnapshot().segments[2]!.id] } });
    assert.deepEqual(concurrent.results.map(item => item.outcome), ['skipped', 'existing', 'skipped', 'rejected']);
    await settle(business);
    assert.equal(business.getSpeechStatus().tasks.length, 3);
    assert.throws(() => business.submitSpeechBatch({ ...batch.request, mode: 'retry' }), /请求标识/);
    const lease = business.acquire('user');
    const rejected = business.submitSpeechBatch({ requestId: randomUUID(), mode: 'generate', scope: { kind: 'ids', ids: [business.getSnapshot().segments[2]!.id] } });
    assert.match(rejected.results[0]!.message, /正在修改/); business.release(lease);
  } finally { business.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('重开批量操作保留成功结果，未完成显示已中断，不续跑且重发不产生请求', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'clapgrid-interrupt-'));
  let calls = 0;
  const runtime = { key: () => 'key', configPath: '/tmp/.env', fetch: (async () => { calls++; return calls === 1 ? success() : new Promise<Response>(() => {}); }) as typeof fetch };
  let business = openBusiness(directory, runtime);
  try {
    business.addSegment('完成'); business.addSegment('中断'); business.addSegment('未启动');
    const input = { requestId: randomUUID(), mode: 'generate' as const, scope: { kind: 'all' as const } };
    const batch = business.submitSpeechBatch(input);
    for (let i = 0; i < 100 && calls < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
    business.close(); business = openBusiness(directory, runtime);
    const replay = business.submitSpeechBatch(input);
    assert.equal(replay.id, batch.id); assert.equal(replay.summary.succeeded, 1); assert.equal(replay.summary.interrupted, 2);
    assert.match(replay.results[1]!.message, /已中断/);
    assert.equal(calls, 2); assert.equal(business.getSpeechStatus().locked, false);
  } finally { business.close(); rmSync(directory, { recursive: true, force: true }); }
});
