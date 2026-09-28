import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startService } from '../src/service/server.js';
import { queryStatus, submitSpeech, modifyBatch, querySpeech, submitSpeechBatch } from '../src/shared/client.js';

test('退出服务默认保持配音与锁，明确中断后重开保留同一任务且不自动重试', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-lifecycle-'));
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'test');
  let calls = 0;
  const options = { projectDirectory: join(root, 'project'), panelDirectory, port: 0, speechRuntime: {
    key: () => 'test', configPath: 'test', fetch: (async (_url: unknown, init: RequestInit) => {
      calls++;
      return await new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('已断开')), { once: true }));
    }) as typeof fetch,
  } };
  const service = await startService(options);
  t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }); });
  await modifyBatch(service.url, { changes: [{ kind: 'add', text: '服务退出保护' }] });
  const before = await queryStatus(service.url);
  const request = { requestId: randomUUID(), segmentId: before.snapshot.segments[0]!.id };
  const task = await submitSpeech(service.url, request);
  const stop = (interrupt: boolean, instanceId = before.instanceId) => fetch(`${service.url}/api/service/stop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId, interrupt }),
  });
  assert.equal((await stop(true, randomUUID())).status, 409);
  const kept = await stop(false);
  assert.equal(kept.status, 200);
  assert.equal((await kept.json()).outcome, 'kept');
  assert.equal((await queryStatus(service.url)).taskLocked, true);
  assert.equal((await submitSpeech(service.url, request)).id, task.id);
  assert.equal((await stop(true)).status, 200);
  await service.close();
  const reopened = await startService(options);
  try {
    const status = await queryStatus(reopened.url);
    assert.equal(status.snapshot.project.id, before.snapshot.project.id);
    assert.equal(status.taskLocked, false);
    const speech = await querySpeech(reopened.url);
    assert.equal(speech.tasks[0]!.id, task.id);
    assert.equal(speech.tasks[0]!.state, 'unknown');
    assert.match(speech.tasks[0]!.message, /不会自动重试/);
    assert.equal(calls, 1);
  } finally { await reopened.close(); }
});

test('批量部分完成后中断保留成功音频，运行项提示结果未知，未发送项说明中断且不重新提交', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-batch-stop-'));
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'test');
  let calls = 0;
  const options = { projectDirectory: join(root, 'project'), panelDirectory, port: 0, speechRuntime: {
    key: () => 'test', configPath: 'test', fetch: (async (_url: unknown, init: RequestInit) => {
      calls++;
      if (calls === 1) return new Response('data: {"code":0,"data":"SUQzYWJj"}\n\ndata: {"code":20000000}\n\n');
      return await new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('连接中断')), { once: true }));
    }) as typeof fetch,
  } };
  const service = await startService(options);
  t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }); });
  await modifyBatch(service.url, { changes: ['已完成', '结果未知', '未发送'].map(text => ({ kind: 'add' as const, text })) });
  const status = await queryStatus(service.url);
  const request = { requestId: randomUUID(), mode: 'generate' as const, scope: { kind: 'ids' as const, ids: status.snapshot.segments.map(segment => segment.id) } };
  const batch = await submitSpeechBatch(service.url, request);
  for (let attempt = 0; attempt < 100 && calls < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls, 2);
  const before = await querySpeech(service.url);
  const bytes = Buffer.from(await (await fetch(service.url + before.audio[0]!.url)).arrayBuffer());
  await fetch(`${service.url}/api/service/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId: status.instanceId, interrupt: true }) });
  await service.close();
  const reopened = await startService(options);
  try {
    const result = await submitSpeechBatch(reopened.url, request);
    assert.equal(result.id, batch.id);
    assert.deepEqual([result.summary.succeeded, result.summary.interrupted, result.summary.pending], [1, 2, 0]);
    assert.match(result.results[1]!.message, /可能已计费/);
    assert.match(result.results[2]!.message, /尚未发送/);
    const speech = await querySpeech(reopened.url);
    assert.deepEqual(Buffer.from(await (await fetch(reopened.url + speech.audio[0]!.url)).arrayBuffer()), bytes);
    assert.equal((await queryStatus(reopened.url)).taskLocked, false);
    assert.equal(calls, 2);
  } finally { await reopened.close(); }
});
