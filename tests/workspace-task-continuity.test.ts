import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createBusinessMcp } from '../src/mcp/server.js';
import { startService } from '../src/service/server.js';
import { connectTable, querySegments, querySpeech, queryStatus, submitSpeech } from '../src/shared/client.js';

test('工作空间往返与宿主不可查询使旧绑定失效，原后台任务持续且不重复提交', { timeout: 60000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'clapgrid-binding-task-'));
  const first = join(root, 'first'); const second = join(root, 'second'); const dist = join(root, 'dist');
  mkdirSync(first); mkdirSync(second); mkdirSync(join(dist, 'panel'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(dist, 'panel', 'index.html'), '<title>ClapGrid</title>');
  const threadId = randomUUID(); const state = join(root, 'host.json'); const host = join(root, 'host.cjs');
  const setWorkspace = (cwd: string | null) => writeFileSync(state, JSON.stringify({ id: threadId, cwd }));
  setWorkspace(first);
  writeFileSync(host, `#!/usr/bin/env node\nconst fs=require('node:fs');const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const r=JSON.parse(line);if(r.method==='initialize')console.log(JSON.stringify({id:r.id,result:{}}));if(r.method==='thread/read')console.log(JSON.stringify({id:r.id,result:{thread:JSON.parse(fs.readFileSync(${JSON.stringify(state)},'utf8'))}}));});`, { mode: 0o700 });
  const previousHost = process.env.CLAPGRID_CODEX_BIN; process.env.CLAPGRID_CODEX_BIN = host;
  t.after(() => { if (previousHost === undefined) delete process.env.CLAPGRID_CODEX_BIN; else process.env.CLAPGRID_CODEX_BIN = previousHost; });
  await build({ entryPoints: ['src/runtime.ts', 'src/service/main.ts', 'src/business/media-worker.ts'], outbase: 'src', outdir: dist,
    bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['vite'],
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
  let finish!: (response: Response) => void; let calls = 0;
  const service = await startService({ workspaceDirectory: first, projectDirectory: join(first, 'clapgrid'), panelDirectory: join(dist, 'panel'), port: 0,
    speechRuntime: { configPath: join(root, 'test.env'), key: () => '测试替身密钥', fetch: (async () => { calls++; return new Promise<Response>(resolve => { finish = resolve; }); }) as typeof fetch } });
  const cli = async (workspace: string) => JSON.parse((await promisify(execFile)(process.execPath, [join(dist, 'runtime.js'), 'open', '--workspace', workspace, '--thread', threadId], { env: process.env })).stdout);
  let other: { url: string; instanceId: string } | undefined;
  t.after(async () => {
    if (other) { setWorkspace(second); await fetch(`${other.url}/api/service/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ instanceId: other.instanceId, interrupt: true }) }); }
    await service.close(); rmSync(root, { recursive: true, force: true });
  });
  const opened = await cli(first);
  const server = createBusinessMcp(); const client = new Client({ name: '任务工作空间往返', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  const tool = (name: string, args = {}) => client.callTool({ name, arguments: args, _meta: { threadId } });
  await tool('clapgrid_modify', { changes: [{ kind: 'add', text: '继续完成旧工作空间任务' }] });
  const before = await queryStatus(opened.url);
  const table = await connectTable(opened.url); await table.select([before.snapshot.segments[0]!.id]);
  const input = { requestId: randomUUID(), segmentId: before.snapshot.segments[0]!.id };
  const task = await submitSpeech(opened.url, input);
  for (let i = 0; !finish && i < 100; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(calls, 1); assert.equal((await queryStatus(opened.url)).taskLocked, true);
  setWorkspace(second);
  await assert.rejects(queryStatus(opened.url), /关闭重开/);
  setWorkspace(first);
  const rebound = await cli(first);
  assert.equal((await querySegments(rebound.url, { kind: 'selected' })).availability, 'unavailable', '撤销代次立即清除旧面板勾选，新代次不能在心跳清理前采用它');
  setWorkspace(second);
  await Promise.race([table.closed, new Promise((_, reject) => setTimeout(() => reject(new Error('旧面板勾选未释放')), 3500))]);
  for (const path of ['/api/segments/query', '/api/codex/modify', '/api/speech/submit', '/api/exports/submit']) {
    const rejected = await fetch(opened.url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(path.endsWith('/query') ? { scope: { kind: 'selected' } } : input) });
    assert.equal(rejected.status, 409);
  }
  assert.equal((await tool('clapgrid_status')).isError, true, '未打开新项目不能沿用旧服务');
  other = await cli(second);
  const newStatus = await queryStatus(other!.url);
  assert.notEqual(newStatus.snapshot.project.id, before.snapshot.project.id);
  assert.equal(newStatus.taskLocked, false);
  assert.equal((await tool('clapgrid_status')).isError, undefined);
  setWorkspace(first);
  const returned = await cli(first);
  assert.equal(returned.instanceId, opened.instanceId);
  assert.notEqual(returned.url, opened.url);
  assert.equal((await queryStatus(returned.url)).taskLocked, true, '目录变化与旧面板断开不提前解锁');
  const pending = await querySpeech(returned.url);
  assert.equal(pending.tasks.length, 1); assert.equal(pending.tasks[0]!.id, task.id);
  assert.equal(calls, 1, '往返与重新打开不能自动提交');
  await assert.rejects(queryStatus(opened.url), /关闭重开/);
  setWorkspace(null);
  assert.equal((await tool('clapgrid_status')).isError, true);
  await assert.rejects(queryStatus(returned.url), /关闭重开/);
  setWorkspace(first);
  await assert.rejects(queryStatus(returned.url), /关闭重开/, '恢复宿主查询也不能复活已失效的旧绑定');
  const verified = await cli(first);
  assert.equal((await queryStatus(verified.url)).taskLocked, true);
  finish(new Response('data: {"code":0,"data":"SUQzYWJj"}\n\ndata: {"code":20000000}\n\n'));
  let speech = await querySpeech(verified.url);
  for (let i = 0; speech.locked && i < 100; i++) { await new Promise(r => setTimeout(r, 10)); speech = await querySpeech(verified.url); }
  assert.equal(speech.tasks[0]!.id, task.id); assert.equal(speech.tasks[0]!.state, 'succeeded');
  assert.equal(speech.tasks.length, 1); assert.equal(calls, 1); assert.equal((await queryStatus(verified.url)).taskLocked, false);
  assert.equal((await fetch(new URL(speech.audio[0]!.url, verified.url))).status, 200);
});
