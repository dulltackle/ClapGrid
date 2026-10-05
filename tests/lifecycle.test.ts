import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startService } from '../src/service/server.js';
import { beginEdit, queryStatus, submitSpeech, modifyBatch, querySpeech, submitSpeechBatch } from '../src/shared/client.js';

test('普通编辑不是后台任务，默认退出仍能释放修改权并停止', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-edit-stop-'));
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'test');
  const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0 });
  t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }); });
  const edit = await beginEdit(service.url);
  const status = await queryStatus(service.url);
  assert.deepEqual(status.modification, { owner: 'user' });
  assert.equal(status.taskLocked, false);
  const response = await fetch(`${service.url}/api/service/stop`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId: status.instanceId }),
  });
  assert.equal((await response.json()).outcome, 'stopping');
  await service.close(); await edit.closed;
});

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
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const thread = randomUUID(); const host = join(root, 'host.cjs');
  writeFileSync(host, `#!/usr/bin/env node\nrequire('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/read')console.log(JSON.stringify({id:r.id,result:{thread:{id:r.params.threadId,cwd:${JSON.stringify(workspace)}}}}));});`, { mode: 0o700 });
  const previousHost = process.env.CLAPGRID_CODEX_BIN; process.env.CLAPGRID_CODEX_BIN = host;
  const entry = join(root, 'runtime.mjs');
  await build({ entryPoints: ['src/runtime.ts'], outfile: entry, bundle: true, platform: 'node', format: 'esm', external: ['vite'], banner: { js: "import { createRequire } from 'node:module'; const require=createRequire(import.meta.url);" } });
  const open = async () => JSON.parse((await promisify(execFile)(process.execPath, [entry, 'open', '--workspace', workspace, '--thread', thread], { env: process.env })).stdout);
  let calls = 0;
  const options = { projectDirectory: join(workspace, 'clapgrid'), workspaceDirectory: workspace, panelDirectory, port: 0, speechRuntime: {
    key: () => 'test', configPath: 'test', fetch: (async (_url: unknown, init: RequestInit) => {
      calls++;
      if (calls === 1) return new Response('data: {"code":0,"data":"SUQzYWJj"}\n\ndata: {"code":20000000}\n\n');
      return await new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('连接中断')), { once: true }));
    }) as typeof fetch,
  } };
  const service = await startService(options);
  t.after(async () => { await service.close(); if (previousHost === undefined) delete process.env.CLAPGRID_CODEX_BIN; else process.env.CLAPGRID_CODEX_BIN = previousHost; rmSync(root, { recursive: true, force: true }); });
  const opened = await open(); const url = opened.url;
  await modifyBatch(url, { changes: ['已完成', '结果未知', '未发送'].map(text => ({ kind: 'add' as const, text })) });
  const status = await queryStatus(url);
  const request = { requestId: randomUUID(), mode: 'generate' as const, scope: { kind: 'ids' as const, ids: status.snapshot.segments.map(segment => segment.id) } };
  const batch = await submitSpeechBatch(url, request);
  for (let attempt = 0; attempt < 100 && calls < 2; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(calls, 2);
  const before = await querySpeech(url);
  const bytes = Buffer.from(await (await fetch(new URL(before.audio[0]!.url, url))).arrayBuffer());
  await fetch(`${url}/api/service/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId: status.instanceId, interrupt: true }) });
  await service.close();
  const reopened = await startService(options);
  try {
    const reopenedEntry = await open(); const reopenedUrl = reopenedEntry.url;
    assert.equal(reopenedEntry.snapshot.project.id, opened.snapshot.project.id);
    assert.notEqual(reopenedEntry.instanceId, opened.instanceId);
    assert.equal((await querySpeech(reopenedUrl)).tasks.length, 3, '重开不会追加配音任务');
    const result = await submitSpeechBatch(reopenedUrl, request);
    assert.equal(result.id, batch.id);
    assert.deepEqual([result.summary.succeeded, result.summary.interrupted, result.summary.pending], [1, 2, 0]);
    assert.match(result.results[1]!.message, /可能已计费/);
    assert.match(result.results[2]!.message, /尚未发送/);
    const speech = await querySpeech(reopenedUrl);
    assert.deepEqual(Buffer.from(await (await fetch(new URL(speech.audio[0]!.url, reopenedUrl))).arrayBuffer()), bytes);
    assert.equal((await queryStatus(reopenedUrl)).taskLocked, false);
    assert.equal(calls, 2);
  } finally { await reopened.close(); }
});
