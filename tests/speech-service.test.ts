import { test } from './helpers/resource-test.js';
import { expect } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBusinessMcp } from '../src/mcp/server.js';
import { connectTable, beginEdit, submitSpeech } from '../src/shared/client.js';
import type { SpeechStatus, SpeechTask } from '../src/shared/contracts.js';

test('HTTP 单行提交与 MCP 共用任务，面板断开不解锁且支持查询与范围试听', async ({ createDirectory, openConnection, startService }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-speech-http-'));
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'test');
  let finish!: (response: Response) => void;
  let calls = 0; let key = '';
  const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0, speechRuntime: {
    configPath: '/tmp/local/.env', key: () => key, fetch: (async () => { calls++; return await new Promise<Response>(resolve => { finish = resolve; }); }) as typeof fetch,
  } });
  const mcp = openConnection(() => createBusinessMcp(service.url)); const client = openConnection(() => new Client({ name: '配音验证', version: '1' }));

  const [a, b] = InMemoryTransport.createLinkedPair(); await mcp.connect(b); await client.connect(a);
  await client.callTool({ name: 'clapgrid_modify', arguments: { changes: [{ kind: 'add', text: '真实业务流程' }] } });
  const status = await (await fetch(`${service.url}/api/status`)).json();
  const input = { requestId: randomUUID(), segmentId: status.snapshot.segments[0].id };
  await assert.rejects(submitSpeech(service.url, input), /^Error: 请在本机运行配置 \/tmp\/local\/\.env 中配置 TOKENDANCE_KEY$/);
  assert.equal(calls, 0); key = 'secret';
  const table = await connectTable(service.url);
  const response = await fetch(`${service.url}/api/speech/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(response.status, 200);
  const task = await response.json() as SpeechTask; assert.equal(task.state, 'accepted');
  await table.close();
  const repeated = await client.callTool({ name: 'clapgrid_submit_speech', arguments: input });
  assert.equal((repeated.structuredContent as SpeechTask).id, task.id);
  await assert.rejects(beginEdit(service.url), /配音/);
  for (const [name, args] of [
    ['clapgrid_modify', { changes: [{ kind: 'add', text: '锁定' }] }],
    ['clapgrid_modify', { changes: [{ kind: 'edit', expected: status.snapshot.segments[0], visualNote: '任务期间不可修改' }] }],
    ['clapgrid_import_video', { sourcePath: '/tmp/no-video.mp4' }],
    ['clapgrid_set_voice', { speaker: 'zh_female_vv_uranus_bigtts', speechRate: 20 }],
    ['clapgrid_submit_speech', { ...input, requestId: randomUUID() }],
  ] as const) assert.equal((await client.callTool({ name, arguments: args })).isError, true);
  assert.equal((await client.callTool({ name: 'clapgrid_speech_status', arguments: {} })).isError, undefined);
  finish(new Response('data: {"code":0,"data":"SUQzYWJj"}\n\ndata: {"code":20000000}\n\n'));
  let speech!: SpeechStatus;
  await expect.poll(async () => { speech = await (await fetch(`${service.url}/api/speech`)).json(); return speech.locked; }).toBe(false);
  assert.equal(speech.tasks[0]?.state, 'succeeded'); assert.equal(calls, 1);
  const audio = await fetch(`${service.url}${speech.audio[0]!.url}`, { headers: { Range: 'bytes=0-2' } });
  assert.equal(audio.status, 206); assert.equal(await audio.text(), 'ID3');
  assert.equal(JSON.stringify(speech).includes('secret'), false);
  const expected = (await (await fetch(`${service.url}/api/status`)).json()).snapshot.segments[0];
  const noted = await client.callTool({ name: 'clapgrid_modify', arguments: { changes: [{ kind: 'edit', expected, visualNote: '产品特写' }] } });
  assert.notEqual(noted.isError, true);
  const afterNote = await (await fetch(`${service.url}/api/speech`)).json();
  assert.equal(afterNote.audio[0].valid, true);
  assert.equal(afterNote.tasks.length, speech.tasks.length);
  assert.equal(calls, 1);
});

test('MCP 批量提交返回逐项受理，HTTP 查询与重发共享持久化结果', async ({ createDirectory, openConnection, startService }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-batch-http-'));
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'test');
  let calls = 0;
  const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0, speechRuntime: {
    configPath: '/tmp/.env', key: () => 'key', fetch: (async () => { calls++; return new Response('data: {"code":0,"data":"SUQz"}\n\ndata: {"code":20000000}\n\n'); }) as typeof fetch,
  } });
  const mcp = openConnection(() => createBusinessMcp(service.url)); const client = openConnection(() => new Client({ name: '批量配音验证', version: '1' }));

  const [a, b] = InMemoryTransport.createLinkedPair(); await mcp.connect(b); await client.connect(a);
  await client.callTool({ name: 'clapgrid_modify', arguments: { changes: [{ kind: 'add', text: '第一行' }, { kind: 'add', text: '第二行' }] } });
  const input = { requestId: randomUUID(), mode: 'generate', scope: { kind: 'all' } };
  const submitted = await client.callTool({ name: 'clapgrid_submit_speech_batch', arguments: input });
  assert.equal(submitted.isError, undefined);
  const batch = submitted.structuredContent as import('../src/shared/contracts.js').SpeechBatchResult;
  assert.equal(batch.summary.accepted, 2);
  let speech!: SpeechStatus;
  await expect.poll(async () => { speech = await (await fetch(`${service.url}/api/speech`)).json(); return speech.locked; }).toBe(false);
  assert.equal(speech.operations[0]!.summary.succeeded, 2);
  const repeated = await fetch(`${service.url}/api/speech/batch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(repeated.status, 200);
  const replay = await repeated.json(); assert.equal(replay.id, batch.id); assert.equal(replay.summary.existing, 2);
  assert.equal(calls, 2);
});
