import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { connectTable, querySegments } from '../src/shared/client.js';

test('打开入口建立的对话绑定只读取和改变自己的面板勾选', { timeout: 60000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-selection-'));
  const dist = join(root, 'dist'); const workspace = join(root, 'workspace');
  mkdirSync(workspace); mkdirSync(join(dist, 'panel'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(dist, 'panel', 'index.html'), '<title>ClapGrid</title>');
  const host = join(root, 'host.cjs');
  writeFileSync(host, `#!/usr/bin/env node\nconst rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/read')console.log(JSON.stringify({id:r.id,result:{thread:{id:r.params.threadId,cwd:${JSON.stringify(workspace)}}}}));});`, { mode: 0o700 });
  await build({ entryPoints: ['src/runtime.ts', 'src/service/main.ts', 'src/business/media-worker.ts', 'src/mcp/main.ts'], outbase: 'src', outdir: dist,
    bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['vite'],
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  const open = async (threadId: string) => JSON.parse((await promisify(execFile)(process.execPath, [join(dist, 'runtime.js'), 'open', '--workspace', workspace, '--thread', threadId], { env: { ...process.env, CLAPGRID_CODEX_BIN: host } })).stdout);
  const aid = randomUUID(); const bid = randomUUID();
  const a = await open(aid); const b = await open(bid);
  const client = new Client({ name: 'selection-regression', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(dist, 'mcp/main.js')], env: Object.fromEntries(Object.entries({ ...process.env, CLAPGRID_CODEX_BIN: host }).filter((e): e is [string, string] => typeof e[1] === 'string')) }));
  t.after(() => client.close());
  const tool = (threadId: string, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args, _meta: { threadId } });
  const post = async (url: string, path: string, body: unknown) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  t.after(async () => { await post(a.url, '/api/service/stop', { instanceId: a.instanceId }); await new Promise(r => setTimeout(r, 300)); rmSync(root, { recursive: true, force: true }); });
  await post(a.url, '/api/codex/modify', { changes: [{ kind: 'add', text: '甲' }, { kind: 'add', text: '乙' }] });
  const all = await querySegments(a.url, { kind: 'all' });
  const first = all.segments[0]!; const second = all.segments[1]!;
  const ta = await connectTable(a.url); t.after(() => ta.close());
  await ta.select([first.id]);
  const unavailable = await querySegments(b.url, { kind: 'selected' });
  assert.equal(unavailable.availability, 'unavailable', '不能猜测其他对话唯一面板');
  assert.match(unavailable.message ?? '', /明确指定片段/);
  const tb = await connectTable(b.url); t.after(() => tb.close());
  await tb.select([second.id]);
  assert.deepEqual((await querySegments(a.url, { kind: 'selected' })).segments.map(s => s.id), [first.id]);
  assert.deepEqual((await querySegments(b.url, { kind: 'selected' })).segments.map(s => s.id), [second.id]);
  assert.equal((await querySegments(b.url, { kind: 'selected', tableId: ta.tableId })).availability, 'unavailable');
  assert.equal((await querySegments(b.url, { kind: 'all' })).tables.some(table => table.tableId === ta.tableId), false);
  assert.equal((await post(b.url, '/api/table-selection', { tableId: ta.tableId, ids: [second.id] })).ok, false);
  assert.equal((await post(b.url, '/api/table-session/release', { tableId: ta.tableId })).ok, false);
  assert.deepEqual((await querySegments(a.url, { kind: 'selected' })).segments.map(s => s.id), [first.id]);
  const queried = await tool(aid, 'clapgrid_query_segments', { scope: { kind: 'selected' } });
  assert.deepEqual((queried.structuredContent as { segments: { id: string }[] }).segments.map(s => s.id), [first.id]);
  const foreignModify = await tool(bid, 'clapgrid_process_segments', { scope: { kind: 'selected', tableId: ta.tableId }, expected: [first], action: { kind: 'edit', text: '越界' } });
  assert.equal(foreignModify.isError, true);
  const modified = await tool(aid, 'clapgrid_process_segments', { scope: { kind: 'selected' }, expected: [first], action: { kind: 'edit', text: '甲已修改' } });
  assert.notEqual(modified.isError, true);
  const stale = await tool(aid, 'clapgrid_process_segments', { scope: { kind: 'selected' }, expected: [first], action: { kind: 'edit', text: '不覆盖新内容' } });
  assert.equal((stale.structuredContent as { summary: { changed: number } }).summary.changed, 1);
  assert.deepEqual((await querySegments(a.url, { kind: 'all' })).segments.map(s => s.text), ['甲已修改', '乙']);
  // 空文案验证批量目标解析且确定不会调用真实配音供应商。
  await tool(bid, 'clapgrid_process_segments', { scope: { kind: 'ids', ids: [second.id] }, expected: [second], action: { kind: 'edit', text: '' } });
  const speech = await tool(bid, 'clapgrid_submit_speech_batch', { requestId: randomUUID(), mode: 'generate', scope: { kind: 'selected' } });
  assert.notEqual(speech.isError, true);
  assert.deepEqual((speech.structuredContent as { results: { segmentId: string }[] }).results.map(r => r.segmentId), [second.id]);
  assert.equal((await tool(bid, 'clapgrid_submit_speech_batch', { requestId: randomUUID(), mode: 'generate', scope: { kind: 'selected', tableId: ta.tableId } })).isError, true);
  const duplicate = await connectTable(a.url);
  assert.equal((await querySegments(a.url, { kind: 'selected' })).availability, 'ambiguous');
  await duplicate.close();
  await ta.select([]);
  assert.equal((await tool(aid, 'clapgrid_process_segments', { scope: { kind: 'selected' }, expected: [first], action: { kind: 'delete' } })).isError, true);
  assert.equal((await tool(aid, 'clapgrid_submit_speech_batch', { requestId: randomUUID(), mode: 'generate', scope: { kind: 'selected' } })).isError, true);
  await ta.close();
  const reconnected = await connectTable(a.url);
  try {
    assert.notEqual(reconnected.tableId, ta.tableId);
    assert.equal((await querySegments(a.url, { kind: 'selected', tableId: ta.tableId })).availability, 'unavailable');
    assert.equal((await querySegments(a.url, { kind: 'selected' })).availability, 'unavailable');
    assert.equal((await post(a.url, '/api/table-selection', { tableId: ta.tableId, ids: [first.id] })).ok, false);
    const explicit = await tool(aid, 'clapgrid_process_segments', { scope: { kind: 'ids', ids: [second.id] }, expected: [{ ...second, text: '' }], action: { kind: 'edit', text: '显式指定可用' } });
    assert.notEqual(explicit.isError, true);
  } finally { await reconnected.close(); }

});
