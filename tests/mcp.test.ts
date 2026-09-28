import { beginEdit, connectTable } from '../src/shared/client.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startService } from '../src/service/server.js';
import { createBusinessMcp } from '../src/mcp/server.js';

test('MCP 修改和查询与面板 HTTP 读取同一服务，服务离线时明确失败', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-mcp-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const panelDirectory = join(root, 'panel');
  mkdirSync(panelDirectory);
  writeFileSync(join(panelDirectory, 'index.html'), 'ClapGrid');
  const service = await startService({ projectDirectory: join(root, 'project'), panelDirectory, port: 0 });
  let closed = false;
  t.after(async () => { if (!closed) await service.close(); });
  const mcp = createBusinessMcp(service.url);
  const client = new Client({ name: 'clapgrid-test', version: '0.1.0' });
  t.after(() => client.close());
  t.after(() => mcp.close());
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcp.connect(serverTransport);
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['clapgrid_status', 'clapgrid_modify', 'clapgrid_query_segments', 'clapgrid_process_segments', 'clapgrid_import_video', 'clapgrid_submit_speech', 'clapgrid_speech_status', 'clapgrid_set_voice', 'clapgrid_export_settings', 'clapgrid_set_export_settings']);
  const saved = await client.callTool({ name: 'clapgrid_modify', arguments: {
    changes: [{ kind: 'add', text: 'MCP 读取已保存文案' }],
  } });
  assert.notEqual(saved.isError, true);
  const status = (saved.structuredContent as { status: unknown }).status;
  const result = await client.callTool({ name: 'clapgrid_status', arguments: {} });
  assert.deepEqual(result.structuredContent, status);
  assert.deepEqual(await (await fetch(`${service.url}/api/status`)).json(), status);
  const queried = await client.callTool({ name: 'clapgrid_query_segments', arguments: { scope: { kind: 'query', textContains: 'MCP' } } });
  assert.notEqual(queried.isError, true);
  const segments = (queried.structuredContent as { segments: { id: string }[] }).segments;
  assert.equal(segments.length, 1);
  const noSelection = await client.callTool({ name: 'clapgrid_process_segments', arguments: {
    scope: { kind: 'selected' }, expected: segments, action: { kind: 'delete' },
  } });
  assert.equal(noSelection.isError, true);
  assert.match(JSON.stringify(noSelection.content), /无可用选择/);
  const edited = await client.callTool({ name: 'clapgrid_process_segments', arguments: {
    scope: { kind: 'ids', ids: [segments[0]!.id] }, expected: segments, action: { kind: 'edit', text: '按明确身份修改' },
  } });
  assert.notEqual(edited.isError, true);
  const table = await connectTable(service.url);
  await table.select([segments[0]!.id]);
  const selected = await client.callTool({ name: 'clapgrid_query_segments', arguments: { scope: { kind: 'selected' } } });
  const selection = selected.structuredContent as { segments: { id: string }[]; availability: string };
  assert.equal(selection.availability, 'available');
  assert.deepEqual(selection.segments.map(s => s.id), [segments[0]!.id]);
  const processed = await client.callTool({ name: 'clapgrid_process_segments', arguments: {
    scope: { kind: 'selected' }, expected: selection.segments, action: { kind: 'edit', text: 'MCP 当前勾选' },
  } });
  assert.notEqual(processed.isError, true);
  await table.close();
  const disconnected = await client.callTool({ name: 'clapgrid_query_segments', arguments: { scope: { kind: 'selected' } } });
  assert.equal((disconnected.structuredContent as { availability: string }).availability, 'unavailable');
  const pasted = await client.callTool({ name: 'clapgrid_modify', arguments: { changes: [{ kind: 'paste', text: '\n新增乙\n \n新增丙\n' }] } });
  assert.notEqual(pasted.isError, true);
  const all = await client.callTool({ name: 'clapgrid_query_segments', arguments: { scope: { kind: 'all' } } });
  const before = (all.structuredContent as { segments: { id: string; text: string }[] }).segments;
  assert.deepEqual(before.map(s => s.text), ['MCP 当前勾选', '新增乙', '新增丙']);
  const ids = before.map(s => s.id);
  const reordered = await client.callTool({ name: 'clapgrid_modify', arguments: { changes: [{ kind: 'reorder', expectedIds: ids, ids: [...ids].reverse() }] } });
  assert.notEqual(reordered.isError, true);
  const afterReorder = await client.callTool({ name: 'clapgrid_query_segments', arguments: { scope: { kind: 'all' } } });
  const after = (afterReorder.structuredContent as { segments: { id: string; text: string; order: number }[] }).segments;
  assert.deepEqual(after.map(s => [s.text, s.order]), [['新增丙', 1], ['新增乙', 2], ['MCP 当前勾选', 3]]);
  const deleted = await client.callTool({ name: 'clapgrid_modify', arguments: { changes: [{ kind: 'delete', expected: after[0] }] } });
  assert.notEqual(deleted.isError, true);
  const remaining = await client.callTool({ name: 'clapgrid_query_segments', arguments: { scope: { kind: 'all' } } });
  assert.deepEqual((remaining.structuredContent as { segments: { text: string }[] }).segments.map(s => s.text), ['新增乙', 'MCP 当前勾选']);
  const session = await beginEdit(service.url);
  const duringEdit = await client.callTool({ name: 'clapgrid_status', arguments: {} });
  assert.deepEqual((duringEdit.structuredContent as { modification: unknown }).modification, { owner: 'user' });
  const rejected = await client.callTool({ name: 'clapgrid_modify', arguments: { changes: [{ kind: 'add', text: '冲突' }] } });
  assert.equal(rejected.isError, true);
  assert.match(JSON.stringify(rejected.content), /用户正在编辑/);
  await session.close();
  await service.close(); closed = true;
  const offline = await client.callTool({ name: 'clapgrid_status', arguments: {} });
  assert.equal(offline.isError, true);
  assert.match(JSON.stringify(offline.content), /服务不可用/);
});
