import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startService } from '../src/service/server.js';
import { createBusinessMcp } from '../src/mcp/server.js';
import { beginEdit, queryExportSettings, saveExportSettings, queryStatus, submitSpeech } from '../src/shared/client.js';
import type { ExportStatus } from '../src/shared/contracts.js';
import { randomUUID } from 'node:crypto';

test('表格 HTTP 与 MCP 共享导出设置，自动保存恢复并遵守普通修改权及任务锁', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-export-http-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'test');
  let finish!: (response: Response) => void;
  const options = { projectDirectory: join(root, 'project'), panelDirectory, port: 0, speechRuntime: {
    configPath: '.env', key: () => 'key', fetch: (async () => new Promise<Response>(resolve => { finish = resolve; })) as typeof fetch,
  } };
  let service = await startService(options); t.after(() => service.close());
  const mcp = createBusinessMcp(service.url); const client = new Client({ name: '导出设置验证', version: '1' });
  t.after(() => client.close()); t.after(() => mcp.close());
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
  for (let i = 0; i < 100 && (await queryStatus(service.url)).taskLocked; i++) await new Promise(resolve => setTimeout(resolve, 5));
  await service.close(); service = await startService(options);
  assert.deepEqual((await queryExportSettings(service.url)).settings, changed);
});

test('表格与 MCP 共用全片导出任务，立即受理、重复提交、进度及取消状态一致', async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-export-api-'));
  const panelDirectory = join(root, 'panel'); mkdirSync(panelDirectory); writeFileSync(join(panelDirectory, 'index.html'), 'test');
  const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0 });
  t.after(async () => { await service.close(); rmSync(root, { recursive: true, force: true }); });
  const mcp = createBusinessMcp(service.url); const client = new Client({ name: '导出验收', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await mcp.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await mcp.close(); });
  const response = await fetch(`${service.url}/api/exports/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200);
  const task = await response.json(); assert.equal(task.state, 'accepted');
  assert.equal((await queryStatus(service.url)).taskLocked, true);
  const duplicate = await client.callTool({ name: 'clapgrid_submit_export', arguments: {} });
  assert.equal((duplicate.structuredContent as import('../src/shared/contracts.js').ExportTask).id, task.id);
  const cancel = await client.callTool({ name: 'clapgrid_cancel_export', arguments: { taskId: task.id } });
  assert.equal((cancel.structuredContent as import('../src/shared/contracts.js').ExportTask).state, 'cleaning');
  let status: any;
  for (let i = 0; i < 200; i++) {
    const result = await client.callTool({ name: 'clapgrid_export_status', arguments: {} });
    status = result.structuredContent;
    if (!status.locked) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(status.tasks[0].id, task.id); assert.equal(status.tasks[0].state, 'cancelled');
  assert.equal((await queryStatus(service.url)).taskLocked, false);
  const invalid = await fetch(`${service.url}/api/exports/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"scope":"selected"}' });
  assert.equal(invalid.status, 400);
});
