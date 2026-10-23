import { test } from './helpers/resource-test.js';
import { expect } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBusinessMcp } from '../src/mcp/server.js';
import { beginEdit, queryExportSettings, saveExportSettings, queryStatus, submitSpeech } from '../src/shared/client.js';
import type { ExportStatus } from '../src/shared/contracts.js';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { existsSync } from 'node:fs';
import { queryExports, submitExport, modifyBatch, importVideo, querySpeech } from '../src/shared/client.js';

test('绑定地址下成片与兼容预览链接带当前绑定前缀，可读取对应媒体且去前缀后拒绝访问', { timeout: 60000 }, async ({ createDirectory, execBytes, startService, onTestFinished }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-bound-export-'));
  const workspace = join(root, 'workspace'); mkdirSync(workspace);
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'test');
  const video = join(root, 'video.mp4'); const audio = join(root, 'speech.mp3');
  await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=96x96:r=10:d=0.4', '-c:v', 'libx264', video]);
  await execBytes('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4', '-ar', '24000', audio]);
  const payload = readFileSync(audio).toString('base64');
  const threadId = randomUUID(); const host = join(root, 'host.cjs');
  writeFileSync(host, `#!/usr/bin/env node\nrequire('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/read')console.log(JSON.stringify({id:r.id,result:{thread:${JSON.stringify({ id: threadId, cwd: workspace })}}}));});`, { mode: 0o700 });
  const previousHost = process.env.CLAPGRID_CODEX_BIN;
  onTestFinished(() => { if (previousHost === undefined) delete process.env.CLAPGRID_CODEX_BIN; else process.env.CLAPGRID_CODEX_BIN = previousHost; });
  process.env.CLAPGRID_CODEX_BIN = host;
  const service = await startService({ projectDirectory: join(workspace, 'clapgrid'), workspaceDirectory: workspace, panelDirectory, port: 0, speechRuntime: {
    configPath: '.env', key: () => 'test-key',
    fetch: async () => new Response(`data: {"code":0,"data":"${payload}"}\n\ndata: {"code":20000000}\n\n`),
  } });
  const origin = service.url;
  const identityResponse = await fetch(`${origin}/api/identity`);
  assert.equal(identityResponse.status, 200);
  const identity = await identityResponse.json();
  const bindingResponse = await fetch(`${origin}/api/binding`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, workspace: identity.workspace, projectId: identity.projectId, instanceId: identity.instanceId }) });
  assert.equal(bindingResponse.status, 200);
  const { binding } = await bindingResponse.json();
  assert.equal(typeof binding, 'string'); assert.ok(binding);
  const prefix = `/binding/${binding}`; const url = `${origin}${prefix}`;

  const added = await modifyBatch(url, { changes: [{ kind: 'add', text: '绑定地址导出验证' }] });
  const segment = added.status.snapshot.segments[0]!;
  const { asset } = await importVideo(url, video);
  await modifyBatch(url, { changes: [{ kind: 'video', expected: segment, assetId: asset.id, start: 0 }] });
  const { settings } = await queryExportSettings(url);
  await saveExportSettings(url, { expected: settings, settings: { ...settings, fps: 25, fontFamily: 'Noto Sans CJK SC', fontSize: 48 } });
  await submitSpeech(url, { segmentId: segment.id, requestId: randomUUID() });
  await expect.poll(async () => (await querySpeech(url)).locked, { timeout: 15000 }).toBe(false);
  const speech = await querySpeech(url);
  assert.equal(speech.tasks[0]!.state, 'succeeded', JSON.stringify(speech));
  const accepted = await submitExport(url);
  await expect.poll(async () => (await queryExports(url)).locked, { timeout: 30000 }).toBe(false);
  const task = (await queryExports(url)).tasks.find(task => task.id === accepted.id);
  assert.equal(task?.state, 'succeeded', JSON.stringify(task));
  assert.ok(task?.output, '导出任务必须提供成片');
  assert.ok(task.output.previewUrl, '导出任务必须提供兼容预览链接');
  for (const [outputUrl, contentType] of [[task.output.url, 'video/mp4'], [task.output.previewUrl, 'video/webm']] as const) {
    assert.ok(outputUrl.startsWith(`${prefix}/`), `输出链接必须带当前绑定前缀：${outputUrl}`);
    const response = await fetch(new URL(outputUrl, origin));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), contentType);
    assert.ok((await response.arrayBuffer()).byteLength > 0, '媒体响应必须可读取且非空');
    const unbound = await fetch(new URL(outputUrl.slice(prefix.length), origin));
    assert.equal(unbound.status, 409);
    await unbound.body?.cancel();
  }
});

for (const owner of ['user', 'codex'] as const) test(`${owner} 编辑期间 HTTP 和 MCP 均拒绝导出，状态仍显示原修改权`, async ({ createDirectory, openConnection, startService }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-edit-export-'));
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'test');
  const projectDirectory = join(root, 'project');
  const service = await startService({ projectDirectory, panelDirectory, port: 0 });
  const mcp = openConnection(() => createBusinessMcp(service.url));
  const client = openConnection(() => new Client({ name: '编辑期间拒绝导出', version: '1' }));
  let release: (() => Promise<void>) | undefined;
  openConnection(() => ({ close: () => release?.() }));
  const [a, b] = InMemoryTransport.createLinkedPair(); await mcp.connect(b); await client.connect(a);
  if (owner === 'user') {
    const edit = await beginEdit(service.url);
    release = edit.close;
  } else {
    // 不完整的请求体让真实 Codex 修改连接保持修改权。
    const pending = request(`${service.url}/api/codex/modify`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    pending.on('error', () => {}); pending.write('{"changes":');
    release = async () => { pending.destroy(); };
  }
  await expect.poll(async () => !(await queryStatus(service.url)).modification).toBeFalsy();
  const before = await queryStatus(service.url);
  assert.deepEqual(before.modification, { owner });
  assert.equal(before.taskLocked, false);
  const message = owner === 'user' ? /用户正在编辑/ : /Codex 正在修改/;
  await assert.rejects(submitExport(service.url), message);
  const rejected = await client.callTool({ name: 'clapgrid_submit_export', arguments: {} });
  assert.equal(rejected.isError, true); assert.match(JSON.stringify(rejected.content), message);
  assert.deepEqual(await queryExports(service.url), { locked: false, tasks: [] });
  assert.equal(existsSync(join(projectDirectory, 'exports')), false);
  const after = await queryStatus(service.url);
  assert.deepEqual(after.snapshot, before.snapshot);
  assert.deepEqual(after.modification, { owner });
  assert.equal(after.taskLocked, false);
  await release(); release = undefined;
  await expect.poll(async () => (await queryStatus(service.url)).modification).toBeFalsy();
  assert.equal((await submitExport(service.url)).state, 'accepted');
});

// 此例往返 MCP、真实字体检查及服务重启，使用有限的产品集成预算。
test('表格 HTTP 与 MCP 共享导出设置，自动保存恢复并遵守普通修改权及任务锁', async ({ createDirectory, openConnection, startService }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-export-http-'));
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'test');
  let finish!: (response: Response) => void;
  const options = { projectDirectory: join(root, 'project'), panelDirectory, port: 0, speechRuntime: {
    configPath: '.env', key: () => 'key', fetch: (async () => new Promise<Response>(resolve => { finish = resolve; })) as typeof fetch,
  } };
  let service = await startService(options);
  const mcp = openConnection(() => createBusinessMcp(service.url)); const client = openConnection(() => new Client({ name: '导出设置验证', version: '1' }));

  const [a, b] = InMemoryTransport.createLinkedPair(); await mcp.connect(b); await client.connect(a);
  const original = await queryExportSettings(service.url);
  const settings = { ...original.settings, fontFamily: 'Noto Sans CJK SC', fontSize: 48 };
  const edit = await beginEdit(service.url);
  const blocked = await client.callTool({ name: 'clapgrid_set_export_settings', arguments: { expected: original.settings, settings } });
  assert.equal(blocked.isError, true); assert.match(JSON.stringify(blocked.content), /用户正在编辑/);
  await saveExportSettings(service.url, { expected: original.settings, settings }, edit.token);
  assert.deepEqual((await queryStatus(service.url)).modification, { owner: 'user' });
  await saveExportSettings(service.url, { expected: settings, settings }, edit.token);
  await edit.close();
  const queried = await client.callTool({ name: 'clapgrid_export_settings', arguments: {} });
  assert.deepEqual((queried.structuredContent as ExportStatus).settings, settings);
  const changed = { ...settings, fps: 60 };
  const saved = await client.callTool({ name: 'clapgrid_set_export_settings', arguments: { expected: settings, settings: changed } });
  assert.notEqual(saved.isError, true);
  assert.deepEqual((await queryExportSettings(service.url)).settings, changed);
  assert.deepEqual((await queryStatus(service.url)).snapshot.exportSettings, changed);
  const stale = await client.callTool({ name: 'clapgrid_set_export_settings', arguments: { expected: settings, settings } });
  assert.equal(stale.isError, true); assert.match(JSON.stringify(stale.content), /已变化/);
  const invalid = await fetch(`${service.url}/api/codex/export-settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected: changed, settings: { ...changed, fontSize: 0 } }) });
  assert.equal(invalid.status, 400); assert.match(await invalid.text(), /字号/);
  const unauthorized = await fetch(`${service.url}/api/export-settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected: changed, settings }) });
  assert.equal(unauthorized.status, 409);
  const added = await client.callTool({ name: 'clapgrid_modify', arguments: { changes: [{ kind: 'add', text: '配音期间不能改设置' }] } });
  assert.notEqual(added.isError, true);
  const segment = (await queryStatus(service.url)).snapshot.segments[0]!;
  await submitSpeech(service.url, { segmentId: segment.id, requestId: randomUUID() });
  await assert.rejects(beginEdit(service.url), /配音/);
  const locked = await client.callTool({ name: 'clapgrid_set_export_settings', arguments: { expected: changed, settings } });
  assert.equal(locked.isError, true); assert.match(JSON.stringify(locked.content), /配音/);
  assert.deepEqual((await queryExportSettings(service.url)).settings, changed);
  finish(new Response('data: {"code":0,"data":"SUQz"}\n\ndata: {"code":20000000}\n\n'));
  await expect.poll(async () => (await queryStatus(service.url)).taskLocked).toBeFalsy();
  await service.close(); service = await startService(options);
  assert.deepEqual((await queryExportSettings(service.url)).settings, changed);
}, 30000);

test('表格与 MCP 共用全片导出任务，立即受理、重复提交、进度及取消状态一致', async ({ createDirectory, openConnection, startService }) => {
  const root = createDirectory(join(tmpdir(), 'clapgrid-export-api-'));
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'test');
  const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0 });
  const mcp = openConnection(() => createBusinessMcp(service.url)); const client = openConnection(() => new Client({ name: '导出验收', version: '1' }));

  const [a, b] = InMemoryTransport.createLinkedPair(); await mcp.connect(b); await client.connect(a);
  const response = await fetch(`${service.url}/api/exports/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200);
  const task = await response.json(); assert.equal(task.state, 'accepted');
  assert.equal((await queryStatus(service.url)).taskLocked, true);
  const duplicate = await client.callTool({ name: 'clapgrid_submit_export', arguments: {} });
  assert.equal((duplicate.structuredContent as import('../src/shared/contracts.js').ExportTask).id, task.id);
  const cancel = await client.callTool({ name: 'clapgrid_cancel_export', arguments: { taskId: task.id } });
  assert.equal((cancel.structuredContent as import('../src/shared/contracts.js').ExportTask).state, 'cleaning');
  let status: any;
  await expect.poll(async () => {
    const result = await client.callTool({ name: 'clapgrid_export_status', arguments: {} });
    status = result.structuredContent;
    return status.locked;
  }).toBe(false);
  assert.equal(status.tasks[0].id, task.id); assert.equal(status.tasks[0].state, 'cancelled');
  assert.equal((await queryStatus(service.url)).taskLocked, false);
  const invalid = await fetch(`${service.url}/api/exports/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"scope":"selected"}' });
  assert.equal(invalid.status, 400);
});
